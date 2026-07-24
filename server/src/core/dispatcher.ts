import { spawn } from 'child_process';
import type { Config, RoleConfig, Task } from '../types.js';
import type { EventBus } from './events.js';
import type { Store } from './store.js';

/** Remove ANSI CSI/OSC escape sequences and lone carriage returns. */
// eslint-disable-next-line no-control-regex
const OSC_CSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
// Ollama's CLI redraws wrapped words even to a pipe as `<chars>ESC[<N>DESC[K`;
// that sequence means "delete the previous N chars", so apply it, then drop any
// remaining escape sequences and carriage returns.
function stripAnsi(s: string): string {
  return s.replace(/(.{0,200}?)\x1b\[(\d+)D\x1b\[K/gs, (_m, pre, n) => pre.slice(0, Math.max(0, pre.length - Number(n))))
          .replace(OSC_CSI_RE, '').replace(/\r/g, '');
}

/** A fully-resolved execution plan for one attempt of one task. */
interface ExecPlan {
  agent: string;                // agent/profile name driving the prompt ('' if none)
  brainId: string;             // brain used this attempt
  attempt: number;             // 0-based index into the agent's brain chain
  chainLen: number;            // length of the agent's brain chain (0 if pinned)
  pinned: boolean;             // context.brain override (retry same brain)
  label: string;                // worker display + logs
  platform: string;             // active-agent platform bucket
  exec: 'claude' | 'hermes' | 'agy' | 'script';
  model: string;
  command?: string[];
}

/**
 * Dispatcher — the execution layer that turns queued tasks into real agent runs.
 *
 * Polls the inbox for pending tasks that carry a role (context.role, or a tag
 * matching a configured role name), claims them, spawns the mapped platform CLI
 * headlessly, and completes the task with the agent's output. Full stdout is
 * also filed as a report so the Web UI shows complete inputs/outputs.
 *
 * Role → executor mapping lives in config.json under `orchestration.roles`:
 *   claude → `claude -p <prompt> --model <model> --dangerously-skip-permissions`
 *   hermes → `hermes -m <model> -z <prompt>`
 *   agy    → `agy -p <prompt>`
 *
 * Tasks WITHOUT a role are left alone (they may be aimed at live interactive
 * agents polling the inbox themselves). Tag a task `manual` to always skip it.
 */
export class Dispatcher {
  /** Name of the always-on coordinator agent shown in Active Agents. */
  static readonly COORDINATOR_NAME = 'orchestrator';
  private config: Config;
  private store: Store;
  private eventBus: EventBus;
  private running = new Map<string, { role: string; startedAt: number; workerAgentId?: string }>();
  private agentId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private classifying = new Set<string>();

  constructor(config: Config, store: Store, eventBus: EventBus) {
    this.config = config;
    this.store = store;
    this.eventBus = eventBus;
  }

  public start(): void {
    const orch = this.config.orchestration;
    if (!orch.enabled) {
      console.log('Dispatcher: disabled (orchestration.enabled = false)');
      return;
    }
    // Drop ghost registrations from previous service runs — there is exactly
    // one coordinator per server process. Sweep the old "dispatcher" name too
    // so a rename doesn't leave a stale card.
    for (const a of this.store.getActiveAgents()) {
      const isCoordinator = a.platform === 'cowork' && (a.agentName === Dispatcher.COORDINATOR_NAME || a.agentName === 'dispatcher');
      if (isCoordinator || a.sessionId === 'dispatcher-worker') {
        this.store.removeAgent(a.id);
      }
    }
    // Handover: reclaim tasks a previous dispatcher run claimed but never
    // finished (service restart / crash mid-execution). context.dispatched
    // marks dispatcher-owned claims, so live interactive agents' claims are
    // never touched.
    for (const t of this.store.listTasks()) {
      if ((t.status === 'in-progress' || t.status === 'claimed') && t.context?.dispatched) {
        t.status = 'pending';
        delete t.claimedAt;
        delete t.claimedBy;
        this.store.saveTask(t);
        console.log(`Dispatcher: handover — reclaimed orphaned task ${t.id} (${t.title})`);
      }
    }
    const agentNames = Object.keys(this.agents());
    const agent = this.store.registerAgent({
      platform: 'cowork',
      agentName: Dispatcher.COORDINATOR_NAME,
      capabilities: agentNames
    });
    this.agentId = agent.id;
    this.timer = setInterval(() => this.tick(), orch.pollIntervalMs);
    const clsMsg = orch.classifier?.enabled ? `classifier ${orch.classifier.model}` : 'classifier off';
    console.log(`Dispatcher: started (agents: ${agentNames.join(', ')}; max ${orch.maxConcurrent} concurrent; ${clsMsg}; staleClaim ${orch.staleClaimMs ?? 0}ms)`);
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  public getRunning(): { taskId: string; role: string; startedAt: number }[] {
    return Array.from(this.running.entries()).map(([taskId, r]) => ({ taskId, ...r }));
  }

  /** The agent registry (with a one-time fallback to legacy `roles` so old
   *  configs without an `agents` block still resolve). */
  private agents(): Record<string, { description: string; brains: string[] }> {
    const orch = this.config.orchestration;
    if (orch.agents && Object.keys(orch.agents).length) return orch.agents;
    // Legacy shim: synthesize agents from roles (single-brain chain via inline model).
    const out: Record<string, { description: string; brains: string[] }> = {};
    for (const [name, r] of Object.entries(orch.roles || {})) {
      out[name] = { description: name, brains: r.brain ? [r.brain] : [] };
    }
    return out;
  }

  /** Resolve which agent (worker profile) a task belongs to. */
  private resolveAgent(task: Task): string | null {
    if (task.tags?.includes('manual')) return null;
    const agents = this.agents();
    const ctx = task.context || {};
    const named = typeof ctx.agent === 'string' ? ctx.agent : typeof ctx.role === 'string' ? ctx.role : undefined;
    if (named && agents[named]) return named;
    for (const tag of task.tags || []) if (agents[tag]) return tag;
    if (task.skill && agents[task.skill]) return task.skill;
    return null;
  }

  private tick(): void {
    if (this.stopped || !this.agentId) return;
    const orch = this.config.orchestration;

    // heartbeat keeps the dispatcher and its live workers visible on the dashboard
    this.store.updateHeartbeat({
      agentId: this.agentId,
      status: this.running.size > 0 ? 'working' : 'idle',
      currentTask: Array.from(this.running.keys()).join(', ') || undefined
    });
    for (const r of this.running.values()) {
      if (r.workerAgentId) {
        this.store.updateHeartbeat({ agentId: r.workerAgentId, status: 'working' });
      }
    }

    // Rescue tasks orphaned by a crashed/exited agent (runs every tick, cheap).
    this.reclaimStaleClaims();

    if (this.running.size >= orch.maxConcurrent) return;

    // FIFO: listTasks sorts newest-first; dispatch oldest first so pipelines
    // (research -> synthesis) run in creation order.
    const pending = this.store.listTasks({ status: 'pending' }).reverse();
    for (const task of pending) {
      if (this.running.size >= orch.maxConcurrent) break;
      if (this.running.has(task.id)) continue;
      const plan = this.planFor(task);
      switch (plan.action) {
        case 'skip': continue;               // manual, or unknown target
        case 'remote': continue;             // leave in inbox for the remote client to claim
        case 'classify': this.classify(task); continue;
        case 'execute':
          if (!this.depsSatisfied(task)) continue;
          this.execute(task, plan.exec).catch(e => console.error(`Dispatcher: task ${task.id} failed:`, e));
      }
    }
  }

  /**
   * Decide how a pending task should run.
   *   1. `manual` tag                 -> skip
   *   2. explicit `context.brain` pin -> run on exactly that brain (retries it)
   *   3. an agent (context.agent/role / tag / skill) -> run on the agent's brain
   *      CHAIN at index context.attempts; on failure the handover advances to
   *      the next brain in the list. Brains registry says local (spawn here) or
   *      remote (leave in inbox for that client).
   *   4. nothing -> classify (LLM assigns an agent)
   */
  private planFor(task: Task): { action: 'skip' } | { action: 'remote' } | { action: 'classify' } | { action: 'execute'; exec: ExecPlan } {
    if (task.tags?.includes('manual')) return { action: 'skip' };
    const brains = this.config.orchestration.brains || {};
    const agentName = this.resolveAgent(task) || '';
    const attempt = Number(task.context?.attempts) || 0;

    // (2) explicit brain pin — overrides the agent chain, retries the same brain.
    const ctxBrain = typeof task.context?.brain === 'string' ? task.context.brain : undefined;
    if (ctxBrain && brains[ctxBrain]) {
      return this.brainPlan(agentName, ctxBrain, brains[ctxBrain], { pinned: true, attempt, chainLen: 0 });
    }

    // (3) agent brain chain.
    if (agentName) {
      const chain = this.agents()[agentName]?.brains || [];
      if (!chain.length) return { action: 'skip' };
      if (attempt >= chain.length) return { action: 'skip' };   // exhausted (handover already failed it)
      const brainId = chain[attempt];
      const b = brains[brainId];
      if (!b) return { action: 'skip' };                        // misconfigured chain
      return this.brainPlan(agentName, brainId, b, { pinned: false, attempt, chainLen: chain.length });
    }

    return { action: 'classify' };
  }

  private brainPlan(
    agent: string, brainId: string, b: { location: string; exec?: string; model?: string; command?: string[] },
    meta: { pinned: boolean; attempt: number; chainLen: number }
  ): { action: 'remote' } | { action: 'skip' } | { action: 'execute'; exec: ExecPlan } {
    if (b.location === 'remote') return { action: 'remote' };   // that machine's client claims it
    if (!b.exec) return { action: 'skip' };
    return { action: 'execute', exec: {
      agent, brainId, attempt: meta.attempt, chainLen: meta.chainLen, pinned: meta.pinned,
      label: `${agent || 'task'} · ${brainId}`,
      platform: this.platformOf(b.exec),
      exec: b.exec as ExecPlan['exec'], model: b.model || '', command: b.command
    } };
  }

  private platformOf(exec: string): string {
    const map: Record<string, string> = { claude: 'claude', agy: 'antigravity', script: 'pipeline', codex: 'codex', ollama: 'ollama', hermes: 'hermes' };
    return map[exec] || 'hermes';
  }

  /** Orchestrator-facing description of the brain registry. */
  private brainsPromptBlock(): string {
    const brains = this.config.orchestration.brains || {};
    const ids = Object.keys(brains);
    if (!ids.length) return '';
    const lines = ids.map(id => {
      const b = brains[id];
      return `  - ${id} [${b.location}]: ${b.description}`;
    });
    return `Optionally target a specific BRAIN (a model on a specific instance) by adding "brain":"<id>" to a subtask's context — e.g. {"role":"engineer","brain":"remote-aicodegen-cc-fable"}. LOCAL brains run here automatically; REMOTE brains are left in the inbox for that machine's client to claim. Available brains:\n${lines.join('\n')}`;
  }

  /**
   * Reclaim in-progress/claimed tasks whose claiming agent is no longer active.
   * Covers dispatcher restarts AND live agents that claimed work then died.
   * A task still owned by a heartbeating agent (or currently running here) is
   * left alone. Gated by orchestration.staleClaimMs (0 disables).
   */
  private reclaimStaleClaims(): void {
    const staleMs = this.config.orchestration.staleClaimMs ?? 0;
    if (staleMs <= 0) return;
    const activeIds = new Set(this.store.getActiveAgents().map(a => a.id));
    for (const t of this.store.listTasks({ status: 'in-progress' })) {
      if (this.running.has(t.id)) continue;
      const claimAge = t.claimedAt ? Date.now() - new Date(t.claimedAt).getTime() : Infinity;
      const claimerGone = !t.claimedBy || !activeIds.has(t.claimedBy);
      if (claimerGone && claimAge > staleMs) {
        t.status = 'pending';
        const prevClaimer = t.claimedBy;
        delete t.claimedAt;
        delete t.claimedBy;
        t.context = { ...(t.context || {}), dispatched: false };
        this.store.saveTask(t);
        console.log(`Dispatcher: reclaimed stale task ${t.id} (claimer ${prevClaimer ?? '?'} gone) — ${t.title}`);
      }
    }
  }

  /**
   * LLM-driven role assignment for roleless tasks — the "dispatcher agent"
   * (default Qwen3.6-35B-A3B, configurable via orchestration.classifier).
   * Single-flight per task; writes context.role so the next tick dispatches
   * it normally. Falls back to classifier.fallbackRole on any failure.
   */
  private classify(task: Task): void {
    const cls = this.config.orchestration.classifier;
    if (!cls?.enabled) return;
    if (this.classifying.has(task.id)) return;
    this.classifying.add(task.id);

    const agents = this.agents();
    const candidates = Object.entries(agents).filter(([n]) => !n.startsWith('orchestrator'));
    const prompt =
      `You are the DISPATCHER for a multi-agent company. Assign this task to ONE agent.\n\n` +
      `Task title: ${task.title}\n` +
      `Task description: ${task.description}\n\n` +
      `Available agents:\n` +
      candidates.map(([n, a]) => `- ${n}: ${a.description}`).join('\n') + '\n\n' +
      `Reply with ONLY the single agent name from the list above. No other text.`;

    const argv = this.buildArgv({ exec: cls.exec, model: cls.model }, prompt);
    const child = spawn(argv[0], argv.slice(1), { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), cls.timeoutMs);
    child.stdout.on('data', d => { out += d.toString(); });
    child.on('error', () => { /* handled in close via empty out */ });
    child.on('close', () => {
      clearTimeout(timer);
      // Prefer the most specific match (longest agent name) so "engineer-local"
      // wins over "engineer" when both appear in the output.
      const found = Object.keys(agents)
        .filter(r => !r.startsWith('orchestrator') && new RegExp(`\\b${r}\\b`).test(out))
        .sort((a, b) => b.length - a.length);
      const chosen = found.length ? found[0]
        : (agents[cls.fallbackRole] ? cls.fallbackRole : this.config.orchestration.defaultRole);
      const fresh = this.store.getTask(task.id);
      if (fresh && fresh.status === 'pending') {
        fresh.context = { ...(fresh.context || {}), role: chosen, classifiedBy: cls.model };
        this.store.saveTask(fresh);
        console.log(`Dispatcher: classified task ${task.id} -> ${chosen} (${cls.model}) — ${task.title}`);
      }
      this.classifying.delete(task.id);
    });
  }

  /**
   * `context.dependsOn: ["<task-id>", …]` gates dispatch until every listed
   * task is done. The dependent task's prompt gets the dependencies' results
   * appended, so an integrator subtask actually sees its inputs.
   */
  private depsSatisfied(task: Task): boolean {
    const deps = task.context?.dependsOn;
    if (!Array.isArray(deps) || deps.length === 0) return true;
    return deps.every((id: string) => this.store.getTask(id)?.status === 'done');
  }

  private buildPrompt(task: Task, role: string): string {
    const port = this.config.server.port;
    const lines = [
      `You are the "${role}" agent in a multi-agent company. Work autonomously and produce your final deliverable as plain text output.`,
      ``,
      `# Task: ${task.title}`,
      ``,
      task.description,
      ``
    ];
    if (task.context && Object.keys(task.context).length > 0) {
      lines.push(`# Context`, '```json', JSON.stringify(task.context, null, 2), '```', '');
    }
    const deps = task.context?.dependsOn;
    if (Array.isArray(deps) && deps.length > 0) {
      lines.push(`# Results from prerequisite tasks`);
      for (const id of deps) {
        const dep = this.store.getTask(id);
        if (dep?.result) {
          lines.push(`## ${dep.title}`, '', dep.result, '');
        }
      }
    }
    if (role.startsWith('orchestrator')) {
      lines.push(
        `# Orchestrator instructions`,
        `Decompose this request into concrete subtasks and dispatch them to the company via the Cowork REST API at http://localhost:${port}/api — one POST per subtask:`,
        '```bash',
        `curl -s -X POST http://localhost:${port}/api/inbox -H 'Content-Type: application/json' -d '{"title":"...","description":"...(full standalone instructions)...","from":{"platform":"claude","agent":"orchestrator"},"to":{},"priority":"normal","context":{"role":"<role>"},"tags":["<role>"]}'`,
        '```',
        `Available agents (assign one per subtask via context.role): ` +
          Object.entries(this.agents()).filter(([n]) => !n.startsWith('orchestrator'))
            .map(([n, a]) => `${n} (${a.description})`).join('; ') + '.',
        this.brainsPromptBlock(),
        `Each subtask description must be fully standalone — the executing agent sees ONLY that description.`,
        `If a subtask must wait for others (e.g. a final synthesis/integration step), add their task ids to its context: {"role":"planner","dependsOn":["<id1>","<id2>"]} — the API response to each POST gives you the created task's id. Dependent tasks are held until all dependencies are done, and their results are automatically shown to the dependent agent.`,
        `After dispatching, output a summary of the plan: which subtasks you created and why. Check existing tasks first with: curl -s http://localhost:${port}/api/inbox?limit=20`,
        ``
      );
    }
    lines.push(`When done, your final output (stdout) becomes the task result visible to the CEO on the dashboard.`);
    return lines.join('\n');
  }

  private buildArgv(roleCfg: RoleConfig, prompt: string): string[] {
    switch (roleCfg.exec) {
      case 'claude':
        return ['claude', '-p', prompt, '--model', roleCfg.model, '--dangerously-skip-permissions'];
      case 'hermes':
        return roleCfg.model
          ? ['hermes', '-m', roleCfg.model, '-z', prompt]
          : ['hermes', '-z', prompt];
      case 'agy':
        return ['agy', '-p', prompt];
      case 'codex':
        // OpenAI Codex CLI, non-interactive.
        return ['codex', 'exec', ...(roleCfg.model ? ['-m', roleCfg.model] : []), prompt];
      case 'ollama':
        // Local Ollama chat model (model required).
        if (!roleCfg.model) throw new Error('exec:ollama needs a model');
        return ['ollama', 'run', roleCfg.model, prompt];
      case 'script':
        // Task is passed via COWORK_TASK_* env vars (see execute); the command
        // is a fixed pipeline, not an LLM prompt.
        if (!roleCfg.command?.length) throw new Error(`role exec:script needs a "command" array`);
        return roleCfg.command;
      default:
        throw new Error(`Unknown exec type: ${(roleCfg as RoleConfig).exec}`);
    }
  }

  private async execute(task: Task, plan: ExecPlan): Promise<void> {
    const orch = this.config.orchestration;
    const role = plan.agent;
    if (!this.agentId) return;

    const claimed = this.store.claimTask({ taskId: task.id, agentId: this.agentId });
    if (!claimed) return;
    // Mark the claim as dispatcher-owned so startup handover can reclaim it
    claimed.context = { ...(claimed.context || {}), dispatched: true };
    this.store.saveTask(claimed);

    // Surface the worker as its own active agent so the dashboard shows WHO
    // is working (e.g. hermes/engineer · local-cc-opus), not just the coordinator.
    const worker = this.store.registerAgent({
      platform: plan.platform,
      agentName: plan.label,
      sessionId: 'dispatcher-worker',
      capabilities: [role || plan.label],
      currentTask: task.title
    });
    this.store.updateHeartbeat({ agentId: worker.id, status: 'working', currentTask: task.title });

    this.running.set(task.id, { role: plan.label, startedAt: Date.now(), workerAgentId: worker.id });
    console.log(`Dispatcher: [${plan.label}/${plan.exec}:${plan.model || 'default'}] running task ${task.id} — ${task.title}`);

    const prompt = this.buildPrompt(task, role);
    const argv = this.buildArgv({ exec: plan.exec, model: plan.model, command: plan.command }, prompt);

    const output = await new Promise<{ ok: boolean; text: string }>((resolve) => {
      const child = spawn(argv[0], argv.slice(1), {
        env: {
          ...process.env,
          // exec:script pipelines read the task from these instead of a prompt.
          COWORK_TASK_ID: task.id,
          COWORK_TASK_TITLE: task.title,
          COWORK_TASK_DESCRIPTION: task.description,
          COWORK_TASK_CONTEXT: JSON.stringify(task.context || {}),
          COWORK_API: `http://localhost:${this.config.server.port}/api`
        },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        resolve({ ok: false, text: `TIMEOUT after ${orch.taskTimeoutMs}ms\n${out}\n${err}` });
      }, orch.taskTimeoutMs);
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, text: `SPAWN ERROR: ${e.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        // Strip ANSI/terminal control sequences some CLIs emit even to a pipe
        // (e.g. Ollama's streaming cursor redraws) so results are clean text.
        const clean = stripAnsi(out).trim();
        if (code === 0 && clean) resolve({ ok: true, text: clean });
        else resolve({ ok: code === 0, text: (clean || stripAnsi(err).trim() || `exit code ${code}`) });
      });
    });

    this.running.delete(task.id);
    this.store.removeAgent(worker.id);

    // Full transcript as a report; trimmed result on the task itself.
    // Report filing must never lose the result — if it throws, complete anyway.
    let report: { id: string; filePath: string } | null = null;
    try {
      report = this.store.fileReport({
        title: `[${plan.label}] ${task.title}`,
        type: 'task-output',
        author_platform: plan.platform === 'pipeline' ? 'cowork' : plan.platform,
        author_agent: plan.label,
        content: output.text,
        status: output.ok ? 'final' : 'draft',
        tags: [role || plan.label, 'dispatcher', output.ok ? 'success' : 'failed']
      });
    } catch (e) {
      console.error(`Dispatcher: report filing failed for task ${task.id}:`, e);
    }

    // Handover: on failure advance to the NEXT brain in the agent's chain
    // (or, for a pinned brain, retry it up to inbox.maxRetries). context.attempts
    // is the chain index, so planFor picks the next brain on the requeue.
    const bound = plan.pinned ? this.config.inbox.maxRetries : plan.chainLen;
    if (!output.ok) {
      const fresh = this.store.getTask(task.id);
      if (fresh) {
        const nextAttempt = plan.attempt + 1;
        if (nextAttempt < bound) {
          const nextBrain = plan.pinned ? plan.brainId : (this.agents()[plan.agent]?.brains[nextAttempt] || '?');
          fresh.status = 'pending';
          delete fresh.claimedAt;
          delete fresh.claimedBy;
          fresh.context = { ...(fresh.context || {}), attempts: nextAttempt, dispatched: false };
          fresh.result = `attempt ${plan.attempt + 1}/${bound} failed on ${plan.brainId}${plan.pinned ? ' — retrying' : ` — handing over to ${nextBrain}`}: ${output.text.slice(0, 300)}`;
          this.store.saveTask(fresh);
          console.log(`Dispatcher: handover — task ${task.id} attempt ${plan.attempt + 1} failed on ${plan.brainId}, next → ${nextBrain}`);
          return;
        }
      }
    }

    const result = output.ok
      ? output.text.length > 2000 ? output.text.slice(0, 2000) + `\n…(full output in report ${report?.id ?? 'n/a'})` : output.text
      : `FAILED after ${bound} attempt(s) (chain exhausted): ${output.text.slice(0, 1000)}`;

    this.store.completeTask({ taskId: task.id, result, reportPath: report?.filePath });
    console.log(`Dispatcher: task ${task.id} ${output.ok ? 'completed' : 'FAILED (retries exhausted)'} (${output.text.length} chars)`);
  }
}

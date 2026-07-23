import { spawn } from 'child_process';
import type { Config, RoleConfig, Task } from '../types.js';
import type { EventBus } from './events.js';
import type { Store } from './store.js';

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
  private config: Config;
  private store: Store;
  private eventBus: EventBus;
  private running = new Map<string, { role: string; startedAt: number; workerAgentId?: string }>();
  private agentId: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

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
    // one dispatcher per server process.
    for (const a of this.store.getActiveAgents()) {
      if ((a.platform === 'cowork' && a.agentName === 'dispatcher') || a.sessionId === 'dispatcher-worker') {
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
    const agent = this.store.registerAgent({
      platform: 'cowork',
      agentName: 'dispatcher',
      capabilities: Object.keys(orch.roles)
    });
    this.agentId = agent.id;
    this.timer = setInterval(() => this.tick(), orch.pollIntervalMs);
    console.log(`Dispatcher: started (roles: ${Object.keys(orch.roles).join(', ')}; max ${orch.maxConcurrent} concurrent)`);
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  public getRunning(): { taskId: string; role: string; startedAt: number }[] {
    return Array.from(this.running.entries()).map(([taskId, r]) => ({ taskId, ...r }));
  }

  private resolveRole(task: Task): string | null {
    if (task.tags?.includes('manual')) return null;
    const roles = this.config.orchestration.roles;
    const ctxRole = task.context?.role;
    if (typeof ctxRole === 'string' && roles[ctxRole]) return ctxRole;
    for (const tag of task.tags || []) {
      if (roles[tag]) return tag;
    }
    // task.skill may also name a role (create_task exposes it prominently)
    if (task.skill && roles[task.skill]) return task.skill;
    return null;
  }

  private tick(): void {
    if (this.stopped || !this.agentId) return;
    const orch = this.config.orchestration;
    if (this.running.size >= orch.maxConcurrent) return;

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

    // FIFO: listTasks sorts newest-first; dispatch oldest first so pipelines
    // (research -> synthesis) run in creation order.
    const pending = this.store.listTasks({ status: 'pending' }).reverse();
    for (const task of pending) {
      if (this.running.size >= orch.maxConcurrent) break;
      if (this.running.has(task.id)) continue;
      const role = this.resolveRole(task);
      if (!role) continue;
      if (!this.depsSatisfied(task)) continue;
      this.execute(task, role).catch(e => console.error(`Dispatcher: task ${task.id} failed:`, e));
    }
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
    if (role === 'orchestrator') {
      lines.push(
        `# Orchestrator instructions`,
        `Decompose this request into concrete subtasks and dispatch them to the company via the Cowork REST API at http://localhost:${port}/api — one POST per subtask:`,
        '```bash',
        `curl -s -X POST http://localhost:${port}/api/inbox -H 'Content-Type: application/json' -d '{"title":"...","description":"...(full standalone instructions)...","from":{"platform":"claude","agent":"orchestrator"},"to":{},"priority":"normal","context":{"role":"<role>"},"tags":["<role>"]}'`,
        '```',
        `Available roles: engineer (Claude Opus — code), engineer-local (deepseek — code, cheaper), planner (product planning), researcher (deep research), sales, marketing, generalist.`,
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
      default:
        throw new Error(`Unknown exec type: ${(roleCfg as RoleConfig).exec}`);
    }
  }

  private async execute(task: Task, role: string): Promise<void> {
    const orch = this.config.orchestration;
    const roleCfg = orch.roles[role];
    if (!this.agentId) return;

    const claimed = this.store.claimTask({ taskId: task.id, agentId: this.agentId });
    if (!claimed) return;
    // Mark the claim as dispatcher-owned so startup handover can reclaim it
    claimed.context = { ...(claimed.context || {}), dispatched: true };
    this.store.saveTask(claimed);

    // Surface the worker as its own active agent so the dashboard shows WHO
    // is working (e.g. hermes/planner (Qwen3.6-35B-A3B-NVFP4)), not just the
    // dispatcher. Deregistered when the run ends.
    const modelShort = (roleCfg.model || 'default').split('/').pop()!.split(':').pop()!;
    const workerPlatform = roleCfg.exec === 'claude' ? 'claude' : roleCfg.exec === 'agy' ? 'antigravity' : 'hermes';
    const worker = this.store.registerAgent({
      platform: workerPlatform,
      agentName: `${role} (${modelShort})`,
      sessionId: 'dispatcher-worker',
      capabilities: [role],
      currentTask: task.title
    });
    this.store.updateHeartbeat({ agentId: worker.id, status: 'working', currentTask: task.title });

    this.running.set(task.id, { role, startedAt: Date.now(), workerAgentId: worker.id });
    console.log(`Dispatcher: [${role}/${roleCfg.exec}:${roleCfg.model || 'default'}] running task ${task.id} — ${task.title}`);

    const prompt = this.buildPrompt(task, role);
    const argv = this.buildArgv(roleCfg, prompt);

    const output = await new Promise<{ ok: boolean; text: string }>((resolve) => {
      const child = spawn(argv[0], argv.slice(1), {
        env: { ...process.env },
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
        if (code === 0 && out.trim()) resolve({ ok: true, text: out.trim() });
        else resolve({ ok: code === 0, text: (out.trim() || err.trim() || `exit code ${code}`) });
      });
    });

    this.running.delete(task.id);
    this.store.removeAgent(worker.id);

    // Full transcript as a report; trimmed result on the task itself.
    // Report filing must never lose the result — if it throws, complete anyway.
    let report: { id: string; filePath: string } | null = null;
    try {
      report = this.store.fileReport({
        title: `[${role}] ${task.title}`,
        type: 'task-output',
        author_platform: roleCfg.exec === 'claude' ? 'claude' : roleCfg.exec === 'agy' ? 'antigravity' : 'hermes',
        author_agent: `${role} (${roleCfg.model || 'default'})`,
        content: output.text,
        status: output.ok ? 'final' : 'draft',
        tags: [role, 'dispatcher', output.ok ? 'success' : 'failed']
      });
    } catch (e) {
      console.error(`Dispatcher: report filing failed for task ${task.id}:`, e);
    }

    if (!output.ok) {
      // Handover: retry up to inbox.maxRetries, downgrading to the role's
      // fallback (if configured) on each failed attempt.
      const fresh = this.store.getTask(task.id);
      if (fresh) {
        const attempts = (Number(fresh.context?.attempts) || 0) + 1;
        const maxRetries = this.config.inbox.maxRetries;
        if (attempts < maxRetries) {
          const nextRole = roleCfg.fallback && this.config.orchestration.roles[roleCfg.fallback]
            ? roleCfg.fallback : role;
          fresh.status = 'pending';
          delete fresh.claimedAt;
          delete fresh.claimedBy;
          fresh.context = { ...(fresh.context || {}), attempts, role: nextRole, dispatched: false };
          fresh.result = `attempt ${attempts}/${maxRetries} failed as "${role}"${nextRole !== role ? ` — handed over to "${nextRole}"` : ' — retrying'}: ${output.text.slice(0, 300)}`;
          this.store.saveTask(fresh);
          console.log(`Dispatcher: handover — task ${task.id} attempt ${attempts} failed as ${role}, requeued as ${nextRole}`);
          return;
        }
      }
    }

    const result = output.ok
      ? output.text.length > 2000 ? output.text.slice(0, 2000) + `\n…(full output in report ${report?.id ?? 'n/a'})` : output.text
      : `FAILED after ${this.config.inbox.maxRetries} attempts: ${output.text.slice(0, 1000)}`;

    this.store.completeTask({ taskId: task.id, result, reportPath: report?.filePath });
    console.log(`Dispatcher: task ${task.id} ${output.ok ? 'completed' : 'FAILED (retries exhausted)'} (${output.text.length} chars)`);
  }
}

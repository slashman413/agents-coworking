import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import { globSync } from 'glob';
import type { Config, ActiveAgent, Task, Report, DashboardData, AgentCard, InteractionField } from '../types.js';
import type { EventBus } from './events.js';
import { Roster } from './roster.js';

/**
 * A veto the Dispatcher registers on the store so EXTERNAL task completions
 * (a remote brain's client calling complete_task / PATCH inbox) pass through the
 * same result verification as local runs. `handover` means the guard has already
 * re-queued the task for the next fallback brain — do NOT mark it done. `complete`
 * lets completion proceed, optionally rewriting the stored result (e.g. a
 * "chain exhausted" FAILED summary). `wait-input` means the result is really a
 * QUESTION back to the user: park the task on `wait-input` with the questions as
 * an interaction packet instead of marking it done or handing it off.
 */
export type CompletionDecision =
  | { action: 'complete'; result?: string }
  | { action: 'handover' }
  | { action: 'wait-input'; questions?: string[] };
export type CompletionGuard = (task: Task, result?: string) => Promise<CompletionDecision>;

export class Store {
  private config: Config;
  private eventBus: EventBus;
  private roster: Roster;
  private activeAgents = new Map<string, ActiveAgent>();
  private startTime = Date.now();
  private completionGuard?: CompletionGuard;

  constructor(config: Config, eventBus: EventBus) {
    this.config = config;
    this.eventBus = eventBus;
    this.roster = new Roster(config.paths.agencyAgents);
  }

  public initialize(): void {
    const dirs = [
      this.config.paths.inbox,
      this.config.paths.reports,
      this.config.paths.status,
      this.config.paths.decisions,
      this.config.paths.workflows
    ];

    // Skip unset paths — a config predating a newer path key would otherwise
    // crash startup on mkdirSync(undefined).
    for (const dir of dirs) {
      if (dir && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.roster.loadAll();
    this.loadActiveAgents();
  }

  private loadActiveAgents(): void {
    const agentsFile = path.join(this.config.paths.status, 'agents.json');
    if (fs.existsSync(agentsFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(agentsFile, 'utf-8'));
        if (Array.isArray(data)) {
          for (const agent of data) {
            this.activeAgents.set(agent.id, agent);
          }
        }
      } catch (e) {
        console.error('Failed to load active agents', e);
      }
    }
  }

  private saveActiveAgents(): void {
    const agentsFile = path.join(this.config.paths.status, 'agents.json');
    const data = Array.from(this.activeAgents.values());
    fs.writeFileSync(agentsFile, JSON.stringify(data, null, 2));
  }

  public registerAgent(params: { platform: string; agentName: string; sessionId?: string; capabilities?: string[]; currentTask?: string }): ActiveAgent {
    const id = uuidv4();
    const now = new Date().toISOString();
    const agent: ActiveAgent = {
      id,
      platform: params.platform,
      agentName: params.agentName,
      sessionId: params.sessionId,
      capabilities: params.capabilities || [],
      currentTask: params.currentTask,
      status: 'idle',
      registeredAt: now,
      lastHeartbeat: now
    };
    
    this.activeAgents.set(id, agent);
    this.saveActiveAgents();
    this.eventBus.emitAgentRegistered(agent);
    
    return agent;
  }

  public updateHeartbeat(params: { agentId: string; status?: 'idle' | 'working' | 'blocked'; currentTask?: string }): ActiveAgent | null {
    const agent = this.activeAgents.get(params.agentId);
    if (!agent) return null;
    
    agent.lastHeartbeat = new Date().toISOString();
    if (params.status) agent.status = params.status;
    if (params.currentTask !== undefined) agent.currentTask = params.currentTask;
    
    this.saveActiveAgents();
    this.eventBus.emitHeartbeat(agent.id, agent.status, agent.currentTask);
    
    return agent;
  }

  public getActiveAgents(filters?: { platform?: string; status?: string }): ActiveAgent[] {
    let agents = Array.from(this.activeAgents.values());
    if (filters?.platform) {
      agents = agents.filter(a => a.platform === filters.platform);
    }
    if (filters?.status) {
      agents = agents.filter(a => a.status === filters.status);
    }
    return agents;
  }

  // ── Per-client × per-brain invocation counters (in-memory, non-persistent;
  //    reset on service restart and when a client re-registers). ──────────────
  private counters = { ran: new Map<string, Map<string, number>>(), submitted: new Map<string, Map<string, number>>() };
  private bump(m: Map<string, Map<string, number>>, client: string, brain: string): void {
    if (!m.has(client)) m.set(client, new Map());
    const b = m.get(client)!;
    b.set(brain, (b.get(brain) || 0) + 1);
  }
  public countRun(client: string, brain: string): void { this.bump(this.counters.ran, client, brain); }
  public countSubmitted(client: string, brain: string): void { this.bump(this.counters.submitted, client, brain); }
  public resetCounters(client: string): void { this.counters.ran.delete(client); this.counters.submitted.delete(client); }
  public getCounters(): { ran: Record<string, Record<string, number>>; submitted: Record<string, Record<string, number>> } {
    const toObj = (m: Map<string, Map<string, number>>) => Object.fromEntries([...m].map(([k, v]) => [k, Object.fromEntries(v)]));
    return { ran: toObj(this.counters.ran), submitted: toObj(this.counters.submitted) };
  }

  public removeAgent(id: string): boolean {
    const existed = this.activeAgents.delete(id);
    if (existed) this.saveActiveAgents();
    return existed;
  }

  public removeStaleAgents(timeoutMs: number): void {
    const now = Date.now();
    let changed = false;
    for (const [id, agent] of this.activeAgents.entries()) {
      if (now - new Date(agent.lastHeartbeat).getTime() > timeoutMs) {
        this.activeAgents.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.saveActiveAgents();
    }
  }

  // ── Task input files (attached by a person for the brain to read) ──────────
  // Layout mirrors artifacts/: <repo>/inputs/<taskId>/<file> for a task's inputs,
  // plus <repo>/inputs/_staging/<token>/<file> for uploads that arrive BEFORE
  // their task exists (chat composer). Gitignored. Materializing staged uploads
  // into the task dir at creation time keeps create-with-inputs race-free — the
  // task is only visible as `pending` (claimable) once its inputs are present.

  /** Repo-level inputs root (sibling of reports/ and artifacts/). */
  private inputsRoot(): string {
    return path.resolve(this.config.paths.reports, '..', 'inputs');
  }
  private inputsDir(taskId: string): string {
    return path.join(this.inputsRoot(), path.basename(taskId));
  }

  /** Best-effort GC of staging slots older than an hour (never-claimed uploads). */
  private gcStaging(): void {
    const staging = path.join(this.inputsRoot(), '_staging');
    if (!fs.existsSync(staging)) return;
    const cutoff = Date.now() - 3_600_000;
    for (const slot of fs.readdirSync(staging)) {
      const p = path.join(staging, slot);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  /**
   * Persist an uploaded file to a staging slot and return a `token` the caller
   * passes back when it creates the task (createTask) or attaches to an existing
   * one (appendInputs). Path-guarded; rejects empty uploads.
   */
  public stageUpload(name: string, data: Buffer): { token: string; name: string; bytes: number } {
    const fileName = path.basename(String(name || '')).trim();
    if (!fileName || fileName === '.' || fileName === '..') throw new Error('invalid filename');
    if (!data || !data.length) throw new Error('empty upload');
    this.gcStaging();
    const token = uuidv4();
    const dir = path.join(this.inputsRoot(), '_staging', token);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), data);
    return { token, name: fileName, bytes: data.length };
  }

  /** Move staged uploads (by token) into the task's inputs dir; returns the
   *  stored filenames. Skips tokens whose slot is gone; collision-suffixes names. */
  private materializeInputs(taskId: string, inputs: Array<{ token?: string; name?: string }>): string[] {
    const dir = this.inputsDir(taskId);
    const stored: string[] = [];
    for (const it of inputs) {
      const token = String(it?.token || '');
      if (!token || /[\\/]/.test(token)) continue;
      const slot = path.join(this.inputsRoot(), '_staging', path.basename(token));
      if (!fs.existsSync(slot)) continue;
      let src: string | undefined;
      try { src = fs.readdirSync(slot).find(f => { try { return fs.statSync(path.join(slot, f)).isFile(); } catch { return false; } }); } catch { continue; }
      if (!src) continue;
      fs.mkdirSync(dir, { recursive: true });
      const original = path.basename(it?.name || src);
      let name = original, dest = path.join(dir, name);
      for (let n = 1; fs.existsSync(dest); n++) {
        const ext = path.extname(original);
        name = `${path.basename(original, ext)}-${n}${ext}`;
        dest = path.join(dir, name);
      }
      try { fs.renameSync(path.join(slot, src), dest); }
      catch { try { fs.copyFileSync(path.join(slot, src), dest); } catch { continue; } }
      try { fs.rmSync(slot, { recursive: true, force: true }); } catch { /* ignore */ }
      stored.push(name);
    }
    return stored;
  }

  /** Attach more input files to an existing task (union onto context.inputFiles). */
  public appendInputs(taskId: string, inputs: Array<{ token?: string; name?: string }>): Task | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const names = this.materializeInputs(task.id, Array.isArray(inputs) ? inputs : []);
    if (names.length) {
      const existing = Array.isArray(task.context?.inputFiles) ? task.context!.inputFiles as string[] : [];
      task.context = { ...(task.context || {}), inputFiles: [...new Set([...existing, ...names])] };
      this.saveTask(task);
    }
    return task;
  }

  /** Filenames of a task's attached input files (downloadable). */
  public listInputs(taskId: string): string[] {
    const task = this.getTask(taskId);
    const dir = this.inputsDir(task?.id || taskId);
    if (!fs.existsSync(dir)) return [];
    try { return fs.readdirSync(dir).filter(f => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } }); }
    catch { return []; }
  }

  /** Absolute path of one input file (path-guarded), or null if absent. */
  public inputFilePath(taskId: string, file: string): string | null {
    const task = this.getTask(taskId);
    const dir = this.inputsDir(task?.id || taskId);
    const p = path.join(dir, path.basename(file));
    if (!p.startsWith(dir + path.sep) || !fs.existsSync(p)) return null;
    return p;
  }

  /** Absolute path of a task's inputs DIR (for the local dispatcher to point the
   *  agent at), or null when the task has no attached inputs. */
  public inputsPath(taskId: string): string | null {
    const task = this.getTask(taskId);
    const dir = this.inputsDir(task?.id || taskId);
    return fs.existsSync(dir) ? dir : null;
  }

  public createTask(params: Omit<Task, 'id' | 'status' | 'createdAt'>, opts?: { inputs?: Array<{ token?: string; name?: string }> }): Task {
    const id = uuidv4();
    const task: Task = {
      ...params,
      id,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    // Materialize any staged input uploads into inputs/<id>/ and record the stored
    // filenames on context.inputFiles BEFORE the task is written/emitted, so it is
    // never visible as `pending` (claimable) without its inputs already present.
    if (opts?.inputs && opts.inputs.length) {
      const names = this.materializeInputs(id, opts.inputs);
      if (names.length) {
        const existing = Array.isArray(task.context?.inputFiles) ? task.context!.inputFiles as string[] : [];
        task.context = { ...(task.context || {}), inputFiles: [...new Set([...existing, ...names])] };
      }
    }
    // A task shipped with an unanswered interaction packet is parked on the
    // `wait-input` category — held OUT of the pending pool so the dispatcher never
    // schedules or reassigns it. submitInteraction() releases it to `pending`.
    if (task.interaction && Array.isArray(task.interaction.fields) && task.interaction.fields.length) {
      task.interaction.status ||= 'pending';
      if (task.interaction.status !== 'submitted') task.status = 'wait-input';
    }

    const taskPath = path.join(this.config.paths.inbox, `${id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    
    this.eventBus.emitTaskCreated(task);
    return task;
  }

  public claimTask(params: { taskId: string; agentId: string; internal?: boolean }): Task | null {
    const task = this.getTask(params.taskId);
    if (!task) return null;
    // Human-in-the-loop hold: a task with an unanswered interaction packet is not
    // claimable by anyone (dispatcher or a remote client polling directly) until a
    // person submits the questions/checklist from the Inbox card. Otherwise the
    // executor would run before the human input lands in context.humanInput.
    if (task.interaction && Array.isArray(task.interaction.fields)
        && task.interaction.fields.length > 0 && task.interaction.status !== 'submitted') {
      return null;
    }
    // A LOCAL-brain task is the dispatcher's to run (it spawns the CLI directly and
    // injects the roster persona). External clients must not claim it — otherwise a
    // client that registered a local brain races the dispatcher and runs the task
    // WITHOUT the persona/ran-labels. Only internal (dispatcher) claims are allowed.
    if (!params.internal) {
      const brainId = task.context?.brain;
      const brain = brainId ? this.config.orchestration.brains?.[brainId] : undefined;
      if (brain && brain.location === 'local') return null;
    }
    // Atomic compare-and-set: only a pending task can be claimed. The server is
    // single-process, so claimTask runs to completion without interleaving —
    // this makes concurrent claims (many remote clients on one brain) safe:
    // the first wins, the rest get null. Re-claim by the same agent is allowed.
    if (task.status !== 'pending' && task.claimedBy !== params.agentId) return null;

    task.status = 'in-progress';
    task.claimedAt = new Date().toISOString();
    task.claimedBy = params.agentId;
    
    const taskPath = path.join(this.config.paths.inbox, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
    
    this.eventBus.emitTaskClaimed(task, params.agentId);
    return task;
  }

  /** Register the Dispatcher's completion guard (see {@link CompletionGuard}). */
  public setCompletionGuard(fn: CompletionGuard): void { this.completionGuard = fn; }


  public async completeTask(params: { taskId: string; result?: string; reportPath?: string; internal?: boolean }): Promise<Task | null> {
    const task = this.getTask(params.taskId);
    if (!task) return null;

    // External completions (a remote brain reporting its result) pass through the
    // guard: a soft failure reported as a result — a rate-limit / "you've hit your
    // session limit" notice, a refusal, or an empty answer — is rejected and
    // handed to the next fallback brain instead of being marked done. The
    // dispatcher's own completions are already verified, so they pass internal:true.
    let result = params.result;
    if (!params.internal && this.completionGuard && task.status !== 'done') {
      const decision = await this.completionGuard(task, params.result);
      if (decision.action === 'handover') return this.getTask(params.taskId);
      if (decision.action === 'wait-input') {
        return this.parkForInput({ taskId: task.id, questions: decision.questions || [], result: params.result });
      }
      if (decision.result !== undefined) result = decision.result;
    }

    task.status = 'done';
    task.completedAt = new Date().toISOString();
    if (result) task.result = result;
    if (params.reportPath) task.reportPath = params.reportPath;
    // Flag a chain-exhausted failure (every fallback brain failed verification) so
    // the UI groups it into the red "failed" category with a confirm-gated re-run,
    // rather than listing it as a green success. Covers BOTH completion paths — the
    // dispatcher's own internal completion and a remote brain's guarded completion
    // — because both finalise here with the same "FAILED after N attempt(s)…" text.
    task.failed = (typeof result === 'string' && /^FAILED after \d+ attempt/i.test(result.trim())) || undefined;

    const taskPath = path.join(this.config.paths.inbox, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));

    this.eventBus.emitTaskCompleted(task);
    return task;
  }

  /**
   * Re-queue a FAILED (chain-exhausted) or rejected task for another run. Resets
   * it to `pending` from the TOP of its chain: clears the failed flag, the prior
   * result/claim/completion, and the scheduling bookkeeping (attempts / dispatched /
   * failedBrains / dispatcher-published brain pin), while preserving the brief, the
   * agent / division / user brain pin, and any attached input files. The UI gates
   * this behind an explicit confirmation. Returns null if the task is gone or is
   * not in a re-runnable (finished-failed) state.
   */
  public rerunTask(taskId: string): Task | null {
    const task = this.getTask(taskId);
    if (!task) return null;
    const looksFailed = task.failed === true
      || task.status === 'rejected'
      || (task.status === 'done' && typeof task.result === 'string' && /^FAILED\b/i.test(task.result.trim()));
    if (!looksFailed) return null;

    const ctx: Record<string, any> = { ...(task.context || {}) };
    delete ctx.failedBrains;
    // A user brain pin (context.brain set WITHOUT brainAuto) is intentional — keep
    // it so the re-run targets the same brain. A dispatcher-published chain pin
    // (brainAuto) is transient — drop it so routing restarts at the top rung.
    if (ctx.brainAuto) delete ctx.brain;
    delete ctx.brainAuto;
    ctx.attempts = 0;
    ctx.dispatched = false;
    delete ctx.remoteWaitSince;
    delete ctx.ranAgent; delete ctx.ranDivision; delete ctx.ranBrain; delete ctx.isRoster;

    task.context = ctx;
    task.status = 'pending';
    delete task.failed;
    delete task.result;
    delete task.claimedAt;
    delete task.claimedBy;
    delete task.completedAt;
    delete task.reportPath;
    this.saveTask(task);
    this.eventBus.emitTaskCreated(task);   // nudge live dashboards to refresh
    return task;
  }

  /**
   * Delete a task and everything filed under it: its inbox JSON, its artifacts
   * dir, and every report belonging to it (matched on the report's taskId, plus
   * the task's own reportPath for reports filed before taskId existed).
   */
  public deleteTask(id: string): { deleted: boolean; reports: number; artifacts: boolean } {
    const task = this.getTask(id);
    if (!task) return { deleted: false, reports: 0, artifacts: false };
    // getTask resolves short ids by prefix, so `id` may be an 8-char short id.
    // Everything below keys off the canonical full UUID to avoid orphaning the
    // task file / reports / artifacts when deleted by short id.
    const fullId = task.id;

    // Reports filed for this task.
    let reports = 0;
    const reportsDir = this.config.paths.reports;
    for (const file of globSync('*.md', { cwd: reportsDir })) {
      const full = path.join(reportsDir, file);
      try {
        const fm = matter(fs.readFileSync(full, 'utf-8')).data as any;
        if (fm?.taskId === fullId) { fs.rmSync(full); reports++; }
      } catch { /* unreadable report — leave it alone */ }
    }
    // Legacy link: reports predating taskId are only reachable via reportPath.
    if (task.reportPath && fs.existsSync(task.reportPath) && task.reportPath.startsWith(reportsDir)) {
      try { fs.rmSync(task.reportPath); reports++; } catch { /* already gone */ }
    }

    // Artifacts dir (siblings of reports/, keyed by task id).
    const artDir = path.resolve(reportsDir, '..', 'artifacts', fullId);
    let artifacts = false;
    if (fs.existsSync(artDir)) {
      try { fs.rmSync(artDir, { recursive: true, force: true }); artifacts = true; } catch { /* ignore */ }
    }

    // Input files dir (sibling of artifacts/, keyed by task id).
    const inDir = path.resolve(reportsDir, '..', 'inputs', fullId);
    if (fs.existsSync(inDir)) {
      try { fs.rmSync(inDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }

    fs.rmSync(path.join(this.config.paths.inbox, `${fullId}.json`), { force: true });
    return { deleted: true, reports, artifacts };
  }

  /**
   * Bulk-purge finished tasks that are no longer worth keeping. Deliberately
   * conservative — a task is KEPT when any of these hold:
   *   • not finished (pending/claimed/in-progress)
   *   • finished more recently than `olderThanDays`
   *   • it produced artifacts (files someone may still want)
   *   • it is tagged `keep`/`important`/`pinned` (explicit "this is meaningful")
   * Pass dryRun to preview exactly what would go.
   */
  public purgeTasks(opts: { olderThanDays?: number; dryRun?: boolean } = {}): {
    purged: Array<{ id: string; title: string; completedAt?: string }>;
    keptCount: number; reportsDeleted: number; dryRun: boolean;
  } {
    const days = opts.olderThanDays ?? 30;
    const cutoff = Date.now() - days * 86400000;
    const keepTags = new Set(['keep', 'important', 'pinned']);
    const purged: Array<{ id: string; title: string; completedAt?: string }> = [];
    let keptCount = 0, reportsDeleted = 0;

    for (const task of this.listTasks({})) {
      const finished = task.status === 'done' || task.status === 'rejected';
      const when = new Date(task.completedAt || task.createdAt).getTime();
      const hasArtifacts = Array.isArray((task as any).artifacts) && (task as any).artifacts.length > 0;
      const tagged = (task.tags || []).some(t => keepTags.has(String(t).toLowerCase()));
      if (!finished || when >= cutoff || hasArtifacts || tagged) { keptCount++; continue; }

      purged.push({ id: task.id, title: task.title, completedAt: task.completedAt });
      if (!opts.dryRun) reportsDeleted += this.deleteTask(task.id).reports;
    }
    return { purged, keptCount, reportsDeleted, dryRun: !!opts.dryRun };
  }

  /** Persist arbitrary task mutations (handover, retries). */
  public saveTask(task: Task): void {
    const taskPath = path.join(this.config.paths.inbox, `${task.id}.json`);
    fs.writeFileSync(taskPath, JSON.stringify(task, null, 2));
  }

  /**
   * Record a person's answers to a task's interaction (its questions/checklist).
   * Writes each answer onto its field's `value`, flips the packet to `submitted`,
   * and mirrors a clean `{label: value}` map into `context.humanInput` so the
   * answers show up in the executing agent's prompt (buildPrompt dumps context).
   * Returns the updated task, or null if the task has no interaction.
   */
  public submitInteraction(params: {
    taskId: string;
    responses: Record<string, string | boolean>;
    submittedBy?: string;
  }): Task | null {
    const task = this.getTask(params.taskId);
    if (!task || !task.interaction) return null;

    const humanInput: Record<string, string | boolean> = {};
    for (const field of task.interaction.fields) {
      if (Object.prototype.hasOwnProperty.call(params.responses, field.id)) {
        let val = params.responses[field.id];
        if (field.type === 'checkbox') val = !!val;
        field.value = val;
      }
      // Require required fields to have a non-empty answer.
      if (field.required) {
        const v = field.value;
        const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
        if (empty && field.type !== 'checkbox') {
          throw new Error(`Field "${field.label}" is required`);
        }
      }
      if (field.value !== undefined) humanInput[field.label] = field.value;
    }

    task.interaction.status = 'submitted';
    task.interaction.submittedAt = new Date().toISOString();
    if (params.submittedBy) task.interaction.submittedBy = params.submittedBy;
    task.context = { ...(task.context || {}), humanInput };
    // Release the task into normal scheduling now that the answers are in. Only a
    // task still parked on `wait-input` is promoted — one already claimed/running
    // (e.g. answers edited mid-flight) keeps its live status untouched.
    if (task.status === 'wait-input') task.status = 'pending';

    this.saveTask(task);
    return task;
  }

  /**
   * Park a task on `wait-input` because its produced result ASKED THE USER a
   * question rather than delivering — so the orchestrator neither marks it done
   * nor hands it to a fallback brain. The questions become an interaction packet
   * the user answers from the Inbox card; submitInteraction() then releases it
   * back to `pending` (re-dispatched with the answers in context.humanInput). The
   * partial output is preserved on task.result so the user sees what was asked.
   */
  public parkForInput(params: { taskId: string; questions: string[]; result?: string }): Task | null {
    const task = this.getTask(params.taskId);
    if (!task) return null;
    const qs = (params.questions || []).map(q => (q || '').trim()).filter(Boolean).slice(0, 8);
    const labels = qs.length ? qs : ['The agent needs more information to proceed. Please provide guidance.'];
    const fields: InteractionField[] = labels.map((label, i) => ({
      id: `q${i + 1}`,
      label,
      type: 'textarea',
      // First question required so the packet can't be submitted empty; the rest optional.
      required: i === 0
    }));
    task.interaction = {
      prompt: 'The assigned agent paused and needs your input before it can finish this task.',
      fields,
      status: 'pending'
    };
    task.status = 'wait-input';
    delete task.claimedAt;
    delete task.claimedBy;
    if (params.result) task.result = params.result;
    // Reset scheduling flags so the resubmitted task re-dispatches cleanly from the
    // top of its chain — the previous run succeeded in producing a question, not a
    // failure, so it must not count against the fallback attempts.
    task.context = {
      ...(task.context || {}),
      dispatched: false,
      attempts: 0,
      remoteWaitSince: undefined,
      awaitingInput: true,
      inputQuestions: qs
    };
    this.saveTask(task);
    return task;
  }

  public getTask(id: string): Task | null {
    if (!id) return null;
    // Fast path: exact filename match (full UUID, the canonical stored form).
    const taskPath = path.join(this.config.paths.inbox, `${id}.json`);
    if (fs.existsSync(taskPath)) {
      try {
        return JSON.parse(fs.readFileSync(taskPath, 'utf-8')) as Task;
      } catch (e) {
        console.error(`Failed to parse task ${id}`, e);
      }
    }
    // Slow path: the UI, reports and chat all surface an 8-char SHORT id
    // (first UUID segment, e.g. "6e7fa48c"). When a caller looks a task up by
    // that short id the exact match above misses, even though the task exists
    // on disk as "6e7fa48c-….json". Resolve the short id by prefix.
    const shortId = this.resolveTaskFile(id);
    if (shortId) {
      try {
        return JSON.parse(fs.readFileSync(path.join(this.config.paths.inbox, shortId), 'utf-8')) as Task;
      } catch (e) {
        console.error(`Failed to parse task ${id} (${shortId})`, e);
      }
    }
    return null;
  }

  /**
   * Resolve a task id (full UUID *or* an 8-char short id / any unambiguous
   * prefix) to its on-disk filename. Returns null when nothing matches, or when
   * a short id is ambiguous (matches more than one task) so callers never act on
   * the wrong task. Guards against path separators so an id can't escape inbox.
   */
  private resolveTaskFile(id: string): string | null {
    if (!id || /[\\/]/.test(id)) return null;
    // Only treat plausible id fragments as prefixes (hex + dashes).
    if (!/^[0-9a-fA-F-]+$/.test(id)) return null;
    const matches = globSync(`${id}*.json`, { cwd: this.config.paths.inbox });
    return matches.length === 1 ? matches[0] : null;
  }

  public listTasks(filters?: { status?: string; platform?: string; agent?: string; limit?: number }): Task[] {
    const taskFiles = globSync('*.json', { cwd: this.config.paths.inbox });
    let tasks: Task[] = [];
    
    for (const file of taskFiles) {
      try {
        const fullPath = path.join(this.config.paths.inbox, file);
        const task = JSON.parse(fs.readFileSync(fullPath, 'utf-8')) as Task;
        tasks.push(task);
      } catch (e) {
        // ignore bad files
      }
    }
    
    // Sort by created desc
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (filters?.status) tasks = tasks.filter(t => t.status === filters.status);
    // Guard t.to / t.from — task files are plain JSON on disk and may be malformed
    if (filters?.platform) tasks = tasks.filter(t => t.to?.platform === filters.platform || (!t.to?.platform && t.from?.platform === filters.platform));
    if (filters?.agent) tasks = tasks.filter(t => t.to?.agent === filters.agent || t.claimedBy === filters.agent);
    
    if (filters?.limit && filters.limit > 0) {
      tasks = tasks.slice(0, filters.limit);
    }
    
    return tasks;
  }

  public fileReport(params: { title: string; type: string; author_platform: string; author_agent: string; content: string; status?: 'draft' | 'review' | 'final'; tags?: string[]; task_id?: string }): Report {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    const frontmatter = {
      id,
      ...(params.task_id ? { taskId: params.task_id } : {}),
      title: params.title,
      type: params.type,
      author: {
        platform: params.author_platform,
        agent: params.author_agent
      },
      createdAt: now,
      status: params.status || 'draft',
      tags: params.tags || []
    };
    
    // Serialize frontmatter separately and append the body verbatim.
    // matter.stringify(content, …) PARSES the content for an existing
    // frontmatter block first — agent output that happens to start with
    // `---` (but isn't valid YAML) threw YAMLException and lost the report.
    const fmBlock = matter.stringify('', frontmatter).trimEnd();
    const fileContent = `${fmBlock}\n\n${params.content}\n`;
    const fileName = `${id}.md`;
    const filePath = path.join(this.config.paths.reports, fileName);
    
    fs.writeFileSync(filePath, fileContent);
    
    const report: Report = {
      id,
      ...(params.task_id ? { taskId: params.task_id } : {}),
      title: params.title,
      type: params.type,
      author: frontmatter.author,
      createdAt: now,
      status: frontmatter.status as any,
      tags: frontmatter.tags,
      filePath,
      summary: params.content.substring(0, 200) + (params.content.length > 200 ? '...' : '')
    };
    
    this.eventBus.emitReportFiled(report);
    return report;
  }

  public getReport(id: string): (Report & { content?: string }) | null {
    const filePath = path.join(this.config.paths.reports, `${id}.md`);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const parsed = matter(content);
        return {
          ...parsed.data,
          filePath,
          summary: parsed.content.substring(0, 200) + (parsed.content.length > 200 ? '...' : ''),
          content: parsed.content
        } as Report & { content: string };
      } catch (e) {
        console.error(`Failed to parse report ${id}`, e);
      }
    }
    return null;
  }

  public listReports(filters?: { type?: string; platform?: string; limit?: number }): Report[] {
    const reportFiles = globSync('*.md', { cwd: this.config.paths.reports });
    let reports: Report[] = [];
    
    for (const file of reportFiles) {
      try {
        const fullPath = path.join(this.config.paths.reports, file);
        const content = fs.readFileSync(fullPath, 'utf-8');
        const parsed = matter(content);
        reports.push({
          ...parsed.data,
          filePath: fullPath,
          summary: parsed.content.substring(0, 200) + (parsed.content.length > 200 ? '...' : '')
        } as Report);
      } catch (e) {
        // ignore bad files
      }
    }
    
    reports.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (filters?.type) reports = reports.filter(r => r.type === filters.type);
    if (filters?.platform) reports = reports.filter(r => r.author?.platform === filters.platform);
    
    if (filters?.limit && filters.limit > 0) {
      reports = reports.slice(0, filters.limit);
    }
    
    return reports;
  }

  public getRoster(filters?: { search?: string; division?: string }): AgentCard[] {
    if (filters?.search) {
      return this.roster.search(filters.search);
    }
    if (filters?.division) {
      return this.roster.getByDivision(filters.division);
    }
    return this.roster.loadAll();
  }

  public getDivisions(): any {
    return this.roster.getDivisions();
  }

  public divisionIds(): string[] {
    return this.roster.divisionIds();
  }

  public getAgentPersona(slug: string): { name: string; division: string; persona: string } | null {
    return this.roster.getPersona(slug);
  }

  public agentsInDivision(division: string): AgentCard[] {
    return this.roster.getByDivision(division);
  }

  public getDashboard(): DashboardData {
    const activeAgents = this.activeAgents.size;
    const tasks = this.listTasks();
    const pending = tasks.filter(t => t.status === 'pending').length;
    const waitingInput = tasks.filter(t => t.status === 'wait-input').length;
    const inProgress = tasks.filter(t => t.status === 'in-progress' || t.status === 'claimed').length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const failed = tasks.filter(t => t.status === 'done' && (t as any).failed === true).length;
    
    const recentReports = this.listReports({ limit: 5 }).length;
    
    const platformStatus: Record<string, boolean> = {};
    for (const [id, p] of Object.entries(this.config.platforms)) {
      platformStatus[id] = p.enabled;
    }

    return {
      activeAgents,
      inboxSummary: {
        pending,
        waitingInput,
        inProgress,
        completed,
        failed
      },
      recentReports,
      platformStatus,
      rosterCount: this.roster.loadAll().length,
      uptime: Math.floor((Date.now() - this.startTime) / 1000)
    };
  }
}

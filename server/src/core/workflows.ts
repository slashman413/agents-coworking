import fs from 'fs';
import path from 'path';
import { globSync } from 'glob';
import { v4 as uuidv4 } from 'uuid';
import type { Config, WorkflowDef, WorkflowStep, WorkflowRun, Task } from '../types.js';
import type { Store } from './store.js';

/** Fill {{param}} placeholders from the run params (missing → left as-is). */
function interpolate(tpl: string, params: Record<string, string>): string {
  return String(tpl).replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/**
 * Workflows — the declarative pipeline layer that sits on top of the dispatcher's
 * dependsOn DAG. A template (workflows/<id>.json) is validated on load and, on
 * demand, COMPILED into N inbox tasks whose context.dependsOn edges are wired to
 * the real task ids just created. No new execution engine: once expanded, the
 * existing dispatcher walks the DAG exactly as it does for hand-built tasks.
 *
 * Every task a run creates carries three context fields so the UI can group and
 * trace it (zero on-disk schema change — context is already free-form):
 *   workflowId    — which template
 *   workflowRunId — this expansion (one per run)
 *   stepKey       — which node of the template
 */
export class Workflows {
  private config: Config;
  private store: Store;

  constructor(config: Config, store: Store) {
    this.config = config;
    this.store = store;
  }

  private dir(): string {
    return this.config.paths.workflows;
  }

  /** Read + parse + validate every template on disk. Invalid ones are skipped
   *  (with the reason) so one bad file can't take down the whole list. */
  list(): WorkflowDef[] {
    const dir = this.dir();
    if (!fs.existsSync(dir)) return [];
    const out: WorkflowDef[] = [];
    for (const file of globSync('*.json', { cwd: dir })) {
      try {
        const def = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')) as WorkflowDef;
        if (!def.id) def.id = path.basename(file, '.json');
        const errors = this.validate(def);
        if (errors.length) { console.warn(`Workflows: skipping ${file} — ${errors.join('; ')}`); continue; }
        out.push(def);
      } catch (e: any) {
        console.warn(`Workflows: skipping ${file} — ${e.message}`);
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): WorkflowDef | null {
    return this.list().find(w => w.id === id) || null;
  }

  /**
   * Structural validation. Returns a list of human-readable errors ([] = valid):
   * required fields, unique step keys, dependsOn references an existing key, and
   * — critically — the graph is acyclic (a cycle would deadlock depsSatisfied
   * forever, since a task can never reach `done` while it waits on itself).
   */
  validate(def: WorkflowDef): string[] {
    const errors: string[] = [];
    if (!def.id || typeof def.id !== 'string') errors.push('id (string) is required');
    if (!Array.isArray(def.steps) || def.steps.length === 0) { errors.push('steps (non-empty array) is required'); return errors; }
    const keys = new Set<string>();
    for (const s of def.steps) {
      if (!s.key || typeof s.key !== 'string') { errors.push('every step needs a string key'); continue; }
      if (keys.has(s.key)) errors.push(`duplicate step key "${s.key}"`);
      keys.add(s.key);
    }
    for (const s of def.steps) {
      for (const d of s.dependsOn || []) {
        if (!keys.has(d)) errors.push(`step "${s.key}" dependsOn unknown step "${d}"`);
      }
    }
    if (!errors.length) {
      try { this.topoOrder(def.steps); } catch (e: any) { errors.push(e.message); }
    }
    return errors;
  }

  /** Kahn's algorithm → steps in an order where deps precede dependents. Throws
   *  on a cycle. Used both to validate and to create tasks bottom-up so a step's
   *  dependency task ids already exist when we wire its context.dependsOn. */
  private topoOrder(steps: WorkflowStep[]): WorkflowStep[] {
    const byKey = new Map(steps.map(s => [s.key, s]));
    const indeg = new Map(steps.map(s => [s.key, 0]));
    const dependents = new Map<string, string[]>(steps.map(s => [s.key, []]));
    for (const s of steps) {
      for (const d of s.dependsOn || []) {
        indeg.set(s.key, (indeg.get(s.key) || 0) + 1);
        dependents.get(d)!.push(s.key);
      }
    }
    const queue = steps.filter(s => (indeg.get(s.key) || 0) === 0).map(s => s.key);
    const order: WorkflowStep[] = [];
    while (queue.length) {
      const k = queue.shift()!;
      order.push(byKey.get(k)!);
      for (const dep of dependents.get(k)!) {
        indeg.set(dep, indeg.get(dep)! - 1);
        if (indeg.get(dep) === 0) queue.push(dep);
      }
    }
    if (order.length !== steps.length) {
      const stuck = steps.filter(s => !order.includes(s)).map(s => s.key);
      throw new Error(`workflow has a dependency cycle among: ${stuck.join(', ')}`);
    }
    return order;
  }

  /** Resolve a step into the task body that createTask expects (deps still as
   *  step keys — the caller swaps them for real ids). */
  private compileStep(def: WorkflowDef, s: WorkflowStep, params: Record<string, string>) {
    const title = interpolate(s.title || s.key, params);
    const description = interpolate(s.description || s.title || s.key, params);
    return {
      title, description,
      agent: s.agent, division: s.division, brain: s.brain,
      priority: s.priority || 'normal',
      dependsOnKeys: s.dependsOn || []
    };
  }

  /**
   * Expand a template into real inbox tasks (or, for dryRun, just the resolved
   * plan without writing anything — the "inspect before you run" win).
   * Missing required params are rejected up front. runId ties the whole run
   * together for the run-view UI.
   */
  run(id: string, params: Record<string, string> = {}, opts: { dryRun?: boolean; runId?: string } = {}):
    { runId: string; workflowId: string; dryRun: boolean; steps: any[]; tasks?: Task[] } {
    const def = this.get(id);
    if (!def) throw new Error(`unknown workflow "${id}"`);
    const missing = (def.params || []).filter(p => !(p in params) || params[p] === '');
    if (missing.length) throw new Error(`missing required param(s): ${missing.join(', ')}`);

    const order = this.topoOrder(def.steps);
    const runId = opts.runId || cryptoRandomId();

    // Dry run: show the resolved, ordered plan (deps stay as step keys) — no writes.
    if (opts.dryRun) {
      const steps = order.map(s => {
        const c = this.compileStep(def, s, params);
        return { key: s.key, title: c.title, description: c.description, agent: c.agent, division: c.division, brain: c.brain, dependsOn: c.dependsOnKeys };
      });
      return { runId, workflowId: def.id, dryRun: true, steps };
    }

    // Real run: create bottom-up so each step's dependency task ids already exist.
    const keyToTaskId = new Map<string, string>();
    const tasks: Task[] = [];
    for (const s of order) {
      const c = this.compileStep(def, s, params);
      const context: Record<string, any> = { workflowId: def.id, workflowRunId: runId, stepKey: s.key };
      if (c.agent) context.agent = c.agent;
      if (c.division) context.division = c.division;
      if (c.brain) context.brain = c.brain;
      const deps = c.dependsOnKeys.map(k => keyToTaskId.get(k)).filter(Boolean) as string[];
      if (deps.length) context.dependsOn = deps;
      const task = this.store.createTask({
        title: c.title,
        description: c.description,
        from: { platform: 'cowork', agent: 'workflow' },
        to: {},
        priority: c.priority as Task['priority'],
        context,
        tags: ['workflow', def.id]
      });
      keyToTaskId.set(s.key, task.id);
      tasks.push(task);
    }
    console.log(`Workflows: expanded "${def.id}" → run ${runId} (${tasks.length} tasks)`);
    return { runId, workflowId: def.id, dryRun: false, steps: order.map(s => ({ key: s.key })), tasks };
  }

  /** All runs currently on disk, newest first, reconstructed from task context. */
  listRuns(): WorkflowRun[] {
    const byRun = new Map<string, Task[]>();
    for (const t of this.store.listTasks()) {
      const rid = t.context?.workflowRunId;
      if (typeof rid === 'string') (byRun.get(rid) || byRun.set(rid, []).get(rid)!).push(t);
    }
    const runs: WorkflowRun[] = [];
    for (const [runId, tasks] of byRun) {
      tasks.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      runs.push(this.runFromTasks(runId, tasks));
    }
    return runs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getRun(runId: string): WorkflowRun | null {
    const tasks = this.store.listTasks().filter(t => t.context?.workflowRunId === runId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return tasks.length ? this.runFromTasks(runId, tasks) : null;
  }

  private runFromTasks(runId: string, tasks: Task[]): WorkflowRun {
    const failed = tasks.some(t => t.status === 'rejected');
    const allDone = tasks.every(t => t.status === 'done');
    const status: WorkflowRun['status'] = failed ? 'failed' : allDone ? 'done' : 'running';
    return {
      runId,
      workflowId: String(tasks[0]?.context?.workflowId || '?'),
      createdAt: tasks[0]?.createdAt || new Date().toISOString(),
      tasks,
      status
    };
  }
}

/** Short, url-safe run id. Kept here so workflows.ts owns its own id scheme. */
function cryptoRandomId(): string {
  return 'run-' + uuidv4().slice(0, 8);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Dispatcher } from './dispatcher.js';
import { Workflows } from './workflows.js';
import type { Config, Task, WorkflowDef } from '../types.js';

/**
 * These tests exercise the DISPATCHER's orchestrated-workflow driver
 * (`driveWorkflows`) — the glue that turns "the orchestrator decides the next
 * step" into real tasks — WITHOUT spawning any LLM. `askRouter` (the only place
 * a brain is spawned) is stubbed with a scripted sequence of replies, so the
 * decision loop runs deterministically: pick → materialise task → complete →
 * pick again → … → DONE.
 */

class FakeStore {
  tasks: Task[] = [];
  createTask(params: Omit<Task, 'id' | 'status' | 'createdAt'>): Task {
    const task = { ...params, id: uuidv4(), status: 'pending', createdAt: new Date().toISOString() } as Task;
    this.tasks.push(task);
    return task;
  }
  listTasks(): Task[] { return this.tasks; }
  getTask(id: string): Task | null { return this.tasks.find(t => t.id === id) || null; }
}

const adaptive: WorkflowDef = {
  id: 'adaptive',
  mode: 'orchestrated',
  goal: 'answer the question',
  steps: [
    { key: 'scope', title: 'Scope it' },
    { key: 'research', title: 'Research it', dependsOn: ['scope'] },
    { key: 'write', title: 'Write it up', dependsOn: ['research'] }
  ]
};

function harness(replies: string[]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-drv-'));
  const dir = path.join(base, 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'adaptive.json'), JSON.stringify(adaptive));
  const config = {
    paths: { workflows: dir },
    orchestration: { maxWorkflowSteps: 12, classifier: { timeoutMs: 1000 } }
  } as unknown as Config;
  const store = new FakeStore();
  const workflows = new Workflows(config, store as any);
  const dispatcher = new Dispatcher(config, store as any, {} as any, workflows);
  // Stub the (private) brain call with a scripted queue of decisions.
  const queue = [...replies];
  (dispatcher as any).askRouter = async () => queue.shift() ?? 'DONE';
  return { workflows, store, dispatcher };
}

// Let the async decision IIFE inside driveWorkflows settle.
const settle = () => new Promise(r => setTimeout(r, 5));

test('driver dispatches the orchestrator-chosen first step automatically', async () => {
  const { workflows, store, dispatcher } = harness(['scope']);
  const r = workflows.run('adaptive', {});
  (dispatcher as any).driveWorkflows();
  await settle();
  assert.equal(store.tasks.length, 1);
  assert.equal(store.tasks[0].context!.stepKey, 'scope');
  assert.equal(workflows.loadRecord(r.runId)!.history[0].stepKey, 'scope');
});

test('driver waits for the open task before making the next decision', async () => {
  const { workflows, store, dispatcher } = harness(['scope', 'research']);
  workflows.run('adaptive', {});
  (dispatcher as any).driveWorkflows();
  await settle();                       // → scope task (pending)
  (dispatcher as any).driveWorkflows(); // scope still open → no new decision
  await settle();
  assert.equal(store.tasks.length, 1, 'should not dispatch step 2 while step 1 is open');
});

test('driver walks the full adaptive run to completion, wiring deps as it goes', async () => {
  const { workflows, store, dispatcher } = harness(['scope', 'research', 'write', 'DONE']);
  const r = workflows.run('adaptive', {});

  // Simulate the tick loop: decide, then the worker completes the task, repeat.
  for (let i = 0; i < 6; i++) {
    (dispatcher as any).driveWorkflows();
    await settle();
    store.tasks.forEach(t => { if (t.status !== 'done') t.status = 'done'; });
    if (workflows.loadRecord(r.runId)!.status !== 'running') break;
  }

  const rec = workflows.loadRecord(r.runId)!;
  assert.equal(rec.status, 'done');
  assert.deepEqual(rec.history.map(h => h.stepKey), ['scope', 'research', 'write', null]);

  // deps were wired to the real upstream task ids in decision order.
  const byKey = new Map(store.tasks.map(t => [t.context!.stepKey, t]));
  assert.deepEqual(byKey.get('research')!.context!.dependsOn, [byKey.get('scope')!.id]);
  assert.deepEqual(byKey.get('write')!.context!.dependsOn, [byKey.get('research')!.id]);
});

test('driver force-finishes a run that never says DONE at the step cap', async () => {
  // A router that always picks a step (never DONE); the cap must stop it.
  const { workflows, store, dispatcher } = harness([]);
  (dispatcher as any).askRouter = async () => 'scope';  // always the same pick
  (dispatcher as any).config.orchestration.maxWorkflowSteps = 2;
  const r = workflows.run('adaptive', {});

  for (let i = 0; i < 8; i++) {
    (dispatcher as any).driveWorkflows();
    await settle();
    store.tasks.forEach(t => { if (t.status !== 'done') t.status = 'done'; });
    if (workflows.loadRecord(r.runId)!.status !== 'running') break;
  }

  const rec = workflows.loadRecord(r.runId)!;
  assert.equal(rec.status, 'done', 'cap should force the run to finish');
  assert.ok(rec.history.filter(h => h.stepKey).length <= 2, 'never dispatch past the cap');
});

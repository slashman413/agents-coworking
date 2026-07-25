import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { Workflows } from './workflows.js';
import type { Config, Task, WorkflowDef } from '../types.js';

/**
 * In-memory stand-in for Store: Workflows only ever touches createTask + listTasks.
 * Keeping it in memory makes the engine tests fast, deterministic, and free of the
 * filesystem/eventbus machinery the real Store carries.
 */
class FakeStore {
  tasks: Task[] = [];
  createTask(params: Omit<Task, 'id' | 'status' | 'createdAt'>): Task {
    const task = { ...params, id: uuidv4(), status: 'pending', createdAt: new Date().toISOString() } as Task;
    this.tasks.push(task);
    return task;
  }
  listTasks(): Task[] {
    return this.tasks;
  }
}

function makeWorkflows(templates: Record<string, WorkflowDef> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-'));
  for (const [id, def] of Object.entries(templates)) {
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(def));
  }
  const config = { paths: { workflows: dir } } as unknown as Config;
  const store = new FakeStore();
  return { wf: new Workflows(config, store as any), store, dir };
}

const linear: WorkflowDef = {
  id: 'linear',
  params: ['topic'],
  steps: [
    { key: 'a', title: 'Research {{topic}}' },
    { key: 'b', title: 'Draft {{topic}}', dependsOn: ['a'] },
    { key: 'c', title: 'Review {{topic}}', dependsOn: ['b'] }
  ]
};

const diamond: WorkflowDef = {
  id: 'diamond',
  steps: [
    { key: 'root' },
    { key: 'left', dependsOn: ['root'] },
    { key: 'right', dependsOn: ['root'] },
    { key: 'join', dependsOn: ['left', 'right'] }
  ]
};

// ── validation ────────────────────────────────────────────────────────────

test('validate accepts a well-formed DAG', () => {
  const { wf } = makeWorkflows();
  assert.deepEqual(wf.validate(linear), []);
  assert.deepEqual(wf.validate(diamond), []);
});

test('validate rejects empty / missing steps', () => {
  const { wf } = makeWorkflows();
  assert.ok(wf.validate({ id: 'x', steps: [] } as any).some(e => /steps/.test(e)));
  assert.ok(wf.validate({ id: 'x' } as any).some(e => /steps/.test(e)));
});

test('validate rejects duplicate step keys', () => {
  const { wf } = makeWorkflows();
  const errs = wf.validate({ id: 'dup', steps: [{ key: 'a' }, { key: 'a' }] });
  assert.ok(errs.some(e => /duplicate step key "a"/.test(e)));
});

test('validate rejects a dependsOn on an unknown step', () => {
  const { wf } = makeWorkflows();
  const errs = wf.validate({ id: 'bad', steps: [{ key: 'a', dependsOn: ['ghost'] }] });
  assert.ok(errs.some(e => /unknown step "ghost"/.test(e)));
});

test('validate rejects a dependency cycle', () => {
  const { wf } = makeWorkflows();
  const errs = wf.validate({
    id: 'cycle',
    steps: [{ key: 'a', dependsOn: ['b'] }, { key: 'b', dependsOn: ['a'] }]
  });
  assert.ok(errs.some(e => /cycle/.test(e)), `expected a cycle error, got: ${errs.join('; ')}`);
});

// ── list / get (on-disk templates) ──────────────────────────────────────────

test('list loads valid templates and skips invalid ones', () => {
  const { wf } = makeWorkflows({
    linear,
    broken: { id: 'broken', steps: [{ key: 'a', dependsOn: ['nope'] }] }
  });
  const ids = wf.list().map(d => d.id);
  assert.deepEqual(ids, ['linear']); // 'broken' is skipped, not thrown
  assert.equal(wf.get('linear')?.id, 'linear');
  assert.equal(wf.get('broken'), null);
});

test('list defaults a missing id to the filename', () => {
  const { wf, dir } = makeWorkflows();
  fs.writeFileSync(path.join(dir, 'named-by-file.json'), JSON.stringify({ steps: [{ key: 'a' }] }));
  assert.equal(wf.get('named-by-file')?.id, 'named-by-file');
});

// ── dry run ─────────────────────────────────────────────────────────────────

test('dry run interpolates params and writes nothing', () => {
  const { wf, store } = makeWorkflows({ linear });
  const r = wf.run('linear', { topic: 'edge AI' }, { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.equal(store.tasks.length, 0);
  assert.equal(r.steps[0].title, 'Research edge AI');
  // topological: a precedes b precedes c
  assert.deepEqual(r.steps.map((s: any) => s.key), ['a', 'b', 'c']);
});

test('run rejects missing required params', () => {
  const { wf } = makeWorkflows({ linear });
  assert.throws(() => wf.run('linear', {}), /missing required param\(s\): topic/);
});

test('run throws on an unknown workflow', () => {
  const { wf } = makeWorkflows();
  assert.throws(() => wf.run('ghost', {}), /unknown workflow "ghost"/);
});

// ── real expansion → DAG wiring ───────────────────────────────────────────────

test('run creates tasks and wires dependsOn to real task ids', () => {
  const { wf, store } = makeWorkflows({ linear });
  const r = wf.run('linear', { topic: 'edge AI' });
  assert.equal(r.dryRun, false);
  assert.equal(store.tasks.length, 3);

  const byKey = new Map(store.tasks.map(t => [t.context!.stepKey, t]));
  // b depends on a's actual id; c on b's actual id; a on nothing.
  assert.equal(byKey.get('a')!.context!.dependsOn, undefined);
  assert.deepEqual(byKey.get('b')!.context!.dependsOn, [byKey.get('a')!.id]);
  assert.deepEqual(byKey.get('c')!.context!.dependsOn, [byKey.get('b')!.id]);

  // every task is stamped for the run-view grouping
  for (const t of store.tasks) {
    assert.equal(t.context!.workflowId, 'linear');
    assert.equal(t.context!.workflowRunId, r.runId);
    assert.ok(t.tags?.includes('workflow'));
  }
});

test('fan-in step depends on all of its upstream tasks', () => {
  const { wf, store } = makeWorkflows({ diamond });
  wf.run('diamond', {});
  const byKey = new Map(store.tasks.map(t => [t.context!.stepKey, t]));
  const joinDeps = byKey.get('join')!.context!.dependsOn as string[];
  assert.deepEqual(
    [...joinDeps].sort(),
    [byKey.get('left')!.id, byKey.get('right')!.id].sort()
  );
});

// ── run reconstruction from task context ─────────────────────────────────────

test('listRuns / getRun reconstruct a run and derive status', () => {
  const { wf, store } = makeWorkflows({ linear });
  const r = wf.run('linear', { topic: 'edge AI' });

  const runs = wf.listRuns();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].runId, r.runId);
  assert.equal(runs[0].status, 'running'); // all pending → running

  // all done → done
  store.tasks.forEach(t => { t.status = 'done'; });
  assert.equal(wf.getRun(r.runId)!.status, 'done');

  // any rejected → failed (takes precedence over done)
  store.tasks[0].status = 'rejected';
  assert.equal(wf.getRun(r.runId)!.status, 'failed');

  assert.equal(wf.getRun('run-does-not-exist'), null);
});

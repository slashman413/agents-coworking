import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Store } from './store.js';
import { EventBus } from './events.js';
import type { Config } from '../types.js';

/**
 * Coverage for CONTINUE: a done, successful task spawns a follow-up task seeded
 * with the finished run's OUTPUTS (its result + every artifact) as INPUTS,
 * pinned to the same executor. Failed/unfinished tasks are refused (they use
 * rerunTask instead).
 */
function makeStore(): { store: Store; root: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cowork-continue-'));
  const paths = {
    inbox: path.join(root, 'inbox'),
    reports: path.join(root, 'reports'),
    status: path.join(root, 'status'),
    decisions: path.join(root, 'decisions'),
    workflows: path.join(root, 'workflows'),
    agencyAgents: path.join(root, 'agency-agents'),
  };
  for (const p of Object.values(paths)) fs.mkdirSync(p, { recursive: true });
  const config = { paths, orchestration: { brains: {} } } as unknown as Config;
  return { store: new Store(config, new EventBus()), root };
}

/** Write files into a done task's artifacts dir (artifacts/<id>/), as the dispatcher would. */
function seedArtifacts(root: string, taskId: string, files: Record<string, string>): void {
  const dir = path.join(root, 'artifacts', taskId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
}

test('continueTask seeds the follow-up with the prior result + artifacts as inputs', async () => {
  const { store, root } = makeStore();
  const orig = store.createTask({
    title: 'Draft the architecture',
    description: 'Design the netcode.',
    from: { platform: 'p', agent: 'a' },
    priority: 'high',
    context: { ranAgent: 'software-architect', ranDivision: 'engineering', ranBrain: 'remote-opus' }
  } as any);
  seedArtifacts(root, orig.id, { 'architecture.md': '# arch\nlots of detail', 'diagram.svg': '<svg/>' });
  await store.completeTask({ taskId: orig.id, result: 'Here is the architecture blueprint.', internal: true });

  const next = store.continueTask(orig.id)!;
  assert.ok(next, 'a done success is continuable');
  assert.equal(next.status, 'pending');
  assert.notEqual(next.id, orig.id, 'a NEW task is created');
  assert.match(next.title, /^Continue: Draft the architecture$/);
  assert.equal(next.priority, 'high', 'priority carried over');

  // Executor pin follows what actually ran.
  assert.equal(next.context?.agent, 'software-architect');
  assert.equal(next.context?.division, 'engineering');
  assert.equal(next.context?.brain, 'remote-opus');
  assert.equal(next.context?.continuedFrom, orig.id);

  // Prior outputs land as inputs on disk + on context.inputFiles.
  const inputs = store.listInputs(next.id).sort();
  assert.deepEqual(inputs, ['architecture.md', 'diagram.svg', 'previous-result.md']);
  assert.deepEqual((next.context?.inputFiles as string[]).slice().sort(),
    ['architecture.md', 'diagram.svg', 'previous-result.md']);
  const rp = store.inputFilePath(next.id, 'previous-result.md');
  assert.ok(rp && /architecture blueprint/.test(fs.readFileSync(rp, 'utf8')), 'result body captured');
  const ap = store.inputFilePath(next.id, 'architecture.md');
  assert.ok(ap && fs.readFileSync(ap, 'utf8') === '# arch\nlots of detail', 'artifact copied verbatim');
});

test('continueTask works with no artifacts (result only) and does not double-prefix the title', async () => {
  const { store } = makeStore();
  const orig = store.createTask({ title: 'Continue: keep going', from: { platform: 'p', agent: 'a' } } as any);
  await store.completeTask({ taskId: orig.id, result: 'progress so far', internal: true });
  const next = store.continueTask(orig.id)!;
  assert.equal(next.title, 'Continue: keep going', 'existing Continue: prefix is not doubled');
  assert.deepEqual(store.listInputs(next.id), ['previous-result.md']);
});

test('continueTask refuses a failed (chain-exhausted) task — that path is rerun, not continue', async () => {
  const { store } = makeStore();
  const bad = store.createTask({ title: 'nope', from: { platform: 'p', agent: 'a' } } as any);
  await store.completeTask({
    taskId: bad.id,
    result: 'FAILED after 3 attempt(s) (chain exhausted). Brains that failed: x. Last output: limit',
    internal: true
  });
  assert.equal(store.continueTask(bad.id), null, 'a failed task is not continuable');
});

test('continueTask refuses an unfinished task and a missing task', () => {
  const { store } = makeStore();
  const pending = store.createTask({ title: 'still going', from: { platform: 'p', agent: 'a' } } as any);
  assert.equal(store.continueTask(pending.id), null, 'a pending task is not continuable');
  assert.equal(store.continueTask('does-not-exist'), null, 'a missing task returns null');
});

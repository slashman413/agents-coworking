#!/usr/bin/env node
// remote-brain-client — a zero-dependency Cowork MCP client that turns a machine
// into one or more "remote brains". It connects to the Cowork MCP server,
// registers (declaring the brains it can run, which the server auto-adds to its
// registry), then polls the shared inbox for tasks addressed to ANY of its
// brains, claims them, runs the matching local model, and reports results back.
//
// Zero-config by default: run `COWORK_URL=http://<host>:6868 node remote-brain-client.mjs`
// and the client AUTO-DETECTS the model CLIs installed here (claude/hermes/agy) and
// declares the matching brains in its registration handshake — no brain env needed.
// Override the auto default with any of (first that is set wins):
//
//   Preset — one flag, standard model set for a platform:
//     PRESET=claude  HOST=aicodegen          # → deploy/presets/claude.json:
//       remote-aicodegen-cc-opus (claude-opus-4-8), -cc-sonnet (claude-sonnet-5),
//       -cc-fable (claude-fable-5), -cc-default (account default)
//     PRESET=hermes  HOST=box2               # → qwen35b / qwen27b / deepseek
//     (BRAINS_FILE=/path/to/list.json also works; {HOST} is substituted.)
//
//   Multiple explicit — one client, several models:
//     BRAINS='[{"id":"remote-aicodegen-cc-opus","model":"claude-opus-4-8"},
//              {"id":"remote-aicodegen-cc-sonnet","model":"claude-sonnet-5"},
//              {"id":"remote-aicodegen-cc-fable","model":"claude-fable-5"}]'
//     EXEC=claude            # default exec for brains that don't set their own
//     HOST=aicodegen         # default host label
//
//   Single (simplest):
//     BRAIN_ID=remote-aicodegen-cc-fable  EXEC=claude  MODEL=claude-fable-5
//
//   COWORK_URL       cowork server base, e.g. http://<cowork-host>:6868   (required)
//   COWORK_API_KEY   bearer token if the server sets server.apiKey       (optional)
//   POLL_MS          inbox poll interval                                 (default 5000)
//   MAX_CONCURRENT   tasks in parallel across all brains                 (default 1)
//   TASK_TIMEOUT_MS  per-task wall clock                                 (default 1800000)
//   AGENT_NAME       display name in Active Agents                       (default HOST/host)
//
// Node 18+ (global fetch). No npm install. Run: `node remote-brain-client.mjs`.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));

const URL_BASE = need('COWORK_URL').replace(/\/$/, '');
const API_KEY = process.env.COWORK_API_KEY || '';
const EXEC_DEFAULT = process.env.EXEC || 'claude';
const HOST = process.env.HOST || os.hostname();
const POLL_MS = +(process.env.POLL_MS || 5000);
const MAX_CONCURRENT = +(process.env.MAX_CONCURRENT || 1);
const TASK_TIMEOUT_MS = +(process.env.TASK_TIMEOUT_MS || 1800000);

// Resolve the brain list. Precedence:
//   PRESET → BRAINS_FILE → BRAINS → BRAIN_ID → AUTO-DETECT (default).
// AUTO-DETECT means you can just run `COWORK_URL=… node remote-brain-client.mjs`:
// the client looks for installed model CLIs (claude / hermes / agy) and declares
// the matching preset for each — so it propagates its own capabilities on connect
// with zero config. Env vars only override the auto default. {HOST} is substituted.
const PRESET_DIR = join(HERE, 'presets');
function loadJsonWithHost(raw) { return JSON.parse(raw.split('{HOST}').join(HOST)); }
function preset(name) { return loadJsonWithHost(readFileSync(join(PRESET_DIR, `${name}.json`), 'utf8')); }
function hasCli(cli) { return spawnSync('sh', ['-c', `command -v ${cli}`], { stdio: 'ignore' }).status === 0; }

let BRAINS;
if (process.env.PRESET) {
  BRAINS = preset(process.env.PRESET);
} else if (process.env.BRAINS_FILE) {
  BRAINS = loadJsonWithHost(readFileSync(process.env.BRAINS_FILE, 'utf8'));
} else if (process.env.BRAINS) {
  BRAINS = loadJsonWithHost(process.env.BRAINS);
} else if (process.env.BRAIN_ID) {
  BRAINS = [{ id: process.env.BRAIN_ID, exec: EXEC_DEFAULT, model: process.env.MODEL || '' }];
} else {
  // Auto-detect: declare a preset for every model CLI on PATH.
  BRAINS = [];
  for (const [cli, name] of [['claude', 'claude'], ['hermes', 'hermes'], ['agy', 'agy'], ['codex', 'codex']]) {
    if (hasCli(cli)) BRAINS.push(...preset(name));
  }
  // Ollama has no fixed model set — enumerate the pulled CHAT models (skip embedders).
  if (hasCli('ollama')) {
    const out = spawnSync('ollama', ['list'], { encoding: 'utf8' }).stdout || '';
    for (const line of out.split('\n').slice(1)) {
      const name = line.split(/\s+/)[0];
      if (!name || /embed/i.test(name)) continue;   // skip embedding-only models
      BRAINS.push({ id: `remote-{HOST}-ollama-${name.replace(/[:/]/g, '-')}`.split('{HOST}').join(HOST), exec: 'ollama', model: name });
    }
  }
  if (!BRAINS.length) {
    console.error('Auto-detect found no usable model CLI (claude/hermes/agy/codex, or an Ollama chat model) on PATH.\n' +
      'Install one, or declare brains explicitly: PRESET=<name> | BRAINS_FILE=path | BRAINS=<json> | BRAIN_ID=<id>.');
    process.exit(2);
  }
  console.log(`[auto-detect] declaring brains for: ${[...new Set(BRAINS.map(b => b.exec))].join(', ')}`);
}
const BRAIN = Object.fromEntries(BRAINS.map(b => [b.id, {
  id: b.id, exec: b.exec || EXEC_DEFAULT, model: b.model || '',
  location: b.location || 'remote', host: b.host || HOST
}]));
const MY_IDS = new Set(Object.keys(BRAIN));
const AGENT_NAME = process.env.AGENT_NAME || `remote-${HOST}`;
// Registration platform reflects the declared brains (a box may be claude-only,
// hermes-only, or mixed). Derive from the first brain's exec.
const execToPlatform = e => e === 'claude' ? 'claude' : e === 'agy' ? 'antigravity' : 'hermes';
const PLATFORM = execToPlatform(Object.values(BRAIN)[0]?.exec || EXEC_DEFAULT);

function need(k) { const v = process.env[k]; if (!v) { console.error(`Missing required env ${k}`); process.exit(2); } return v; }
const OSC_CSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
// Ollama's CLI redraws wrapped words even to a pipe as `<chars>ESC[<N>DESC[K`;
// that sequence means "delete the previous N chars", so apply it, then drop any
// remaining escape sequences and carriage returns.
function stripAnsi(s) {
  return s.replace(/(.{0,200}?)\x1b\[(\d+)D\x1b\[K/gs, (_m, pre, n) => pre.slice(0, Math.max(0, pre.length - Number(n))))
          .replace(OSC_CSI_RE, '').replace(/\r/g, '');
}

let sessionId = null, rpcId = 0;
const running = new Set();

// ── Minimal MCP client over the streamable-HTTP transport ────────────────────
async function rpc(method, params) {
  const headers = {
    'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
  };
  const res = await fetch(`${URL_BASE}/mcp`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const sid = res.headers.get('mcp-session-id'); if (sid) sessionId = sid;
  const text = await res.text();
  if (method === 'notifications/initialized') return null;
  const line = text.split('\n').find(l => l.startsWith('data:')) || text;
  const payload = JSON.parse(line.replace(/^data:\s*/, ''));
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}
async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r?.content?.[0]?.text; if (t == null) return r;
  try { return JSON.parse(t); } catch { return t; }
}
async function connect() {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: `remote-brain:${AGENT_NAME}`, version: '1.0' } });
  await rpc('notifications/initialized');
}

// ── Task execution ───────────────────────────────────────────────────────────
function buildPrompt(task, artDir, inputInfo) {
  const ctx = task.context || {};
  const persona = ctx.persona;   // roster agent's full .md persona (stamped by the dispatcher)
  const role = ctx.agent || ctx.role || 'agent';
  const lines = persona
    ? [persona, ``, `---`, ``, `You have been assigned the following task. Work autonomously and produce your final deliverable as plain text (markdown allowed).`, ``,
       `# Task: ${task.title}`, ``, task.description, ``]
    : [`You are the "${role}" agent (brain: ${ctx.brain}) in a multi-agent company. Work autonomously and produce your final deliverable as plain-text output.`,
       ``, `# Task: ${task.title}`, ``, task.description, ``];
  // Surface user-supplied context, minus the persona + dispatcher bookkeeping (avoid noise/dupes).
  // inputFiles is rendered as its own section with local paths (below).
  const shown = { ...ctx };
  for (const k of ['persona', 'brainAuto', 'remoteWaitSince', 'dispatched', 'attempts', 'agentName', 'ranAgent', 'ranDivision', 'ranBrain', 'isRoster', 'inputFiles']) delete shown[k];
  if (Object.keys(shown).length) lines.push('# Context', '```json', JSON.stringify(shown, null, 2), '```', '');
  if (inputInfo && inputInfo.files.length) {
    lines.push('# Attached input files',
      'The requester attached these files for you to read (downloaded to your machine):',
      ...inputInfo.files.map(f => `- ${join(inputInfo.dir, f)}`), '');
  }
  lines.push(
    `If you generate any files (reports, media, data), save them to the directory: ${artDir} (also in $COWORK_ARTIFACTS_DIR) — they are uploaded to the dashboard as downloadable artifacts when the task completes.`,
    'Your final stdout becomes the task result shown on the dashboard.');
  return lines.join('\n');
}
function runModel(brain, prompt, artDir) {
  const argv = brain.exec === 'claude' ? ['claude', '-p', prompt, ...(brain.model ? ['--model', brain.model] : []), '--dangerously-skip-permissions']
    : brain.exec === 'hermes' ? ['hermes', ...(brain.model ? ['-m', brain.model] : []), '-z', prompt]
    : brain.exec === 'agy' ? ['agy', '-p', prompt]
    : brain.exec === 'codex' ? ['codex', 'exec', ...(brain.model ? ['-m', brain.model] : []), prompt]
    : brain.exec === 'ollama' ? (brain.model ? ['ollama', 'run', brain.model, prompt] : null)
    : null;
  if (!argv) return Promise.resolve({ ok: false, text: `unknown/misconfigured exec ${brain.exec}` });
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COWORK_ARTIFACTS_DIR: artDir } });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ ok: false, text: `TIMEOUT\n${out}\n${err}` }); }, TASK_TIMEOUT_MS);
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, text: `SPAWN ERROR: ${e.message}` }); });
    child.on('close', code => {
      clearTimeout(timer);
      const clean = stripAnsi(out).trim();
      resolve({ ok: code === 0 && !!clean, text: clean || stripAnsi(err).trim() || `exit ${code}` });
    });
  });
}
// Upload every file the model dropped in artDir to the server's per-task
// artifacts dir (raw binary POST), so the web UI can serve them for download.
async function uploadArtifacts(taskId, artDir) {
  let files = [];
  try { files = readdirSync(artDir).filter(f => { try { return statSync(join(artDir, f)).isFile(); } catch { return false; } }); }
  catch { return 0; }
  let n = 0;
  for (const f of files) {
    try {
      const res = await fetch(`${URL_BASE}/api/artifacts/${encodeURIComponent(taskId)}/${encodeURIComponent(f)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
        body: readFileSync(join(artDir, f))
      });
      if (res.ok) { n++; } else { console.error(`[${AGENT_NAME}] artifact ${f} upload → HTTP ${res.status}`); }
    } catch (e) { console.error(`[${AGENT_NAME}] artifact ${f} upload failed:`, e.message); }
  }
  return n;
}
// Download the task's attached input files (files a person uploaded for the brain
// to read) into a dedicated dir — kept OUT of artDir so they aren't re-uploaded as
// output artifacts. Returns { dir, files } for buildPrompt to point the model at.
async function downloadInputs(taskId) {
  const dir = join(os.tmpdir(), 'cowork-inputs', taskId);
  let names = [];
  try {
    const res = await fetch(`${URL_BASE}/api/inputs/${encodeURIComponent(taskId)}`, {
      headers: { ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) }
    });
    if (res.ok) names = await res.json();
  } catch { return { dir, files: [] }; }
  if (!Array.isArray(names) || !names.length) return { dir, files: [] };
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const f of names) {
    try {
      const r = await fetch(`${URL_BASE}/api/inputs/${encodeURIComponent(taskId)}/${encodeURIComponent(f)}`, {
        headers: { ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) }
      });
      if (!r.ok) { console.error(`[${AGENT_NAME}] input ${f} download → HTTP ${r.status}`); continue; }
      writeFileSync(join(dir, f), Buffer.from(await r.arrayBuffer()));
      files.push(f);
    } catch (e) { console.error(`[${AGENT_NAME}] input ${f} download failed:`, e.message); }
  }
  return { dir, files };
}
async function handle(task, agentId) {
  const brain = BRAIN[task.context.brain];
  running.add(task.id);
  const artDir = join(os.tmpdir(), 'cowork-artifacts', task.id);
  const inputDir = join(os.tmpdir(), 'cowork-inputs', task.id);
  mkdirSync(artDir, { recursive: true });
  console.log(`[${AGENT_NAME}] claimed ${task.id} on ${brain.id} — ${task.title}`);
  try {
    await tool('heartbeat', { agent_id: agentId, status: 'working', current_task: task.title });
    const inputInfo = await downloadInputs(task.id);
    if (inputInfo.files.length) console.log(`[${AGENT_NAME}] downloaded ${inputInfo.files.length} input file(s) for ${task.id}`);
    const { ok, text } = await runModel(brain, buildPrompt(task, artDir, inputInfo), artDir);
    const uploaded = await uploadArtifacts(task.id, artDir);
    if (uploaded) console.log(`[${AGENT_NAME}] uploaded ${uploaded} artifact(s) for ${task.id}`);
    let reportPath;
    try {
      const rep = await tool('file_report', { task_id: task.id, title: `[${brain.id}] ${task.title}`, type: 'task-output', author_platform: PLATFORM, author_agent: brain.id, content: text, status: ok ? 'final' : 'draft', tags: [brain.id, 'remote-brain', ok ? 'success' : 'failed'] });
      reportPath = rep?.filePath;
    } catch (e) { console.error(`[${AGENT_NAME}] file_report failed:`, e.message); }
    const result = ok ? (text.length > 2000 ? text.slice(0, 2000) + '\n…(full output in report)' : text) : `FAILED on ${brain.id}: ${text.slice(0, 1000)}`;
    await tool('complete_task', { task_id: task.id, result, ...(reportPath ? { report_path: reportPath } : {}) });
    console.log(`[${AGENT_NAME}] ${ok ? 'completed' : 'FAILED'} ${task.id}`);
  } catch (e) {
    console.error(`[${AGENT_NAME}] error on ${task.id}:`, e.message);
  } finally {
    running.delete(task.id);
    try { rmSync(artDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    try { rmSync(inputDir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
    await tool('heartbeat', { agent_id: agentId, status: running.size ? 'working' : 'idle' }).catch(() => {});
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  await connect();
  const me = await tool('register_agent', {
    platform: PLATFORM, agent_name: AGENT_NAME, capabilities: [...MY_IDS],
    brains: Object.values(BRAIN).map(b => ({ id: b.id, location: b.location, exec: b.exec, model: b.model, host: b.host }))
  });
  const agentId = me.id;
  console.log(`[${AGENT_NAME}] registered as ${agentId} → ${URL_BASE}; serving brains: ${[...MY_IDS].join(', ')} (concurrency ${MAX_CONCURRENT})`);

  for (;;) {
    try {
      await tool('heartbeat', { agent_id: agentId, status: running.size ? 'working' : 'idle' });
      if (running.size < MAX_CONCURRENT) {
        const inbox = await tool('list_inbox', { status: 'pending', limit: 50 });
        const mine = (Array.isArray(inbox) ? inbox : []).filter(t => MY_IDS.has(t?.context?.brain) && !running.has(t.id));
        for (const task of mine.reverse()) {
          if (running.size >= MAX_CONCURRENT) break;
          const claimed = await tool('claim_task', { task_id: task.id, agent_id: agentId }).catch(() => null);
          if (claimed && claimed.status === 'in-progress' && claimed.claimedBy === agentId) handle(claimed, agentId);
        }
      }
    } catch (e) {
      console.error(`[${AGENT_NAME}] loop error:`, e.message);
      sessionId = null; try { await connect(); } catch { /* retry next tick */ }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}
main().catch(e => { console.error('fatal:', e); process.exit(1); });

#!/usr/bin/env node
// remote-brain-client — a zero-dependency Cowork MCP client that lets a machine
// serve as a "remote brain": it connects to the Cowork MCP server, registers,
// then polls the shared inbox for tasks addressed to ITS brain id, claims them,
// runs the local model CLI, and reports results back.
//
// Fully config-driven via env (nothing hard-coded) — the SAME script serves any
// brain on any machine by changing COWORK_URL / BRAIN_ID / EXEC / MODEL:
//
//   COWORK_URL        cowork server base, e.g. http://100.80.243.33:4200   (required)
//   BRAIN_ID          this machine's brain alias, e.g. remote-aicodegen-cc-fable (required)
//   COWORK_API_KEY    bearer token, if the server has server.apiKey set     (optional)
//   EXEC              claude | hermes | agy                                 (default claude)
//   MODEL             model id for EXEC (e.g. claude-fable-5)               (default '')
//   POLL_MS           inbox poll interval                                   (default 5000)
//   MAX_CONCURRENT    tasks to run in parallel                             (default 1)
//   TASK_TIMEOUT_MS   per-task wall clock                                   (default 1800000)
//   AGENT_NAME        display name in Active Agents                        (default BRAIN_ID)
//
// Node 18+ (global fetch). No npm install. Run: `node remote-brain-client.mjs`.

import { spawn } from 'node:child_process';

const URL_BASE = need('COWORK_URL').replace(/\/$/, '');
const BRAIN_ID = need('BRAIN_ID');
const API_KEY = process.env.COWORK_API_KEY || '';
const EXEC = process.env.EXEC || 'claude';
const MODEL = process.env.MODEL || '';
const POLL_MS = +(process.env.POLL_MS || 5000);
const MAX_CONCURRENT = +(process.env.MAX_CONCURRENT || 1);
const TASK_TIMEOUT_MS = +(process.env.TASK_TIMEOUT_MS || 1800000);
const AGENT_NAME = process.env.AGENT_NAME || BRAIN_ID;
const PLATFORM = EXEC === 'claude' ? 'claude' : EXEC === 'agy' ? 'antigravity' : 'hermes';

function need(k) { const v = process.env[k]; if (!v) { console.error(`Missing required env ${k}`); process.exit(2); } return v; }

let sessionId = null;
let rpcId = 0;
const running = new Set();

// ── Minimal MCP client over the streamable-HTTP transport ────────────────────
async function rpc(method, params) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {})
  };
  const res = await fetch(`${URL_BASE}/mcp`, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params })
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  if (method === 'notifications/initialized') return null;      // notification: no response body
  // Responses may be plain JSON or SSE-framed ("event: message\ndata: {…}").
  const line = text.split('\n').find(l => l.startsWith('data:')) || text;
  const payload = JSON.parse(line.replace(/^data:\s*/, ''));
  if (payload.error) throw new Error(`${method}: ${JSON.stringify(payload.error)}`);
  return payload.result;
}

async function tool(name, args = {}) {
  const r = await rpc('tools/call', { name, arguments: args });
  const t = r?.content?.[0]?.text;
  if (t == null) return r;
  try { return JSON.parse(t); } catch { return t; }
}

async function connect() {
  await rpc('initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: `remote-brain:${BRAIN_ID}`, version: '1.0' }
  });
  await rpc('notifications/initialized');
}

// ── Task execution ───────────────────────────────────────────────────────────
function buildPrompt(task) {
  const role = task.context?.role || 'agent';
  const lines = [
    `You are the "${role}" agent (brain: ${BRAIN_ID}) in a multi-agent company. Work autonomously and produce your final deliverable as plain-text output.`,
    ``, `# Task: ${task.title}`, ``, task.description, ``
  ];
  if (task.context && Object.keys(task.context).length) {
    lines.push('# Context', '```json', JSON.stringify(task.context, null, 2), '```', '');
  }
  lines.push('Your final stdout becomes the task result shown on the dashboard.');
  return lines.join('\n');
}

function runModel(prompt) {
  const argv = EXEC === 'claude' ? ['claude', '-p', prompt, ...(MODEL ? ['--model', MODEL] : []), '--dangerously-skip-permissions']
    : EXEC === 'hermes' ? ['hermes', ...(MODEL ? ['-m', MODEL] : []), '-z', prompt]
    : EXEC === 'agy' ? ['agy', '-p', prompt]
    : null;
  if (!argv) return Promise.resolve({ ok: false, text: `unknown EXEC ${EXEC}` });
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve({ ok: false, text: `TIMEOUT\n${out}\n${err}` }); }, TASK_TIMEOUT_MS);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, text: `SPAWN ERROR: ${e.message}` }); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0 && !!out.trim(), text: out.trim() || err.trim() || `exit ${code}` }); });
  });
}

async function handle(task, agentId) {
  running.add(task.id);
  console.log(`[${BRAIN_ID}] claimed ${task.id} — ${task.title}`);
  try {
    await tool('heartbeat', { agent_id: agentId, status: 'working', current_task: task.title });
    const { ok, text } = await runModel(buildPrompt(task));
    let reportPath;
    try {
      const rep = await tool('file_report', {
        title: `[${BRAIN_ID}] ${task.title}`, type: 'task-output',
        author_platform: PLATFORM, author_agent: AGENT_NAME, content: text,
        status: ok ? 'final' : 'draft', tags: [BRAIN_ID, 'remote-brain', ok ? 'success' : 'failed']
      });
      reportPath = rep?.filePath;
    } catch (e) { console.error(`[${BRAIN_ID}] file_report failed:`, e.message); }
    const result = ok ? (text.length > 2000 ? text.slice(0, 2000) + '\n…(full output in report)' : text)
                      : `FAILED on ${BRAIN_ID}: ${text.slice(0, 1000)}`;
    await tool('complete_task', { task_id: task.id, result, ...(reportPath ? { report_path: reportPath } : {}) });
    console.log(`[${BRAIN_ID}] ${ok ? 'completed' : 'FAILED'} ${task.id}`);
  } catch (e) {
    console.error(`[${BRAIN_ID}] error on ${task.id}:`, e.message);
  } finally {
    running.delete(task.id);
    await tool('heartbeat', { agent_id: agentId, status: running.size ? 'working' : 'idle' }).catch(() => {});
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  await connect();
  const me = await tool('register_agent', { platform: PLATFORM, agent_name: AGENT_NAME, capabilities: [BRAIN_ID] });
  const agentId = me.id;
  console.log(`[${BRAIN_ID}] registered as ${agentId} → ${URL_BASE} (EXEC=${EXEC} MODEL=${MODEL || 'default'}, concurrency ${MAX_CONCURRENT})`);

  for (;;) {
    try {
      await tool('heartbeat', { agent_id: agentId, status: running.size ? 'working' : 'idle' });
      if (running.size < MAX_CONCURRENT) {
        const inbox = await tool('list_inbox', { status: 'pending', limit: 50 });
        const mine = (Array.isArray(inbox) ? inbox : []).filter(t => t?.context?.brain === BRAIN_ID && !running.has(t.id));
        for (const task of mine.reverse()) {           // oldest first
          if (running.size >= MAX_CONCURRENT) break;
          const claimed = await tool('claim_task', { task_id: task.id, agent_id: agentId }).catch(() => null);
          // atomic claim: only the winner gets status in-progress + claimedBy==me
          if (claimed && claimed.status === 'in-progress' && claimed.claimedBy === agentId) {
            handle(claimed, agentId);                   // fire-and-forget
          }
        }
      }
    } catch (e) {
      console.error(`[${BRAIN_ID}] loop error:`, e.message);
      sessionId = null;                                 // force re-handshake on next tick
      try { await connect(); } catch { /* retry next tick */ }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });

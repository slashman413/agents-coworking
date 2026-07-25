import express from 'express';
import path from 'path';
import fs from 'fs';
import { loadConfig, persistRegistries, removeBrainCascade } from './config.js';
import { EventBus } from './core/events.js';
import { Store } from './core/store.js';
import { Dispatcher } from './core/dispatcher.js';
import { createMcpServer } from './mcp/server.js';
import { createApiRouter } from './api/router.js';
import { createWorkflowRouter } from './api/workflows.js';
import { createSSEHandler } from './api/sse.js';
import { Workflows } from './core/workflows.js';

async function main() {
  const config = loadConfig();
  const eventBus = new EventBus();
  const store = new Store(config, eventBus);

  store.initialize();

  const app = express();
  app.use(express.json());

  // Optional API-key auth: guards /api and /mcp when server.apiKey is set.
  // Accepts "Authorization: Bearer <key>", "X-API-Key: <key>", or "?apiKey=<key>"
  // (query form exists for browser EventSource, which can't set headers).
  if (config.server.apiKey) {
    const requireKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const header = req.headers.authorization;
      const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
      const provided = bearer || (req.headers['x-api-key'] as string) || (req.query.apiKey as string);
      if (provided !== config.server.apiKey) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    };
    app.use('/api', requireKey);
    app.use('/mcp', requireKey);
    console.log('API key auth: enabled');
  }

  // SSE
  app.get('/api/events', createSSEHandler(eventBus));

  // REST API
  const apiRouter = createApiRouter(store, eventBus);
  app.use('/api', apiRouter);

  // Declarative workflows: templates in paths.workflows compiled into DAG tasks.
  if (!fs.existsSync(config.paths.workflows)) {
    try { fs.mkdirSync(config.paths.workflows, { recursive: true }); } catch { /* ignore */ }
  }
  const workflows = new Workflows(config, store);
  app.use('/api', createWorkflowRouter(workflows));

  // MCP Server
  const mcpServer = createMcpServer(config, store, eventBus);

  const mcpHandler = async (req: express.Request, res: express.Response) => {
    try {
      await mcpServer.handleRequest(req, res);
    } catch (e) {
      console.error('MCP Server error:', e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null
        });
      }
    }
  };
  app.post('/mcp', mcpHandler);
  app.get('/mcp', mcpHandler);

  // Serve static files — resolve relative to this file so the working
  // directory doesn't matter (systemd, cron, etc.)
  const publicDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  } else {
    console.warn(`Public dir ${publicDir} not found, skipping static file serving.`);
  }

  const httpServer = app.listen(config.server.port, config.server.host, () => {
    console.log(`=========================================`);
    console.log(` Multi-Agent Cowork MCP Server Started`);
    console.log(` HTTP API: http://${config.server.host}:${config.server.port}/api`);
    console.log(` MCP Endpoint: http://${config.server.host}:${config.server.port}/mcp`);
    console.log(` SSE Stream: http://${config.server.host}:${config.server.port}/api/events`);
    console.log(`=========================================`);
  });

  // Stale agent cleanup every 5 minutes, 10 min timeout (600000ms)
  const cleanup = setInterval(() => {
    store.removeStaleAgents(600000);
  }, 300000);

  // Dispatcher: executes role-tagged inbox tasks by spawning platform CLIs
  const dispatcher = new Dispatcher(config, store, eventBus);
  dispatcher.start();
  app.get('/api/dispatcher', (_req, res) => {
    res.json({
      enabled: config.orchestration.enabled,
      agents: config.orchestration.agents || {},
      brains: config.orchestration.brains || {},
      defaultChain: config.orchestration.defaultChain || [],
      divisionChains: config.orchestration.divisionChains || {},
      running: dispatcher.getRunning()
    });
  });

  // ── Brain fallback chains (global default + per-division overrides) ─────────
  app.get('/api/chains', (_req, res) => res.json({
    defaultChain: config.orchestration.defaultChain || [],
    divisionChains: config.orchestration.divisionChains || {}
  }));

  const validChain = (brains: any): string[] => {
    if (!Array.isArray(brains)) throw new Error('brains (string[]) required');
    const reg = config.orchestration.brains || {};
    const bad = brains.filter((b: string) => !reg[b]);
    if (bad.length) throw new Error(`unknown brain(s): ${bad.join(', ')}`);
    return brains;
  };
  app.put('/api/chains/default', (req, res) => {
    try {
      config.orchestration.defaultChain = validChain(req.body?.brains);
      persistRegistries(config);
      res.json({ ok: true, defaultChain: config.orchestration.defaultChain });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });
  app.put('/api/chains/division/:division', (req, res) => {
    try {
      config.orchestration.divisionChains = config.orchestration.divisionChains || {};
      const brains = validChain(req.body?.brains);
      if (brains.length) config.orchestration.divisionChains[req.params.division] = brains;
      else delete config.orchestration.divisionChains[req.params.division];   // empty = use default
      persistRegistries(config);
      res.json({ ok: true, division: req.params.division, brains });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ── Roster grouped by division (for the Agents view) ───────────────────────
  app.get('/api/roster-divisions', (_req, res) => {
    const roster = store.getRoster();
    const meta = store.getDivisions() || {};
    const byDiv: Record<string, any> = {};
    for (const a of roster) {
      const d = a.division || 'other';
      (byDiv[d] ||= { label: meta[d]?.label || d, icon: meta[d]?.icon, color: meta[d]?.color, agents: [] }).agents.push({ slug: a.slug, name: a.name, description: a.description, emoji: a.emoji });
    }
    res.json(byDiv);
  });

  // ── Connections: external MCP clients (heartbeat-live) + invocation counters ─
  app.get('/api/connections', (_req, res) => {
    const now = Date.now();
    const clients = store.getActiveAgents()
      .filter(a => a.sessionId !== 'dispatcher-worker' && !(a.platform === 'cowork' && a.agentName === 'orchestrator'))
      .map(a => ({
        id: a.id, agentName: a.agentName, platform: a.platform, status: a.status,
        capabilities: a.capabilities || [], registeredAt: a.registeredAt, lastHeartbeat: a.lastHeartbeat,
        live: now - new Date(a.lastHeartbeat).getTime() < 600000
      }));
    res.json({ clients, counters: store.getCounters() });
  });

  // ── Task artifacts (persistent per-task dir; downloadable) ─────────────────
  const artifactsRoot = path.resolve(config.paths.reports, '..', 'artifacts');
  app.get('/api/artifacts/:taskId', (req, res) => {
    const dir = path.join(artifactsRoot, path.basename(req.params.taskId));
    if (!fs.existsSync(dir)) return res.json([]);
    res.json(fs.readdirSync(dir).filter(f => { try { return fs.statSync(path.join(dir, f)).isFile(); } catch { return false; } }));
  });
  app.get('/api/artifacts/:taskId/:file', (req, res) => {
    // basename() on both segments blocks path traversal.
    const file = path.join(artifactsRoot, path.basename(req.params.taskId), path.basename(req.params.file));
    if (!file.startsWith(artifactsRoot) || !fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    res.download(file);
  });
  // Upload — a REMOTE brain client pushes each file it produced into the task's
  // artifacts dir (the local dispatcher collects them from disk instead). Raw
  // binary body so any size/type streams; path-guarded; stamps task.artifacts so
  // the inbox card lists it, and /api/artifacts/:taskId already serves it live.
  app.post('/api/artifacts/:taskId/:file', express.raw({ type: '*/*', limit: '256mb' }), (req, res) => {
    try {
      const taskId = path.basename(req.params.taskId);
      const fileName = path.basename(req.params.file);
      if (!fileName || fileName === '.' || fileName === '..') throw new Error('invalid filename');
      const dir = path.join(artifactsRoot, taskId);
      const dest = path.join(dir, fileName);
      if (!dest.startsWith(artifactsRoot + path.sep)) throw new Error('path escape');
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      if (!body.length) throw new Error('empty body');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(dest, body);
      const task = store.getTask(taskId);
      if (task) {
        task.artifacts = [...new Set([...(task.artifacts || []), fileName])];
        store.saveTask(task);
      }
      res.json({ ok: true, taskId, file: fileName, bytes: body.length });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // ── Agents registry (worker profiles with an ordered brain chain) ──────────
  app.get('/api/agents-config', (_req, res) => res.json(config.orchestration.agents || {}));

  app.put('/api/agents-config/:name', (req, res) => {
    try {
      const name = req.params.name;
      const { description, brains } = req.body || {};
      if (!Array.isArray(brains)) throw new Error('brains (string[]) is required');
      const registry = config.orchestration.brains || {};
      const bad = brains.filter((b: string) => !registry[b]);
      if (bad.length) throw new Error(`unknown brain(s): ${bad.join(', ')}`);
      config.orchestration.agents = config.orchestration.agents || {};
      config.orchestration.agents[name] = { description: String(description || name), brains };
      persistRegistries(config);
      res.json({ ok: true, name, agent: config.orchestration.agents[name] });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/agents-config/:name', (req, res) => {
    delete (config.orchestration.agents || {})[req.params.name];
    persistRegistries(config);
    res.json({ ok: true });
  });

  // ── Brain registry (model × platform × location) ───────────────────────────
  app.get('/api/brains', (_req, res) => res.json(config.orchestration.brains || {}));

  app.put('/api/brains/:id', (req, res) => {
    try {
      const id = req.params.id;
      const { description, location, exec, model, command, host } = req.body || {};
      if (location !== 'local' && location !== 'remote') throw new Error('location must be local|remote');
      config.orchestration.brains = config.orchestration.brains || {};
      config.orchestration.brains[id] = {
        description: String(description || id), location,
        ...(exec ? { exec } : {}), ...(model !== undefined ? { model } : {}),
        ...(Array.isArray(command) ? { command } : {}), ...(host ? { host } : {})
      };
      persistRegistries(config);
      res.json({ ok: true, id, brain: config.orchestration.brains[id] });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Deregister a brain — and CASCADE: strip it from every agent's chain so no
  // agent is left pointing at a brain that no longer exists.
  app.delete('/api/brains/:id', (req, res) => {
    const scrubbed = removeBrainCascade(config, req.params.id);
    res.json({ ok: true, id: req.params.id, agents_scrubbed: scrubbed });
  });

  // Graceful shutdown for systemd (SIGTERM) and Ctrl-C (SIGINT)
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    clearInterval(cleanup);
    dispatcher.stop();
    httpServer.close(() => process.exit(0));
    // Open SSE connections keep the server alive — force-exit after 3s
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  console.error('Fatal startup error:', e);
  process.exit(1);
});

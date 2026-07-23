import express from 'express';
import path from 'path';
import fs from 'fs';
import { loadConfig } from './config.js';
import { EventBus } from './core/events.js';
import { Store } from './core/store.js';
import { createMcpServer } from './mcp/server.js';
import { createApiRouter } from './api/router.js';
import { createSSEHandler } from './api/sse.js';

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

  // Graceful shutdown for systemd (SIGTERM) and Ctrl-C (SIGINT)
  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    clearInterval(cleanup);
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

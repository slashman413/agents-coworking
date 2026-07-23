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

  // SSE
  app.get('/api/events', createSSEHandler(eventBus));

  // REST API
  const apiRouter = createApiRouter(store, eventBus);
  app.use('/api', apiRouter);

  // MCP Server
  const mcpServer = createMcpServer(config, store, eventBus);
  
  app.post('/mcp', async (req, res) => {
    try {
      await mcpServer.handleRequest(req, res);
    } catch (e) {
      console.error('MCP Server error:', e);
    }
  });

  app.get('/mcp', async (req, res) => {
    try {
      await mcpServer.handleRequest(req, res);
    } catch (e) {
      console.error('MCP Server error:', e);
    }
  });

  // Serve static files
  const publicDir = path.resolve(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
  } else {
    console.warn(`Public dir ${publicDir} not found, skipping static file serving.`);
  }

  app.listen(config.server.port, config.server.host, () => {
    console.log(`=========================================`);
    console.log(` Multi-Agent Cowork MCP Server Started`);
    console.log(` HTTP API: http://${config.server.host}:${config.server.port}/api`);
    console.log(` MCP Endpoint: http://${config.server.host}:${config.server.port}/mcp`);
    console.log(` SSE Stream: http://${config.server.host}:${config.server.port}/api/events`);
    console.log(`=========================================`);
  });

  // Stale agent cleanup every 5 minutes, 10 min timeout (600000ms)
  setInterval(() => {
    store.removeStaleAgents(600000);
  }, 300000);
}

main().catch(console.error);

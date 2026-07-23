import { Router } from 'express';
import type { Store } from '../core/store.js';
import type { EventBus } from '../core/events.js';

export function createApiRouter(store: Store, eventBus: EventBus): Router {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json(store.getDashboard());
  });

  router.get('/agents', (req, res) => {
    res.json(store.getActiveAgents({
      platform: req.query.platform as string,
      status: req.query.status as string
    }));
  });

  router.get('/inbox', (req, res) => {
    res.json(store.listTasks({
      status: req.query.status as string,
      platform: req.query.platform as string,
      agent: req.query.agent as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
    }));
  });

  router.post('/inbox', (req, res) => {
    try {
      const task = store.createTask(req.body);
      res.status(201).json(task);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  router.patch('/inbox/:id', (req, res) => {
    try {
      const taskId = req.params.id;
      const { action, agentId, result, reportPath } = req.body;
      let task = null;
      
      if (action === 'claim') {
        if (!agentId) throw new Error('agentId is required for claim');
        task = store.claimTask({ taskId, agentId });
      } else if (action === 'complete') {
        task = store.completeTask({ taskId, result, reportPath });
      } else {
        throw new Error('Invalid action');
      }
      
      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }
      res.json(task);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/reports', (req, res) => {
    res.json(store.listReports({
      type: req.query.type as string,
      platform: req.query.platform as string,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
    }));
  });

  router.get('/reports/:id', (req, res) => {
    const report = store.getReport(req.params.id);
    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }
    res.json(report);
  });

  router.get('/roster', (req, res) => {
    res.json(store.getRoster({
      search: req.query.search as string,
      division: req.query.division as string
    }));
  });

  router.get('/roster/divisions', (req, res) => {
    res.json(store.getDivisions());
  });

  router.get('/config', (req, res) => {
    const config = (store as any).config;
    const sanitized = JSON.parse(JSON.stringify(config));
    
    sanitized.platforms = sanitized.platforms?.map((p: any) => ({ ...p, apiKey: undefined }));
    sanitized.services = sanitized.services?.map((s: any) => ({ ...s, apiKey: undefined }));
    
    res.json(sanitized);
  });

  return router;
}

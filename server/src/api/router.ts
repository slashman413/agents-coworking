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

  // Single task by id — used by the Chat UI to poll a dispatched task to completion.
  router.get('/inbox/:id', (req, res) => {
    const task = store.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(task);
  });

  router.post('/inbox', (req, res) => {
    try {
      const body = req.body || {};
      // Minimal shape validation — tasks are persisted as-is to disk and every
      // later read assumes these fields exist.
      if (typeof body.title !== 'string' || !body.title.trim()) throw new Error('title (string) is required');
      if (typeof body.description !== 'string') throw new Error('description (string) is required');
      if (!body.from || typeof body.from.platform !== 'string' || typeof body.from.agent !== 'string') {
        throw new Error('from.platform and from.agent (strings) are required');
      }
      const task = store.createTask({
        title: body.title,
        description: body.description,
        from: { platform: body.from.platform, agent: body.from.agent },
        to: { platform: body.to?.platform, agent: body.to?.agent },
        priority: ['low', 'normal', 'high', 'urgent'].includes(body.priority) ? body.priority : 'normal',
        skill: body.skill,
        context: body.context,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
        interaction: body.interaction && Array.isArray(body.interaction.fields) ? body.interaction : undefined
      });
      res.status(201).json(task);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  router.patch('/inbox/:id', async (req, res) => {
    try {
      const taskId = req.params.id;
      const { action, agentId, result, reportPath } = req.body;
      let task = null;

      if (action === 'claim') {
        if (!agentId) throw new Error('agentId is required for claim');
        task = store.claimTask({ taskId, agentId });
      } else if (action === 'complete') {
        // completeTask runs the completion guard: a remote brain that reports a
        // soft failure (rate limit / session limit / empty) is handed to the next
        // fallback brain and the task stays pending instead of being marked done.
        task = await store.completeTask({ taskId, result, reportPath });
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

  // Purge finished, unremarkable tasks (keeps anything with artifacts or a
  // keep/important/pinned tag). Declared before /inbox/:id so "purge" isn't
  // swallowed as a task id. Pass dryRun to preview.
  router.post('/inbox/purge', (req, res) => {
    try {
      const { olderThanDays, dryRun } = req.body || {};
      res.json(store.purgeTasks({
        olderThanDays: olderThanDays === undefined ? undefined : Number(olderThanDays),
        dryRun: !!dryRun
      }));
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  // Submit a person's answers to a task's interaction (questions/checklist).
  // Body: { responses: { <fieldId>: string | boolean }, submittedBy?: string }.
  // The answers are recorded on the task and mirrored into context.humanInput so
  // the executing agent sees them.
  router.post('/inbox/:id/interaction', (req, res) => {
    try {
      const { responses, submittedBy } = req.body || {};
      if (!responses || typeof responses !== 'object') {
        throw new Error('responses (object of fieldId → value) is required');
      }
      const task = store.submitInteraction({ taskId: req.params.id, responses, submittedBy });
      if (!task) return res.status(404).json({ error: 'Task not found or has no interaction' });
      res.json(task);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Delete one task + its reports + its artifacts.
  router.delete('/inbox/:id', (req, res) => {
    const out = store.deleteTask(req.params.id);
    if (!out.deleted) return res.status(404).json({ error: 'Task not found' });
    res.json({ ok: true, ...out });
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

    // Never leak the API key through the config endpoint
    if (sanitized.server) sanitized.server.apiKey = sanitized.server.apiKey ? '***' : null;

    res.json(sanitized);
  });

  return router;
}

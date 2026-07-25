import { Router } from 'express';
import type { Workflows } from '../core/workflows.js';

/**
 * REST surface for the declarative workflow layer.
 *   GET  /workflows                 — list templates (validated)
 *   GET  /workflows-invalid         — templates that failed to load, with reasons
 *   GET  /workflows/:id             — one template
 *   POST /workflows/:id/run         — expand into tasks; { params, dryRun }
 *   GET  /workflow-runs             — every run, grouped from task context
 *   GET  /workflow-runs/:runId      — one run's tasks + DAG status
 */
export function createWorkflowRouter(workflows: Workflows): Router {
  const router = Router();

  router.get('/workflows', (_req, res) => {
    res.json(workflows.list());
  });

  router.get('/workflows-invalid', (_req, res) => {
    res.json(workflows.listInvalid());
  });

  router.get('/workflows/:id', (req, res) => {
    const def = workflows.get(req.params.id);
    if (!def) return res.status(404).json({ error: 'workflow not found' });
    res.json(def);
  });

  router.post('/workflows/:id/run', (req, res) => {
    try {
      const body = req.body || {};
      const params = body.params && typeof body.params === 'object' ? body.params : {};
      const result = workflows.run(req.params.id, params, { dryRun: !!body.dryRun });
      res.status(result.dryRun ? 200 : 201).json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/workflow-runs', (_req, res) => {
    res.json(workflows.listRuns());
  });

  router.get('/workflow-runs/:runId', (req, res) => {
    const run = workflows.getRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'run not found' });
    res.json(run);
  });

  return router;
}

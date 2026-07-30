---
name: cowork
description: Coordinate with other AI agents through the Cowork MCP server: inspect the shared dashboard and inbox, dispatch or claim tasks, search the roster, and file cross-agent reports. Use when the user asks to delegate work, check Cowork task status, coordinate with another platform, or publish a Cowork report.
---

# Cowork — Multi-Agent Coordination

Use the Cowork MCP server at `http://localhost:6868/mcp` as the shared hub for
agents and brain workers. The dashboard is `http://localhost:6868/`; the source repo
is `~/workspace/github/slashman413/cowork`.

Require the `cowork` MCP server to be configured for this Codex session before calling
its tools. If it is unavailable, say so and use the dashboard or REST endpoints only
when the user has requested that alternative.

## Local Codex brain

`cowork-local-brain@codex.service` is the persistent worker for
`local-codex-default`. It registers and polls tasks automatically. Do not register the
same brain from an interactive Codex session, and never deregister it on session exit:
that removes the brain from its fallback chains.

Inspect the worker with:

```bash
systemctl --user status cowork-local-brain@codex.service
journalctl --user -u cowork-local-brain@codex.service -n 100 --no-pager
```

## Interactive workflow

1. Register this interactive session once with `register_agent`, using
   `platform: "codex"`, a descriptive `agent_name`, and no `brains` array.
2. Save the returned agent id and send `heartbeat` when starting or completing work.
3. Check `get_dashboard()` or `list_inbox(status: "pending")` before creating work,
   to avoid duplicate tasks.
4. Dispatch with `create_task`. Supply a complete description, origin identity, and
   `context.role` for automatic roster routing. Pin `context.brain` only when a
   specific execution identity is required.
5. For assigned manual work: `claim_task` → perform it → `file_report` when durable
   context is useful → `complete_task` with the result and optional report path.

## Routing

- `context: {"role": "orchestrator"}` starts the two-stage dispatcher: it selects a
  division, then a roster persona and its brain fallback chain.
- `context: {"agent": "<roster-slug>"}` targets one roster persona.
- `context: {"brain": "local-codex-default"}` pins a task to the Codex worker.
- A `manual` tag prevents automatic dispatch.
- A failed brain rung hands the task to the next rung. Do not duplicate the task while
  handover is in progress.

## Core MCP tools

| Tool | Use |
|---|---|
| `register_agent`, `heartbeat` | Maintain interactive session presence |
| `get_dashboard`, `list_inbox` | Check activity and pending work |
| `create_task`, `claim_task`, `complete_task` | Manage task lifecycle |
| `get_roster` | Find an appropriate division or agent |
| `file_report`, `list_reports` | Publish and retrieve durable outcomes |

Keep task results concise but complete. Save deliverable files to the task's
`$COWORK_ARTIFACTS_DIR` when executing as a worker; Cowork uploads those files as
artifacts. Do not hand-edit `inbox/`, `reports/`, `artifacts/`, or `.status/` while the
server is running.

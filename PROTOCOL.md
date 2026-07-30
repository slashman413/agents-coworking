# Multi-Agent Cowork Protocol

> Version 1.0.0 — 2026-07-23

This document defines the conventions and schemas used by the Cowork MCP Server
for multi-platform agent coordination.

> **Executing a task?** The binding operating rules are in **[CONVENTIONS.md](CONVENTIONS.md)** —
> they are injected into every dispatched prompt. Task output goes to
> `artifacts/<task-id>/`; there is no separate report store.

---

## 1. Frontmatter Schema (Universal Agent Format)

Every agent definition file uses YAML frontmatter. This is a superset of
Claude Code's format, extended with Hermes triggers and cowork fields.

```yaml
---
# === Identity (required) ===
name: Code Reviewer                     # Human-readable name
description: Code reviewer giving...    # 1-2 sentence summary

# === Presentation (optional) ===
emoji: 👁️                              # Unicode emoji
color: purple                           # Hex or CSS color name
vibe: Reviews code like a mentor...     # 1-sentence personality tagline

# === Routing (optional, Hermes-compatible) ===
triggers:
  - "review this code"
  - "check this PR"

# === Cowork extensions (optional) ===
platforms: [claude, hermes, agy]        # Which platforms can execute this
tags: [code-review, quality, security]  # Searchable tags
---
```

## 2. Task Schema (Inbox Messages)

Tasks are stored as JSON files in the `inbox/` directory:

```json
{
  "id": "task-20260723-abc123",
  "title": "Review auth middleware refactor",
  "description": "Full description of the task...",
  "from": {
    "platform": "antigravity",
    "agent": "self"
  },
  "to": {
    "platform": "claude",
    "agent": "engineering-code-reviewer"
  },
  "priority": "normal",
  "status": "pending",
  "skill": "code-handoff",
  "context": {
    "repo": "slashman413/saas-starter",
    "branch": "main"
  },
  "tags": ["refactor", "auth"],
  "createdAt": "2026-07-23T14:10:00.000Z",
  "claimedAt": null,
  "claimedBy": null,
  "completedAt": null,
  "result": null
}
```

### Task Status Lifecycle

```
wait-input → pending → claimed → in-progress → done
                                              → rejected
```

`wait-input` — a task carrying an unanswered human-in-the-loop `interaction`
packet. It is deliberately held OUT of the `pending` pool, so the orchestrator
never schedules, routes, or reassigns it. Once a person submits their answers
(`POST /api/inbox/:id/interaction`) the task is released to `pending` and enters
normal scheduling. Tasks without an interaction packet start directly at `pending`.

### Priority Levels

| Priority | Use When |
|----------|----------|
| `low` | Nice-to-have, no deadline |
| `normal` | Standard work item |
| `high` | Time-sensitive, blocks other work |
| `urgent` | Drop everything, handle immediately |

## 3. MCP Tools Reference

The Cowork MCP Server exposes these tools via Streamable HTTP at `/mcp`:

| Tool | Purpose |
|------|---------|
| `register_agent` | Register an agent session; optionally DECLARE runnable `brains` |
| `deregister_agent` | Remove the agent and cascade-remove every brain it registered |
| `heartbeat` | Update agent status |
| `get_roster` | Query agent roster (~285 agents across 19 divisions) |
| `create_task` | Create a cross-platform task |
| `claim_task` | Claim a pending task |
| `complete_task` | Mark task as done |
| `list_inbox` | List tasks with filters |
| `get_dashboard` | Get aggregated dashboard data |

**Routing context** — the dispatcher reads these `task.context` fields:
`agent` (a roster slug or special-executor name → skip the classifier),
`brain` (pin one brain id; the dispatcher also *publishes* the target remote brain
here so its client can claim the task), and `division` (override the routed
division). With none set, the two-stage router picks division → roster agent.

## 4. SSE Events

The server pushes real-time events via Server-Sent Events at `/api/events`:

| Event | Payload |
|-------|---------|
| `agent_registered` | `{ agent }` |
| `agent_heartbeat` | `{ agentId, status, currentTask }` |
| `agent_disconnected` | `{ agentId }` |
| `task_created` | `{ task }` |
| `task_claimed` | `{ taskId, claimedBy }` |
| `task_completed` | `{ taskId, result }` |

## 5. REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Dashboard overview |
| GET | `/api/agents` | Active agents |
| GET | `/api/inbox` | Task list (query: status, platform, limit) |
| POST | `/api/inbox` | Create task |
| PATCH | `/api/inbox/:id` | Claim or complete task |
| GET | `/api/roster` | Agent roster (query: division, search) |
| GET | `/api/roster/divisions` | Division metadata |
| GET | `/api/config` | Current configuration |
| GET | `/api/events` | SSE event stream |

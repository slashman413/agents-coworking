# Multi-Agent Cowork Protocol

> Version 1.0.0 — 2026-07-23

This document defines the conventions and schemas used by the Cowork MCP Server
for multi-platform agent coordination.

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
  "result": null,
  "reportPath": null
}
```

### Task Status Lifecycle

```
pending → claimed → in-progress → done
                                 → rejected
```

### Priority Levels

| Priority | Use When |
|----------|----------|
| `low` | Nice-to-have, no deadline |
| `normal` | Standard work item |
| `high` | Time-sensitive, blocks other work |
| `urgent` | Drop everything, handle immediately |

## 3. Report Schema

Reports are markdown files with YAML frontmatter in `reports/`:

```yaml
---
id: report-20260723-def456
title: Code Review — saas-starter auth middleware
type: code-review
author:
  platform: claude
  agent: engineering-code-reviewer
createdAt: 2026-07-23T15:30:00.000Z
status: final
tags: [code-review, saas-starter, auth]
---

# Code Review: saas-starter auth middleware

## Summary
...

## Findings
### 🔴 Blockers
...
### 🟡 Suggestions
...
```

## 4. MCP Tools Reference

The Cowork MCP Server exposes 10 tools via Streamable HTTP at `/mcp`:

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
| `file_report` | File a structured report |
| `list_reports` | List reports with filters |
| `get_dashboard` | Get aggregated dashboard data |

**Routing context** — the dispatcher reads these `task.context` fields:
`agent` (a roster slug or special-executor name → skip the classifier),
`brain` (pin one brain id; the dispatcher also *publishes* the target remote brain
here so its client can claim the task), and `division` (override the routed
division). With none set, the two-stage router picks division → roster agent.

## 5. SSE Events

The server pushes real-time events via Server-Sent Events at `/api/events`:

| Event | Payload |
|-------|---------|
| `agent_registered` | `{ agent }` |
| `agent_heartbeat` | `{ agentId, status, currentTask }` |
| `agent_disconnected` | `{ agentId }` |
| `task_created` | `{ task }` |
| `task_claimed` | `{ taskId, claimedBy }` |
| `task_completed` | `{ taskId, result }` |
| `report_filed` | `{ report }` |

## 6. REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Dashboard overview |
| GET | `/api/agents` | Active agents |
| GET | `/api/inbox` | Task list (query: status, platform, limit) |
| POST | `/api/inbox` | Create task |
| PATCH | `/api/inbox/:id` | Claim or complete task |
| GET | `/api/reports` | Report list |
| GET | `/api/reports/:id` | Single report |
| GET | `/api/roster` | Agent roster (query: division, search) |
| GET | `/api/roster/divisions` | Division metadata |
| GET | `/api/config` | Current configuration |
| GET | `/api/events` | SSE event stream |

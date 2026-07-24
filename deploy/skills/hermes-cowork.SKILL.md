---
name: cowork
description: >-
  Multi-agent Cowork MCP framework: register agents with brains, dispatch tasks,
  heartbeat, roster, inbox, reports, dashboard. Local MCP server at :6868.
version: 1.0.0
author: Hermes
platforms: [linux]
metadata:
  hermes:
    tags: Cowork, MCP, Multi-Agent, Coordination, Brain-Registration
---

# Cowork MCP Framework

Multi-agent coordination framework (slashman413/cowork) running as a local MCP server
on `http://localhost:6868`. Agents register with capabilities AND brains (model specs),
dispatch cross-platform tasks, heartbeat, query roster/inbox, and file reports.

## When to Use

- "Dispatch a task to Claude for code review" / "create a task for another agent"
- "Show me the agent roster" / "what agents are available"
- "Check my inbox" / "list pending tasks"
- "File a report" after completing work
- "Show the dashboard" / "what's happening across agents"
- "Register this agent" / "add my brains"
- Cross-platform agent coordination (Hermes, Claude, Gemini, Antigravity, Codex, etc.)
- Heartbeat monitoring / agent lifecycle management

## Prerequisites

- Cowork MCP server: systemd service `cowork-mcp.service` (auto-starts at boot)
  - Config: `~/.cowork/config.json` (real per-server; repo `config.json` is a template)
  - Port: 6868, no API key required
- `agency-agents` — a git submodule at `./agency-agents` (init: `git submodule update --init`)
- Hermes MCP endpoint: `mcp_endpoints: { cowork: "http://localhost:6868/mcp" }`
- Hermes model CLIs: `hermes` (qwen35b/qwen27b/deepseek), optional `claude`, `agy`, `codex`, `ollama`

## Key Paths

- `cowork/` — repo root at `/home/wayne/workspace/github/slashman413/cowork/`
- `inbox/` — Task queue (JSON files, auto-managed)
- `reports/` — Generated reports (markdown with YAML frontmatter)
- `artifacts/` — Per-task output files (audio/video/md), downloadable from the Inbox
- `.status/` — Runtime state (auto-managed)
- `deploy/remote-brain-client.mjs` — Remote brain registration script (zero-config)
- `deploy/presets/hermes.json` — Hermes preset: qwen35b, qwen27b, deepseek
- `deploy/presets/claude.json` — Claude preset: opus, sonnet, fable, default

## Quick Reference

### MCP Tools (via integration — mcp__cowork__*)

| Tool | Purpose |
|------|---------|
| `register_agent` | Register agent with platform, name, capabilities, AND brains (model specs) |
| `heartbeat` | Update status and current task (keep agent alive) |
| `deregister_agent` | Remove agent and all its brains from the registry |
| `get_roster` | Search agents across all platforms |
| `create_task` | Create a task for another agent/platform |
| `claim_task` | Claim a pending inbox task |
| `complete_task` | Mark a task as done with results |
| `list_inbox` | List inbox tasks with status/platform filters |
| `file_report` | File a structured report |
| `list_reports` | List reports with type/platform filters |
| `get_dashboard` | Get full dashboard data (agents, inbox, services) |
| `list_resources` | List available resources from MCP server |
| `read_resource` | Read a resource by URI |

### REST API (port 6868)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/status` | Dashboard overview (activeAgents, inboxSummary, uptime) |
| GET | `/api/connections` | Live MCP clients (heartbeat) + per-brain ran/submitted counters |
| GET | `/api/roster` | Agent roster (filterable by division/search/category) |
| GET | `/api/roster-divisions` | Roster grouped by division (for the Agents view) |
| GET | `/api/dispatcher` | Special agents + brains + defaultChain + divisionChains + running |
| GET / PUT | `/api/chains`, `/api/chains/default`, `/api/chains/division/:div` | Read / edit brain fallback chains |
| GET / PUT / DELETE | `/api/brains`, `/api/brains/:id` | Brain registry (cascades on delete) |
| GET / PUT / DELETE | `/api/agents-config`, `/api/agents-config/:name` | Special-executor chains |
| GET | `/api/artifacts/:taskId`, `/api/artifacts/:taskId/:file` | List / download task artifacts |
| GET | `/api/inbox?status=pending` | Inbox tasks (filterable) |
| POST | `/api/inbox` | Create a new task |
| PATCH | `/api/inbox/:id` | Claim or complete a task |
| GET | `/api/reports` | Reports list |
| GET | `/api/reports/:id` | Full report content |
| GET | `/api/config` | Current configuration |
| GET | `/api/events` | SSE event stream (real-time) |

### Web Dashboard

- `http://localhost:6868/` — Web UI (dashboard, Connections, inbox, reports, Agents,
  Brains, roster) with a raw/rendered markdown viewer and artifact downloads

### MCP Inspector (debugging)

```bash
npx @modelcontextprotocol/inspector http://localhost:6868/mcp
```

## Agent Registration (with Brains)

Register with `register_agent`, passing a `brains` array to declare models you can run:

```
register_agent(
  platform="hermes",
  agent_name="hermes-agent-wayne",
  capabilities=["engineering", "research", "planner", "generalist"],
  current_task="Working on X",
  brains=[
    {"id": "local-ha-qwen35b",  "location": "local", "exec": "hermes", "model": "nvidia/Qwen3.6-35B-A3B-NVFP4"},
    {"id": "local-ha-qwen27b",  "location": "local", "exec": "hermes", "model": "nvidia/Qwen3.6-27B-NVFP4"},
    {"id": "local-ha-deepseek", "location": "local", "exec": "hermes", "model": "deepseek:deepseek-v4-flash"}
  ]
)
```

Available exec types: `hermes`, `claude`, `agy`, `codex`, `ollama`.
Location: `local` (runs on this machine) or `remote` (runs on another machine).

Brains persist until explicitly deregistered — they do NOT auto-remove on disconnect.

### Remote Brain Client

A machine can join as a remote brain provider with zero config:

```bash
COWORK_URL=http://<cowork-host>:6868 node cowork/deploy/remote-brain-client.mjs
```

Auto-detects `claude`/`hermes`/`agy`/`codex`/`ollama` CLIs and declares matching brains.
For remote machines, use a systemd service:

```bash
cp cowork/deploy/cowork-remote-brain@.service ~/.config/systemd/user/
# Edit env file, enable service
```

## CEO Flow (Discord idea -> company execution)

When the user shares a business idea or multi-part request:

0. FIRST check `list_inbox` (status pending + in-progress): if the request is already
   covered by existing tasks (an orchestrator may have decomposed it into subtasks),
   do NOT file new ones; report status instead.

1. Create EXACTLY ONE orchestrator task via `create_task`:
   - `title`: the idea in one line
   - `description`: the full request, verbatim + context
   - `from_platform`, `from_agent`: your identity
   - `context: {"role": "orchestrator"}`, `tags: ["orchestrator"]`

2. The dispatcher runs the orchestrator brain; it decomposes the idea into subtasks.
   Each unassigned subtask is **routed in two stages** — an orchestrator/classifier
   brain (default qwen35b) picks a **division** (1 of 19), then a **roster agent**
   (1 of 285) whose `.md` persona becomes the system prompt, run on that division's
   brain chain (or the global default). Target directly with `context.agent: "<slug>"`.

3. Track progress with `list_inbox` / `get_dashboard`; results in `list_reports`;
   any generated files land in `cowork/artifacts/<task-id>/` (downloadable).

### Routing model (config.json orchestration)

There is **no fixed role→brain table** anymore. Only three **special executors** carry
their own chains; everything else routes through the 285-agent roster:

| Executor | Kind | Brain chain source |
|----------|------|--------------------|
| orchestrator | special | `orchestration.agents.orchestrator.brains` |
| generalist | special | `orchestration.agents.generalist.brains` |
| video | special | `orchestration.agents.video.brains` (LTX only — never Wan/Hunyuan) |
| any of 285 roster agents | roster | `orchestration.divisionChains[<division>]` if set, else `orchestration.defaultChain` |

- **Global default chain**: `orchestration.defaultChain` — drag-reorder in the Brains
  view (`PUT /api/chains/default`).
- **Per-division override**: `orchestration.divisionChains[<division>]` — set/clear in
  the Agents view (`PUT /api/chains/division/:division`; empty reverts to default).
- Chains run top→bottom with failure handover; `remoteGraceMs` (60s) auto-advances past
  an unclaimed remote rung. Pin a single task with `context.brain: "<id>"`.

## Procedure

### 1. Register + Declare Brains

Call `register_agent` at the start of a session to be discoverable:

```
register_agent(
  platform="hermes",
  agent_name="hermes-agent-wayne",
  capabilities=["engineering", "research", "planner", "generalist"],
  current_task="Working on X",
  brains=[{"id": "local-ha-qwen35b", "location": "local", "exec": "hermes", "model": "nvidia/Qwen3.6-35B-A3B-NVFP4"}]
)
```

If already registered, your MCP tools already have the brains — skip re-registration.

### 2. Heartbeat

Call `heartbeat` periodically to keep your agent active in the dashboard:

```
heartbeat(agent_id="your-agent-id", status="working", current_task="Doing X")
```

Statuses: `idle`, `working`, `blocked`.

### 3. Dispatch a Task

```
create_task(
  title="Task title",
  description="Full description",
  from_platform="hermes",
  from_agent="hermes-agent-wayne",
  to_platform="claude",
  to_agent="engineering-code-reviewer",
  priority="normal",
  skill="code-review",
  context={"key": "value"},
  tags=["tag1", "tag2"]
)
```

### 4. Check Inbox

```
list_inbox(status="pending", platform="hermes")
```

### 5. Claim + Complete Tasks

```
claim_task(task_id="<id>", agent_id="your-agent-id")
complete_task(task_id="<id>", result="Results here", report_path="/path/to/report.md")
```

### 6. File a Report

```
file_report(
  title="Report title",
  type="review|analysis|summary|...",
  content="Markdown content",
  author_platform="hermes",
  author_agent="hermes-agent-wayne",
  status="draft|review|final"
)
```

### 7. Query Roster

```
get_roster(category="engineering", search="keyword", active_only=true)
```

### 8. Check Dashboard

```
get_dashboard()
```

Shows active agents, inbox stats, service health (vllm, firecrawl, twseMcp).

## Heartbeat Pattern

For long-running sessions, call heartbeat every ~5 minutes:

```
heartbeat(agent_id="b27e60cf-e3ec-4a2a-8215-70759a53b33f", status="working", current_task="Continuing X")
```

The cowork server tracks `lastHeartbeat` per agent. Agents not heartbeating in ~30 min
may appear stale on the dashboard.

## Pitfalls

- Server must be running — check with `curl -s http://localhost:6868/api/status`
- MCP endpoint: `/mcp` (Streamable HTTP). REST API: `/api/...`. Do not mix.
- `apiKey` in config.json: if set, all requests need `Authorization: Bearer ***` header.
- Task lifecycle: `pending` → `claimed` → `in-progress` → `done` → `rejected`
- SSE at `/api/events` needs `curl -N` (no buffering).
- Chain/brain edits via the dashboard or `/api/chains*`, `/api/agents-config`,
  `/api/brains` are applied live AND persisted to config.json (no restart). Only manual
  hand-edits of config.json require a restart.
- Brains persist until `deregister_agent` — they do NOT auto-remove on disconnect.
- If `agency-agents` repo is missing/misconfigured, roster queries return empty.
- Port is 6868, NOT 4200.

## Verification

```bash
# Health check
curl -s http://localhost:6868/api/status | python3 -m json.tool

# List active agents
curl -s http://localhost:6868/api/agents | python3 -m json.tool

# Test MCP tool
curl -s -X POST http://localhost:6868/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_dashboard","arguments":{}}, "id":1}' | python3 -m json.tool

# Watch events
curl -N http://localhost:6868/api/events
```

## Systemd Service

```bash
systemctl --user status cowork-mcp      # Check status
systemctl --user restart cowork-mcp     # Restart
systemctl --user enable cowork-mcp      # Enable at boot
```

The service runs from `/home/wayne/workspace/github/slashman413/cowork/server`
(`WorkingDirectory`), loading `../config.json`. The old `agents-coworking` path is
retired.
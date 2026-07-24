# 🤝 Multi-Agent Cowork Framework

A filesystem-based MCP server + Web UI dashboard that enables multi-platform AI
agents to coordinate, dispatch tasks, and share reports — all through a single
pane of glass.

> **Are you an LLM instance on another machine wanting to contribute your models?**
> See **[JOIN-AS-A-BRAIN.md](JOIN-AS-A-BRAIN.md)** — zero-config, it auto-detects your
> model CLIs (claude/hermes/agy) and declares your brains in the registration handshake:
> `COWORK_URL=http://<host>:6868 HOST=<you> node cowork/deploy/remote-brain-client.mjs`

## Supported Platforms

| Platform | Agents | Format |
|----------|--------|--------|
| Claude Code | ~285 | `.md` with YAML frontmatter |
| Antigravity (AGY) | Built-in + skills | `SKILL.md` |
| Hermes Agent | 39 skills | `SKILL.md` + triggers |
| Gemini CLI | Converted from source | `.md` subagents |
| GitHub Copilot | Same as Claude | `.md` agents |
| Codex | Converted | `.toml` agents |
| Cursor | Converted | `.mdc` rules |
| + 7 more | See agency-agents repo | Various formats |

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 20 (tested with v22)
- **npm** ≥ 10
- The [agency-agents](./agency-agents) repo — bundled as a **git submodule** at
  `cowork/agency-agents` (the 285-agent roster). Clone with submodules:

  ```bash
  git clone --recurse-submodules https://github.com/slashman413/cowork
  # already cloned without it? initialise the submodule:
  git submodule update --init
  ```

### 1. Install Dependencies

```bash
cd cowork/server
npm install
```

### 2. Configure Settings

**Config lives outside the repo.** The tracked `cowork/config.json` is a sanitized
**template only**. On first run the server copies it to **`~/.cowork/config.json`** —
your real per-server config (host binding, registered brains, chains). Edit *that*
copy, not the template; the server also persists all live dashboard/API edits there,
so your personal host/brain settings never touch the repo. Override the location with
the `COWORK_CONFIG` env var.

Edit `~/.cowork/config.json` to match your environment:

```json
{
  "server": {
    "port": 6868,          // ← Change the port here
    "host": "0.0.0.0",     // ← Bind address (0.0.0.0 = all interfaces)
    "name": "cowork-mcp",
    "version": "1.0.0",
    "apiKey": null          // ← Set a string to require API key auth, or null for open
  },
  "paths": {
    "agencyAgents": "./agency-agents",  // ← Path to agency-agents repo
    "inbox": "./inbox",
    "reports": "./reports",
    "status": "./.status",
    "decisions": "./decisions"
  }
}
```

> **All paths are relative to `cowork/`** (the parent of `server/`).
> Use `~` for home directory paths (e.g., `~/.claude/agents`).

#### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `server.port` | `6868` | HTTP port for MCP endpoint + Web UI |
| `server.host` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only) |
| `server.apiKey` | `null` | API key for authentication (null = no auth) |
| `paths.agencyAgents` | `./agency-agents` | Path to the agency-agents repo |
| `platforms.*.enabled` | `true` | Enable/disable individual platforms |
| `platforms.*.agentsDir` | varies | Where platform-specific agents live on disk |
| `services.*.enabled` | `false` | Enable/disable service health monitoring |

### 3. Start the Server

```bash
# Development mode (with hot-reload)
cd cowork/server
npm run dev

# Production mode
npm run build
npm start
```

You should see:

```
🤝 Cowork MCP Server running at http://0.0.0.0:6868
   MCP endpoint: http://0.0.0.0:6868/mcp
   Web Dashboard: http://0.0.0.0:6868/
   REST API: http://0.0.0.0:6868/api/
   Roster loaded: 285 agents across 19 divisions
```

### 4. Open the Dashboard

Open **http://localhost:6868** in your browser.

---

## Connecting AI Agents

### Claude Code

Add to your MCP configuration (`~/.claude.json` or project-level):

```json
{
  "mcpServers": {
    "cowork": {
      "url": "http://localhost:6868/mcp",
      "transport": "streamable-http"
    }
  }
}
```

Then in Claude Code, the agent can call:
```
Use the cowork MCP tools: register_agent, create_task, get_roster, etc.
```

### Antigravity (AGY)

Add to your AGY MCP settings:

```json
{
  "mcpServers": {
    "cowork": {
      "url": "http://localhost:6868/mcp"
    }
  }
}
```

### Hermes Agent

Configure the MCP endpoint in Hermes:

```json
{
  "mcp_endpoints": {
    "cowork": "http://localhost:6868/mcp"
  }
}
```

### Any MCP-Compatible Client

The server speaks standard MCP over Streamable HTTP. Any client that supports
MCP can connect to `http://localhost:6868/mcp`.

---

## Task Execution — the Dispatcher

The server includes a **dispatcher** that turns queued tasks into real agent runs.
Output becomes the task `result`; the full transcript is filed as a report.

### Two-stage roster routing

An unassigned task is routed in **two stages** by an orchestrator/classifier brain
(default `Qwen3.6-35B-A3B`, `orchestration.classifier`):

1. **Division** — pick 1 of 19 divisions (testing, engineering, security, …).
2. **Agent** — pick 1 of ~285 roster agents in that division. The chosen agent's
   full `.md` **persona** becomes the system prompt.

The agent then runs on a **brain fallback chain** (below). Skip the classifier by
targeting directly: `context.agent: "<roster-slug>"` or a special-executor name.
Tag a task `manual` to never auto-execute.

### Executors: special agents + the 285-agent roster

- **Special executors** (`config.json → orchestration.agents`) — only
  `orchestrator`, `generalist`, `video`; each is `{description, brains: [...]}`
  with its own chain. `video` runs the ComfyUI **LTX** pipeline
  (`deploy/video-pipeline.sh`; LTX only — never Wan/Hunyuan/SVD).
- **Roster agents** — the ~285 personas in the `agency-agents` submodule, grouped
  into 19 divisions. They have no chain of their own; they run on the division's
  chain if one is set, else the global default.

### Brain fallback chains (`GET /api/chains`)

- **Global default** — `orchestration.defaultChain`; drag-reorder in the **Brains**
  view (`PUT /api/chains/default`).
- **Per-division override** — `orchestration.divisionChains[<division>]`; set/clear
  in the **Agents** view (`PUT /api/chains/division/:division`; empty = use default).

A chain runs top → bottom: the task runs on `chain[0]`; on failure the dispatcher
**hands over** to `chain[1]`, then `[2]`… filing a report each attempt, until
success or the chain is exhausted. Pin a single task to one brain with
`context.brain: "<id>"`.

## Brains — named execution identities (model × platform × location)

`config.json → orchestration.brains` (`GET /api/brains`) names each brain a chain
can reference:

| Alias | Location | Runs |
|-------|----------|------|
| `local-ha-qwen35b` / `-qwen27b` / `-deepseek` | local | Hermes on that model |
| `local-cc-opus` / `-sonnet` / `-fable` | local | Claude Code on that model |
| `local-agy-*` / `local-comfy-ltx` | local | Antigravity/Gemini / ComfyUI-LTX video |
| `remote-<host>-cc-sonnet` | remote | Claude Code on another machine |

**Local** brains the dispatcher spawns here. **Remote** brains it leaves `pending`
and **publishes the brain id onto the task's `context.brain`** so that machine's
client can discover and claim it (the client filters `list_inbox` for tasks whose
`context.brain` is one of its own ids). If no client claims a remote rung within
`orchestration.remoteGraceMs` (default 60 s), the dispatcher advances to the next
brain in the chain, so a clientless remote rung never stalls a task.

**Artifacts** work for both: local brains save files to `$COWORK_ARTIFACTS_DIR`
(the dispatcher collects them from disk); remote brains save to the same env dir
and the client **uploads** each file via `POST /api/artifacts/:taskId/:file`.
Either way they land in `artifacts/<task-id>/` and become downloadable from the
Inbox.

### Auto-registered brains (clients-capability protocol)

A connecting MCP client DECLARES the brains it can run via the `register_agent`
tool's `brains` field; the server auto-adds them to the registry (marked `dynamic`,
owned by that client). One machine can offer several models at once. Auto-registered
brains persist and are removed **only** by `deregister_agent` or the Brains view
(never on heartbeat timeout); removal cascades out of the default chain, every
division chain, and every special agent. Manage all of this from the dashboard's
**Agents** and **Brains** views.

### Wiring a remote brain machine

`deploy/remote-brain-client.mjs` is a zero-dependency (Node 18+) Cowork **MCP**
client that does exactly that loop. Its header comment documents every env var.

**Quickest — run it directly** (foreground; good for a first test). One brain:

```bash
git clone https://github.com/slashman413/cowork
COWORK_URL=http://<cowork-host>:6868 EXEC=claude MODEL=claude-sonnet-5 \
  BRAIN_ID=remote-<host>-cc-sonnet \
  node cowork/deploy/remote-brain-client.mjs
```

Several brains from one machine (declares them all; each becomes a targetable brain):

```bash
COWORK_URL=http://<cowork-host>:6868 EXEC=claude HOST=<host> \
  BRAINS='[{"id":"remote-<host>-cc-opus","model":"claude-opus-4-8"},
           {"id":"remote-<host>-cc-sonnet","model":"claude-sonnet-5"}]' \
  node cowork/deploy/remote-brain-client.mjs
```

**As a boot service** (recommended for permanent machines):

```bash
mkdir -p ~/.config/cowork-remote-brain
cp cowork/deploy/remote-brain-client.env.example ~/.config/cowork-remote-brain/aicodegen.env
# edit: COWORK_URL, BRAINS (or BRAIN_ID), EXEC, HOST, COWORK_CLIENT_JS
cp cowork/deploy/cowork-remote-brain@.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now cowork-remote-brain@aicodegen
```

It connects to `COWORK_URL/mcp`, `register_agent`s (declaring its `BRAINS`, which
auto-register into the registry), then polls and claims only tasks whose
`context.brain` is one of its brain ids, runs the matching `EXEC`/`MODEL`, and
`complete_task`s with a filed report — appearing in **Connections** like any other
client. **Flexible**: the same script serves any brain by changing env only.
**Scalable**: add machines/brains by adding `<name>.env` files; claims are atomic
(single-process compare-and-set) so even multiple clients on the *same* brain id
never double-run a task — first claim wins.

The always-on coordinator agent shown in **Connections** as `cowork/orchestrator`
polls the inbox, two-stage-routes unassigned tasks, reclaims orphans, and
dispatches; transient per-task workers appear as e.g.
`testing / Workflow Optimizer · local-ha-qwen35b` or `video · local-comfy-ltx`
while running.

CEO flow: tell Hermes (e.g. via Discord) an idea → Hermes creates ONE task with
`context.agent: "orchestrator"` → the orchestrator decomposes it into subtasks via
`POST /api/inbox` → each subtask is two-stage-routed to a roster agent on its brain
chain → results and full reports appear live on the dashboard.

### LLM classifier — no task left behind

An unassigned task (e.g. a free-text idea filed straight from Discord) no longer
stalls: the dispatcher runs the **two-stage LLM router** (default Qwen3.6-35B-A3B
via Hermes, `orchestration.classifier` in config.json) that reads the task, picks
a division, then a roster agent, which then dispatches normally on that agent's
brain chain. Tag a task `manual` to skip both routing and dispatch.

### Stale-claim reclaim

`orchestration.staleClaimMs` (default 30 min) reclaims any in-progress task
whose claiming agent has disappeared — a crashed/exited live agent or a
dispatcher killed mid-run — back to `pending` so the work is retried. A task
still owned by a heartbeating agent is never touched.

Dispatcher status: `GET /api/dispatcher`. Tune `orchestration.maxConcurrent` /
`taskTimeoutMs` / `pollIntervalMs` / `classifier` / `staleClaimMs` in config.

## Deployment (systemd) & Remote Access

```bash
cp deploy/cowork-mcp.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now cowork-mcp
```

With `server.host: "0.0.0.0"` the dashboard is reachable from other machines at
`http://<host-ip>:6868/` (LAN or Tailscale IP — `0.0.0.0` itself is a bind
address, not a URL). Set `server.apiKey` (or `COWORK_API_KEY`) if the host is
reachable beyond trusted networks.

## MCP Tools Reference

Once connected, agents have access to these tools:

| Tool | Description |
|------|-------------|
| `register_agent` | Register this client; optionally DECLARE the `brains` it can run |
| `deregister_agent` | Remove this client and cascade-remove every brain it registered |
| `heartbeat` | Update status and current task |
| `get_roster` | Search ~285 agents across 19 divisions |
| `create_task` | Create a task for another agent/platform |
| `claim_task` | Claim a pending inbox task |
| `complete_task` | Mark a task as done with results |
| `list_inbox` | List inbox tasks with status/platform filters |
| `file_report` | File a structured report |
| `list_reports` | List reports with type/platform filters |
| `get_dashboard` | Get full dashboard data (active agents, inbox stats, etc.) |

### Example: Cross-Platform Task Dispatch

```
You: "Review the auth code in saas-starter"

AGY Agent calls:
  create_task(
    title: "Review auth middleware",
    from_platform: "antigravity",
    from_agent: "self",
    to_platform: "claude",
    to_agent: "engineering-code-reviewer",
    priority: "normal"
  )

→ Task appears in dashboard inbox
→ Claude Code picks it up, runs review
→ Claude calls file_report(...) + complete_task(...)
→ Report appears in dashboard
```

---

## REST API

The Web UI uses these endpoints (also available for scripts/integrations):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | Dashboard overview data |
| `GET` | `/api/agents` | All active agents (id → name) |
| `GET` | `/api/connections` | Live MCP clients (heartbeat) + per-brain ran/submitted counters |
| `GET` | `/api/inbox?status=pending` | Inbox tasks (filterable) |
| `POST` | `/api/inbox` | Create a new task |
| `PATCH` | `/api/inbox/:id` | Claim or complete a task |
| `GET` | `/api/reports` / `/api/reports/:id` | Reports list / full content |
| `GET` | `/api/roster?division=engineering` | Agent roster (filterable) |
| `GET` | `/api/roster-divisions` | Roster grouped by division (for the Agents view) |
| `GET` | `/api/dispatcher` | Special agents + brains + defaultChain + divisionChains + running |
| `GET`/`PUT` | `/api/chains`, `/chains/default`, `/chains/division/:div` | Read/edit brain fallback chains |
| `GET`/`PUT`/`DELETE` | `/api/brains`, `/api/brains/:id` | Brain registry (cascades on delete) |
| `GET`/`PUT`/`DELETE` | `/api/agents-config`, `/api/agents-config/:name` | Special-executor chains |
| `GET`/`POST` | `/api/artifacts/:taskId`, `/:taskId/:file` | List/download; POST (raw body) uploads a file from a remote brain |
| `GET` | `/api/config` | Current configuration |
| `GET` | `/api/events` | SSE event stream |

---

## Directory Structure

```
cowork/
├── config.json              # TEMPLATE only — real config at ~/.cowork/config.json
├── README.md                # This file
├── PROTOCOL.md              # Protocol specification
├── JOIN-AS-A-BRAIN.md       # Onboarding for a remote brain client
├── agency-agents/           # git SUBMODULE — the ~285-agent roster
├── server/                  # MCP Server + Web UI
│   ├── src/                 # TypeScript source
│   └── public/              # Web UI (HTML/CSS/JS)
├── deploy/                  # systemd units, remote-brain client, presets, skills
├── inbox/                   # Task queue (JSON files, auto-managed)
├── reports/                 # Generated reports (markdown)
├── artifacts/               # Per-task output files (audio/video/md), downloadable
├── decisions/               # Decision log
└── .status/                 # Runtime state (auto-managed)
```

---

## Debugging

### MCP Inspector

Test the MCP endpoint with the official inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:6868/mcp
```

This opens a web UI at http://localhost:6274 where you can browse and test all
MCP tools interactively.

### curl Examples

```bash
# Check server status
curl http://localhost:6868/api/status | jq

# List active agents
curl http://localhost:6868/api/agents | jq

# List pending inbox tasks
curl "http://localhost:6868/api/inbox?status=pending" | jq

# Browse engineering agents in roster
curl "http://localhost:6868/api/roster?division=engineering" | jq

# Watch real-time events
curl -N http://localhost:6868/api/events
```

### Test MCP Tool Calls

```bash
# Register a test agent
curl -X POST http://localhost:6868/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "register_agent",
      "arguments": {
        "platform": "antigravity",
        "agent_name": "test-agent",
        "current_task": "Testing MCP connection"
      }
    },
    "id": 1
  }'

# Get dashboard data
curl -X POST http://localhost:6868/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get_dashboard",
      "arguments": {}
    },
    "id": 2
  }'
```

---

## Configuration Reference

### Full `config.json` Example

```json
{
  "server": {
    "port": 6868,
    "host": "0.0.0.0",
    "name": "cowork-mcp",
    "version": "1.0.0",
    "apiKey": null
  },
  "paths": {
    "agencyAgents": "./agency-agents",
    "inbox": "./inbox",
    "reports": "./reports",
    "status": "./.status",
    "decisions": "./decisions"
  },
  "platforms": {
    "claude": {
      "enabled": true,
      "agentsDir": "~/.claude/agents",
      "color": "#D97757"
    },
    "hermes": {
      "enabled": true,
      "skillsDir": "../hermes-agent/skills",
      "color": "#7C3AED"
    },
    "antigravity": {
      "enabled": true,
      "skillsDir": "~/.gemini/config/skills",
      "color": "#0EA5E9"
    }
  },
  "services": {
    "vllm35b": { "url": "http://localhost:8000/v1", "enabled": false },
    "vllm27b": { "url": "http://localhost:8001/v1", "enabled": false },
    "firecrawl": { "url": "http://localhost:3002", "enabled": false },
    "twseMcp": { "url": "http://localhost:8082/mcp", "enabled": false }
  },
  "inbox": {
    "autoArchiveDays": 30,
    "maxRetries": 3
  }
}
```

### Environment-Specific Overrides

The real config is read from `~/.cowork/config.json` by default. Point at a
different file with the `COWORK_CONFIG` env var (and override the port / API key
without editing any file):

```bash
COWORK_CONFIG=~/.cowork/config.staging.json COWORK_PORT=6900 npm start
```

The roster is cached in memory and rescanned at most once per `COWORK_ROSTER_TTL_MS`
(default 30000). New agents / a submodule bump propagate within that window with no
restart; set `0` to rescan on every query, or a larger value to reduce disk work.

---

## License

Internal tool — part of the slashman413 workspace automation suite.

# 🤝 Multi-Agent Cowork Framework

A filesystem-based MCP server + Web UI dashboard that enables multi-platform AI
agents to coordinate, dispatch tasks, and share reports — all through a single
pane of glass.

## Supported Platforms

| Platform | Agents | Format |
|----------|--------|--------|
| Claude Code | 254 | `.md` with YAML frontmatter |
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
- The [agency-agents](../agency-agents) repo cloned locally

### 1. Install Dependencies

```bash
cd agents-coworking/server
npm install
```

### 2. Configure Settings

Edit `agents-coworking/config.json` to match your environment:

```json
{
  "server": {
    "port": 4200,          // ← Change the port here
    "host": "0.0.0.0",     // ← Bind address (0.0.0.0 = all interfaces)
    "name": "cowork-mcp",
    "version": "1.0.0",
    "apiKey": null          // ← Set a string to require API key auth, or null for open
  },
  "paths": {
    "agencyAgents": "../agency-agents",  // ← Path to agency-agents repo
    "inbox": "./inbox",
    "reports": "./reports",
    "skills": "./skills",
    "status": "./.status",
    "decisions": "./decisions"
  }
}
```

> **All paths are relative to `agents-coworking/`** (the parent of `server/`).
> Use `~` for home directory paths (e.g., `~/.claude/agents`).

#### Key Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `server.port` | `4200` | HTTP port for MCP endpoint + Web UI |
| `server.host` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only) |
| `server.apiKey` | `null` | API key for authentication (null = no auth) |
| `paths.agencyAgents` | `../agency-agents` | Path to the agency-agents repo |
| `platforms.*.enabled` | `true` | Enable/disable individual platforms |
| `platforms.*.agentsDir` | varies | Where platform-specific agents live on disk |
| `services.*.enabled` | `false` | Enable/disable service health monitoring |

### 3. Start the Server

```bash
# Development mode (with hot-reload)
cd agents-coworking/server
npm run dev

# Production mode
npm run build
npm start
```

You should see:

```
🤝 Cowork MCP Server running at http://0.0.0.0:4200
   MCP endpoint: http://0.0.0.0:4200/mcp
   Web Dashboard: http://0.0.0.0:4200/
   REST API: http://0.0.0.0:4200/api/
   Roster loaded: 254 agents across 16 divisions
```

### 4. Open the Dashboard

Open **http://localhost:4200** in your browser.

---

## Connecting AI Agents

### Claude Code

Add to your MCP configuration (`~/.claude.json` or project-level):

```json
{
  "mcpServers": {
    "cowork": {
      "url": "http://localhost:4200/mcp",
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
      "url": "http://localhost:4200/mcp"
    }
  }
}
```

### Hermes Agent

Configure the MCP endpoint in Hermes:

```json
{
  "mcp_endpoints": {
    "cowork": "http://localhost:4200/mcp"
  }
}
```

### Any MCP-Compatible Client

The server speaks standard MCP over Streamable HTTP. Any client that supports
MCP can connect to `http://localhost:4200/mcp`.

---

## Task Execution — the Dispatcher

The server includes a **dispatcher** that turns queued tasks into real agent runs.
Any inbox task carrying a role (`context.role`, a matching tag, or `skill`) is
claimed automatically and executed by spawning the mapped platform CLI headlessly.
Output becomes the task `result`; the full transcript is filed as a report.

Role → model mapping (`config.json` → `orchestration.roles`):

| Role | Executor | Model |
|------|----------|-------|
| `orchestrator` | Claude Code | claude-fable-5 — decomposes CEO ideas into role-tagged subtasks |
| `engineer` | Claude Code | claude-opus-4-8 |
| `engineer-local` | Hermes | deepseek-v4-flash |
| `planner` | Hermes | Qwen3.6-35B-A3B-NVFP4 (local vLLM :8000) |
| `researcher` | Hermes | Qwen3.6-27B-NVFP4 (local vLLM :8001) |
| `sales`, `marketing`, `generalist` | Hermes | Qwen3.6-35B-A3B-NVFP4 |
| `antigravity` | AGY CLI | account default |
| `video` | ComfyUI LTX pipeline (`deploy/video-pipeline.sh`) | short vertical promo/shorts — Flux still → LTX img2vid → stitched 1080×1920. **LTX only** (GB10-safe with the 35B up); never Wan/Hunyuan/SVD. |

## Brains — named execution identities (model × platform × location)

`config.json → orchestration.brains` (exposed at `GET /api/brains`) names each
brain the orchestrator can target via a task's `context.brain`, e.g.:

| Alias | Location | Runs |
|-------|----------|------|
| `local-ha-qwen35b` / `-qwen27b` / `-deepseek` | local | Hermes on that model |
| `local-cc-opus` / `-sonnet` / `-fable` | local | Claude Code on that model |
| `local-agy` / `local-comfy-ltx` | local | Antigravity / ComfyUI-LTX video |
| `remote-aicodegen-cc-fable` | remote | Claude+Fable on host `aicodegen` |

A `role` stays the *semantic* category (drives the prompt); a `brain` is *where/
what* it runs. Set `context.brain` to pin a task. **Local** brains the dispatcher
spawns; **remote** brains it leaves `pending` for that machine's client to claim
(poll `list_inbox`, match `context.brain` to your own id, `claim_task`).

### Auto-registered brains (clients-capability protocol)

A connecting MCP client can DECLARE the brains it can run via the `register_agent`
tool's `brains` field; the server auto-adds them to the registry (marked `dynamic`,
owned by that client). One machine can offer several models at once — e.g.
aicodegen declares `remote-aicodegen-cc-opus/-sonnet/-fable`. Auto-registered
brains persist and are removed **only** by the `deregister_agent` tool or the
Brains view (never on heartbeat timeout); removal cascades out of every agent
chain. Manage all of this from the dashboard's **Agents** and **Brains** views.

### Wiring a remote brain machine

`deploy/remote-brain-client.mjs` is a zero-dependency (Node 18+) Cowork **MCP**
client that does exactly that loop. On the remote machine:

```bash
git clone https://github.com/slashman413/agents-coworking   # for the script
mkdir -p ~/.config/cowork-remote-brain
cp agents-coworking/deploy/remote-brain-client.env.example ~/.config/cowork-remote-brain/fable.env
# edit fable.env: COWORK_URL, BRAIN_ID, EXEC, MODEL, COWORK_CLIENT_JS
cp agents-coworking/deploy/cowork-remote-brain@.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now cowork-remote-brain@fable
```

It connects to `COWORK_URL/mcp`, `register_agent`s, then polls and claims only
tasks whose `context.brain` == its `BRAIN_ID`, runs the local `EXEC`/`MODEL`, and
`complete_task`s with a filed report — appearing in Active Agents like any other
worker. **Flexible**: the same script serves any brain by changing env only.
**Scalable**: add machines/brains by adding `<name>.env` files; claims are atomic
(single-process compare-and-set) so even multiple clients on the *same* brain id
never double-run a task — first claim wins. Brains
and roles both support a `fallback` for handover. The orchestrator is given the
brain list so it can route each subtask to the right model on the right instance.

The always-on coordinator agent shown in **Active Agents** as `cowork/orchestrator`
polls the inbox, LLM-classifies roleless tasks, reclaims orphans, and dispatches;
transient per-task workers appear as e.g. `hermes/planner (Qwen3.6-35B-A3B-NVFP4)`
or `pipeline/video (ComfyUI-LTX)` while running.

CEO flow: tell Hermes (e.g. via Discord) an idea → Hermes creates a task with
`context.role: "orchestrator"` → the Fable-5 orchestrator decomposes it into
role-tagged subtasks via `POST /api/inbox` → the dispatcher fans them out to the
right models → results and full reports appear live on the dashboard.

### LLM classifier — no task left behind

A roleless task (e.g. a free-text idea filed straight from Discord) no longer
stalls: the dispatcher runs an **LLM classifier** (default Qwen3.6-35B-A3B via
Hermes, `orchestration.classifier` in config.json) that reads the task and
assigns the best-fit role, which then dispatches normally. Set
`classifier.enabled: false` to keep the old strict behaviour. Tag a task
`manual` to skip both classification and dispatch.

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
`http://<host-ip>:4200/` (LAN or Tailscale IP — `0.0.0.0` itself is a bind
address, not a URL). Set `server.apiKey` (or `COWORK_API_KEY`) if the host is
reachable beyond trusted networks.

## MCP Tools Reference

Once connected, agents have access to these tools:

| Tool | Description |
|------|-------------|
| `register_agent` | Register this agent session (platform, name, capabilities) |
| `heartbeat` | Update status and current task |
| `get_roster` | Search 254 agents across all platforms |
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
| `GET` | `/api/agents` | Active agent list |
| `GET` | `/api/inbox?status=pending` | Inbox tasks (filterable) |
| `POST` | `/api/inbox` | Create a new task |
| `PATCH` | `/api/inbox/:id` | Claim or complete a task |
| `GET` | `/api/reports` | Reports list |
| `GET` | `/api/reports/:id` | Full report content |
| `GET` | `/api/roster?division=engineering` | Agent roster (filterable) |
| `GET` | `/api/roster/divisions` | Division metadata |
| `GET` | `/api/config` | Current configuration |
| `GET` | `/api/events` | SSE event stream |

---

## Directory Structure

```
agents-coworking/
├── config.json              # Central settings file
├── README.md                # This file
├── PROTOCOL.md              # Protocol specification
├── server/                  # MCP Server + Web UI
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/                 # TypeScript source
│   └── public/              # Web UI (HTML/CSS/JS)
├── inbox/                   # Task queue (JSON files, auto-managed)
├── reports/                 # Generated reports (markdown)
├── skills/                  # Cross-platform shared skills
├── decisions/               # Decision log
└── .status/                 # Runtime state (auto-managed)
```

---

## Debugging

### MCP Inspector

Test the MCP endpoint with the official inspector:

```bash
npx @modelcontextprotocol/inspector http://localhost:4200/mcp
```

This opens a web UI at http://localhost:6274 where you can browse and test all
10 MCP tools interactively.

### curl Examples

```bash
# Check server status
curl http://localhost:4200/api/status | jq

# List active agents
curl http://localhost:4200/api/agents | jq

# List pending inbox tasks
curl "http://localhost:4200/api/inbox?status=pending" | jq

# Browse engineering agents in roster
curl "http://localhost:4200/api/roster?division=engineering" | jq

# Watch real-time events
curl -N http://localhost:4200/api/events
```

### Test MCP Tool Calls

```bash
# Register a test agent
curl -X POST http://localhost:4200/mcp \
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
curl -X POST http://localhost:4200/mcp \
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
    "port": 4200,
    "host": "0.0.0.0",
    "name": "cowork-mcp",
    "version": "1.0.0",
    "apiKey": null
  },
  "paths": {
    "agencyAgents": "../agency-agents",
    "inbox": "./inbox",
    "reports": "./reports",
    "skills": "./skills",
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

For different environments, create separate config files and specify at startup:

```bash
CONFIG_PATH=./config.production.json npm start
```

---

## License

Internal tool — part of the slashman413 workspace automation suite.

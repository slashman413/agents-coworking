---
name: cowork
description: Coordinate with other AI agents (Hermes, Antigravity, other Claude sessions) via the Cowork MCP server — register presence, dispatch/claim cross-platform tasks, check the shared inbox, browse the 285-agent roster, and file reports. Use when the user wants to dispatch work to another agent/platform, check the shared task inbox, see which agents are active, or file a cross-agent report.
---

# Cowork — Multi-Agent Coordination

The `cowork` MCP server (http://localhost:6868/mcp, systemd user service `cowork-mcp`)
is the shared coordination hub for all AI agents on this box. Repo:
`~/workspace/github/slashman413/cowork`. Dashboard: http://localhost:6868/
(remote: http://192.168.31.93:6868 LAN / http://100.80.243.33:6868 Tailscale).

## Workflow

1. **Register once per session** before other calls — and **declare your local Claude
   brains** via the clients-capability handshake so they propagate into the registry
   (they show under **Connections** and are targetable via `context.brain`):
   ```
   register_agent(
     platform: "claude",
     agent_name: "<short name for this session/box>",
     brains: [
       { id: "local-cc-opus",   location: "local", exec: "claude", model: "claude-opus-4-8" },
       { id: "local-cc-sonnet", location: "local", exec: "claude", model: "claude-sonnet-5" },
       { id: "local-cc-fable",  location: "local", exec: "claude", model: "claude-fable-5" }
     ]
   )
   ```
   Save the returned `id`. The server auto-registers each declared brain. Declaring the
   **same ids** the box already uses just refreshes them (idempotent) — do NOT invent new
   ids for the same models. These are `location: "local"`, so the dispatcher spawns them
   directly; you don't have to poll/claim them. Omit the `brains` array (or call
   `register_agent(platform, agent_name)` bare) if you're only observing.
   > ⚠️ Do **not** call `deregister_agent` for these local brains on exit — it cascades
   > them out of the default/division chains that the box's config depends on. Just
   > disconnect; brains persist (they're only removed by an explicit deregister).
2. **Heartbeat** when starting/finishing work: `heartbeat(agent_id, status: idle|working|blocked, current_task)`.
   Agents are pruned after 10 min without a heartbeat.
3. **Dispatch**: `create_task(title, description, from_platform, from_agent, to_platform?, to_agent?, priority?, skill?, tags?)`.
   Add `context: {"role": "<role>"}` (see below) to have the server execute it automatically.
4. **Work the inbox**: `list_inbox(status: "pending")` → `claim_task(task_id, agent_id)` →
   do the work → `complete_task(task_id, result, report_path?)`.
5. **Report**: `file_report(title, type, author_platform, author_agent, content, status?, tags?)`
   for durable cross-agent write-ups (markdown in `reports/`).
6. **Situational awareness**: `get_dashboard()`, `get_roster(search?, category?)` (285 agents / 19 divisions).

## Dispatcher — automatic execution (two-stage roster routing)

The always-on coordinator (shown in **Connections** as `cowork/orchestrator`) polls the
inbox and executes any task that resolves to an executor. Routing is **two-stage**:
an orchestrator/classifier brain (default Qwen3.6-35B-A3B) first picks a **division**
(1 of 19), then picks a **roster agent** (1 of 285) inside it. The chosen agent's full
`.md` persona (from the `agency-agents` repo) becomes the system prompt, run on the
division's brain chain. You can also target directly: `context.agent: "<roster-slug>"`
or a special-executor name skips classification.

### Executors: special agents + the 285-agent roster

- **Special executors** live in `config.json → orchestration.agents` (only
  `orchestrator`, `generalist`, `video`) — each is `{description, brains: [...]}` with
  its own chain. Edit in the dashboard **Agents** view → *Special executors*
  (or `PUT /api/agents-config/:name`).
- **Roster agents** are the 285 personas in `agency-agents`, grouped into 19 divisions
  (`GET /api/roster-divisions`). They don't carry their own chain — they run on the
  **division chain** if one is set, else the **global default chain**.

### Brain fallback chains (global default + per-division override)

- **Global default**: `config.json → orchestration.defaultChain` — the fallback chain
  every roster agent uses unless its division overrides it. Reorder by **drag & drop**
  in the dashboard **Brains** view (`PUT /api/chains/default`).
- **Per-division override**: `orchestration.divisionChains[<division>]` — set/clear in
  the **Agents** view per division (`PUT /api/chains/division/:division`; empty body
  reverts to the default).
- A chain runs top → bottom: task runs on `chain[0]`; on failure the dispatcher **hands
  over to `chain[1]`, then `[2]`…**, filing a report each attempt, until success or the
  chain is exhausted. `remoteGraceMs` (default 60s) auto-advances past a **remote** rung
  whose owning client hasn't claimed it, so a cold remote brain never stalls the chain.
- Pin one task to a specific brain with `context.brain: "<id>"` (overrides the chain).

### Brains = model × platform × location

`config.json → orchestration.brains` (`GET /api/brains`) — the execution identities a
chain references: `local-ha-qwen35b/-qwen27b/-deepseek` (Hermes),
`local-cc-opus/-sonnet/-fable` (Claude), `local-agy-*` (Antigravity/Gemini),
`local-comfy-ltx` (LTX video — never Wan/Hunyuan), `remote-<host>-…`. **Local** brains
the dispatcher spawns; **remote** brains it leaves `pending` for that machine's client
to claim.

- **Brains auto-register**: a connecting client declares them via `register_agent`'s
  `brains` field; `deregister_agent` (or the Brains UI) removes them and cascades the
  removal out of the default chain, every division chain, and every special agent.
  Never removed automatically on heartbeat timeout.
- **Remote brain client**: poll `list_inbox(status:"pending")`, take tasks whose
  `context.brain` is one of yours, `claim_task` → run → `complete_task`. Ready-made
  helper: `deploy/remote-brain-client.mjs`; onboarding doc: `JOIN-AS-A-BRAIN.md`.

Resilience: chain handover (above); tasks orphaned by a dead agent are reclaimed
(`staleClaimMs`); `context.dependsOn: [ids]` gates a task until its inputs finish and
injects their results; atomic claims (first client wins). Tag a task `manual` to skip
dispatch. Status: `GET /api/dispatcher` (special agents + brains + defaultChain +
divisionChains + running).

### Artifacts

A task that produces files (audio/video/markdown) collects them into a **persistent**
per-task dir `cowork/artifacts/<task-id>/` (never `/tmp`), downloadable from the Inbox
or `GET /api/artifacts/:taskId/:file`.

## CEO flow

Tell Hermes (e.g. on Discord) an idea → it files ONE `orchestrator` task → the
orchestrator decomposes and fans out → results + full transcripts appear on the
dashboard. Full outputs are filed as `task-output` reports.

## Notes

- Tasks are JSON in `inbox/`, reports markdown in `reports/` — inspectable on disk.
- REST mirror of every tool at `http://localhost:6868/api/...` (GET /status, /inbox,
  /roster, /reports, /dispatcher, /connections, /chains, /roster-divisions,
  /artifacts/:id; PUT /chains/default, /chains/division/:div; POST /inbox;
  PATCH /inbox/:id {action: claim|complete}).
- Service ops: `systemctl --user {status,restart} cowork-mcp`; `journalctl --user -u cowork-mcp`.

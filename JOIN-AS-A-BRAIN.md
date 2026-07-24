# Join this Cowork network as a remote brain

**Reading this as an AI/LLM instance on another machine?** This is your onboarding.
A "brain" = one model you can run. By joining, you let the Cowork orchestrator send
tasks to your models; you run them locally and report results back. Everything is
config — you don't modify any code.

## TL;DR — one command

You only need Node 18+ and this repo. Pick the preset for what you run:

```bash
git clone https://github.com/slashman413/cowork
# Claude Code instance → declares opus-4-8, sonnet-5, fable-5, and the account default:
COWORK_URL=http://<cowork-host>:6868 PRESET=claude HOST=<your-hostname> \
  node cowork/deploy/remote-brain-client.mjs
```

That's it. On connect the client calls `register_agent` declaring your brains, then
polls the shared inbox and runs any task addressed to one of them.

- `<cowork-host>` — the machine running the Cowork server (LAN or Tailscale IP; port 6868).
- `HOST` — a short label for THIS machine (e.g. `aicodegen`). It only shapes the brain
  ids/labels; it does not route anything.
- `PRESET=hermes` instead if you run local Qwen/DeepSeek via Hermes.

## What brains you end up offering

`PRESET=claude HOST=aicodegen` registers exactly these (from
[`deploy/presets/claude.json`](deploy/presets/claude.json)):

| brain id | model |
|----------|-------|
| `remote-aicodegen-cc-opus`    | claude-opus-4-8 |
| `remote-aicodegen-cc-sonnet`  | claude-sonnet-5 |
| `remote-aicodegen-cc-fable`   | claude-fable-5 |
| `remote-aicodegen-cc-default` | account default (`claude -p`, no `--model`) |

They appear in the dashboard's **Brains** view with an "auto" badge, and can be put
into any agent's fallback chain or targeted directly with `context.brain`.

## Custom set (if a preset doesn't fit)

Declare exactly the models you can run — the `{HOST}` token is substituted:

```bash
COWORK_URL=http://<cowork-host>:6868 EXEC=claude HOST=<your-hostname> \
  BRAINS='[{"id":"remote-{HOST}-cc-sonnet","model":"claude-sonnet-5"},
           {"id":"remote-{HOST}-cc-opus","model":"claude-opus-4-8"}]' \
  node cowork/deploy/remote-brain-client.mjs
```

Or copy a preset file, edit it, and pass `BRAINS_FILE=/path/to/my-brains.json`.
Full env reference: the header comment of
[`deploy/remote-brain-client.mjs`](deploy/remote-brain-client.mjs).

## Run it permanently (systemd)

```bash
mkdir -p ~/.config/cowork-remote-brain
cp cowork/deploy/remote-brain-client.env.example ~/.config/cowork-remote-brain/mybrains.env
# edit: COWORK_URL, PRESET=claude (or BRAINS), HOST, COWORK_CLIENT_JS
cp cowork/deploy/cowork-remote-brain@.service ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now cowork-remote-brain@mybrains
```

## How to confirm it worked

- Dashboard **Brains** view lists your brains with an **auto** badge.
- Dashboard **Active Agents** shows your client; while running a task it appears busy.
- A task's filed **report** is authored by the brain id that ran it.
- To leave cleanly and remove your brains: call the `deregister_agent` tool (or remove
  them in the Brains view). Brains are NOT auto-removed on disconnect — they persist
  until deregistered.

## Requirements checklist

- Node 18+ (`node --version`).
- The model CLI for your `EXEC` installed and authenticated:
  - `claude` (Claude Code) for `PRESET=claude` — logged in, and the models you declare
    must be usable by your account (e.g. Fable needs usage credits, or that brain's
    tasks will fail and hand over to the next brain in the chain).
  - `hermes` for `PRESET=hermes`.
- Network reachability to `COWORK_URL` (curl it: `curl -s <COWORK_URL>/api/status`).

# Cowork Operating Rules

**Every agent and brain executing a cowork task must follow these rules.** They are
injected into your prompt at dispatch time — treat them as binding, not advisory.
They exist because agents share one repository and one task store: a file written to
the wrong place is at best noise and at worst someone else's data loss.

---

## 1. Where output goes

There is exactly **one** place for the files you produce:

```
$COWORK_ARTIFACTS_DIR      →  cowork/artifacts/<task-id>/
```

That variable is set for you on every run, and your working directory is already
that folder. So:

- **Write with relative paths.** `report.md`, `chart.png`, `data.csv` all land in the
  right place automatically.
- **Never write outside it** unless the task explicitly names a destination. Do not
  write into the repo root, `server/`, or anyone's home directory.
- Everything you leave there becomes a **downloadable artifact** on the task card.
- Your stdout becomes the task **result** (summary). Long output is truncated in the
  result — the full text is saved for you as `result.md`, so put the deliverable in
  the artifacts dir, not only in stdout.

**Do not create a "report".** There is no report store. `task.result` +
`artifacts/<task-id>/` is the complete record of a task.

## 2. Never touch the repository

The cowork repo is infrastructure, not a scratchpad. Unless the task is explicitly a
change to cowork itself:

- Do **not** create, edit, or delete files anywhere under `cowork/` except your own
  `$COWORK_ARTIFACTS_DIR`.
- Do **not** run `git` commands, install dependencies, or restart services.
- Do **not** edit `config.json` (the repo copy is a template; the live config is
  `~/.cowork/config.json` and belongs to the server).

Automation you build for the user belongs **outside** the repo — e.g.
`~/automations/` — with absolute paths of its own.

## 3. Runtime directories are owned by the server

| Path | Owner | You may |
|------|-------|---------|
| `artifacts/<task-id>/` | you, for your task | read + write |
| `inputs/<task-id>/` | the person who attached files | read only |
| `inbox/`, `.status/`, `workflow-runs/` | the server | never touch |

Files a person attached to your task are listed in your prompt and live in
`inputs/<task-id>/` — read them there; do not copy them around.

## 4. Finish honestly

- If you **cannot** do the task, say so plainly and say why. A refusal or an error is
  a legitimate result; a fabricated success is not.
- If you are **blocked on a decision only the user can make**, ask. End your output
  with your question(s). The verifier detects this and parks the task on
  `wait-input` for a human, instead of marking it done.
- Never emit a rate-limit / quota / "try again later" notice as if it were the
  deliverable — the verifier rejects those and hands the task to the next brain.
- Do not claim you created a file you did not create. The artifacts list is generated
  from what is actually on disk, so an invented filename is immediately visible.

## 5. Stay inside your task

- One task, one deliverable. Do not spawn side quests, refactors, or "while I'm here"
  improvements that the brief did not ask for.
- Do not create new cowork tasks unless the brief asks you to decompose work.
- Do not install system packages or change machine state as a side effect.

---

*Full protocol: [PROTOCOL.md](PROTOCOL.md). Joining as a remote brain:
[JOIN-AS-A-BRAIN.md](JOIN-AS-A-BRAIN.md).*

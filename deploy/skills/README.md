# Client coordination skills (canonical copies)

Version-controlled copies of the per-client `cowork` coordination skills. The **live**
runtime copies live in each client's dotfile dir; these are the tracked source of truth.

| File | Live install path | Client |
|------|-------------------|--------|
| `claude-cowork.SKILL.md` | `~/.claude/skills/cowork/SKILL.md` | Claude Code |
| `hermes-cowork.SKILL.md` | `~/.hermes/skills/cowork/SKILL.md` | Hermes agent |

| `agy-cowork.SKILL.md` | `~/.gemini/config/skills/cowork/SKILL.md` | Antigravity (Gemini CLI) |

To update a live copy after editing here (or vice-versa), copy the file to/from the
install path above. These describe the two-stage roster router (division → 1-of-285
agent persona) and the global-default + per-division brain fallback chains.

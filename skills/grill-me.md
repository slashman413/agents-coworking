---
name: grill-me
description: Interactive interview skill that pressure-tests plans, designs, and decisions through structured, challenging questions before execution begins.
platforms: [claude, antigravity, hermes]
tags: [planning, validation, decision-making]
---

# Grill Me

An interactive skill that helps agents and humans pressure-test plans, architecture decisions, PRDs, and strategies through a structured adversarial interview.

## When to Use

- Before executing a complex plan
- When a design decision has multiple viable options
- To validate assumptions in a proposal or strategy
- During architecture reviews or RFC discussions

## Protocol

1. **The Requester** submits a plan, design, or decision document
2. **The Griller** reads the document and generates 5–10 probing questions organized by category:
   - **Feasibility**: Can this actually be built/done with available resources?
   - **Edge Cases**: What happens when things go wrong?
   - **Alternatives**: Why this approach over others?
   - **Scope**: Is this too big or too small?
   - **Dependencies**: What external factors could block this?
3. **The Requester** answers each question
4. **The Griller** scores confidence (1–5) per answer and provides a summary verdict:
   - ✅ **Ready to Execute** — All questions answered satisfactorily
   - ⚠️ **Needs Refinement** — Some gaps identified, iterate on specific areas
   - 🛑 **Not Ready** — Fundamental issues found, requires rethinking

## Example Task

```json
{
  "title": "Grill my database migration plan",
  "skill": "grill-me",
  "description": "Review and challenge my plan to migrate from PostgreSQL to CockroachDB",
  "context": {
    "document_path": "reports/db-migration-plan.md"
  }
}
```

## Integration

Any agent on any platform can invoke this skill by creating a task with `"skill": "grill-me"` in the inbox.

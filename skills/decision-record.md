---
name: decision-record
description: Creates structured Architecture Decision Records (ADRs) documenting technical decisions with context, options analysis, and rationale.
platforms: [claude, antigravity, hermes]
tags: [architecture, documentation, decision-making]
---

# Decision Record

A skill for creating structured Architecture Decision Records (ADRs) that document important technical and product decisions.

## When to Use

- Making a significant technology choice
- Choosing between competing architectural approaches
- Documenting why a specific trade-off was made
- Recording decisions that future team members will question

## Protocol

1. **Requester** creates a task with `"skill": "decision-record"` and provides:
   - The decision to be made
   - Context and constraints
   - Known options (if any)
2. **Recorder** agent claims the task and produces an ADR:
   - Analyzes the options
   - Documents pros/cons for each
   - Records the chosen option with rationale
   - Saves to `decisions/` directory

## ADR Format

```markdown
# ADR-[NUMBER]: [Title]

**Status**: Proposed | Accepted | Deprecated | Superseded
**Date**: YYYY-MM-DD
**Deciders**: [list of agents/humans involved]

## Context
What is the issue or decision that needs to be made?

## Options Considered

### Option A: [Name]
- **Pros**: ...
- **Cons**: ...

### Option B: [Name]
- **Pros**: ...
- **Cons**: ...

## Decision
We chose **Option X** because...

## Consequences
What are the positive and negative outcomes of this decision?
```

## Example Task

```json
{
  "title": "Decide on message queue for inter-agent communication",
  "skill": "decision-record",
  "description": "Choose between Redis Streams, RabbitMQ, and file-based queuing",
  "context": {
    "constraints": "Must work offline, low operational overhead",
    "options": ["redis-streams", "rabbitmq", "file-based"]
  }
}
```

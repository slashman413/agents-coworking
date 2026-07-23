---
name: task-breakdown
description: Decomposes large, complex tasks into smaller, actionable subtasks with dependencies and priority ordering.
platforms: [claude, antigravity, hermes]
tags: [planning, project-management, decomposition]
---

# Task Breakdown

A skill for decomposing a large, complex task into smaller, well-defined subtasks that can be distributed across agents and platforms.

## When to Use

- A task is too large for a single agent to complete
- Work needs to be parallelized across multiple agents
- Dependencies between subtasks need to be mapped
- A project needs a structured execution plan

## Protocol

1. **Requester** creates a task with `"skill": "task-breakdown"` and provides:
   - The large task description
   - Constraints (time, resources, platform capabilities)
   - Desired granularity
2. **Planner** agent claims the task and produces:
   - A list of subtasks with clear acceptance criteria
   - Dependency graph (which tasks block which)
   - Priority ordering
   - Suggested agent/platform assignments
3. **Planner** creates individual inbox tasks for each subtask

## Output Format

```markdown
# Task Breakdown: [Original Task Title]

## Subtasks

### 1. [Subtask Title]
- **Priority**: P0 / P1 / P2
- **Estimated Effort**: Small / Medium / Large
- **Dependencies**: None / [list of subtask IDs]
- **Suggested Platform**: claude / antigravity / hermes / any
- **Acceptance Criteria**:
  - [ ] Criterion 1
  - [ ] Criterion 2

### 2. [Subtask Title]
...
```

## Example Task

```json
{
  "title": "Break down the authentication system redesign",
  "skill": "task-breakdown",
  "description": "Decompose the full auth system redesign into manageable subtasks",
  "context": {
    "scope": "OAuth2, SSO, session management, password reset",
    "max_subtasks": 10
  }
}
```

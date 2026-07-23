---
name: code-review
description: Cross-platform code review skill that provides constructive, actionable feedback on correctness, maintainability, security, and performance.
platforms: [claude, antigravity, hermes]
tags: [engineering, quality, review]
---

# Code Review

A structured code review skill that any agent can invoke to get thorough, constructive feedback on code changes.

## When to Use

- After completing a feature implementation
- Before merging changes to a shared branch
- When refactoring existing code
- To validate security-sensitive changes

## Review Dimensions

1. **Correctness**: Does the code do what it's supposed to do?
2. **Maintainability**: Is the code easy to understand and modify?
3. **Security**: Are there any vulnerabilities or unsafe patterns?
4. **Performance**: Are there obvious performance issues?
5. **Style**: Does the code follow project conventions?

## Protocol

1. **Requester** creates a task with `"skill": "code-review"` and provides:
   - File paths to review
   - Context about what the code does
   - Any specific concerns
2. **Reviewer** agent claims the task and provides structured feedback:
   - A summary verdict (approve / request-changes / comment)
   - Line-specific comments with severity (critical / warning / suggestion / nitpick)
   - Overall assessment

## Example Task

```json
{
  "title": "Review MCP server authentication changes",
  "skill": "code-review",
  "description": "Review the new auth middleware added to the Express server",
  "context": {
    "files": ["server/src/api/auth.ts", "server/src/index.ts"],
    "focus": "security"
  }
}
```

## Output Format

The reviewer files a report in `reports/` with the review findings as a markdown document.

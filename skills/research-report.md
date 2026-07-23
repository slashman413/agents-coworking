---
name: research-report
description: Structured research and analysis skill that produces comprehensive, cited reports on any topic.
platforms: [claude, antigravity, hermes]
tags: [research, analysis, documentation]
---

# Research Report

A skill for conducting structured research on a topic and producing a comprehensive, well-organized markdown report.

## When to Use

- Evaluating technology choices or vendor options
- Competitive analysis or market research
- Deep-diving into a technical problem domain
- Gathering best practices for a new initiative

## Protocol

1. **Requester** creates a task with `"skill": "research-report"` and provides:
   - Research question or topic
   - Scope constraints (what to include/exclude)
   - Desired depth (overview vs. deep-dive)
   - Deadline if applicable
2. **Researcher** agent claims the task and:
   - Gathers information from available sources
   - Organizes findings into structured sections
   - Provides citations and references
   - Files a report in `reports/`

## Report Structure

```markdown
# [Topic] Research Report

## Executive Summary
Brief overview of key findings.

## Background
Context and why this research matters.

## Findings
### Finding 1
### Finding 2
...

## Recommendations
Actionable next steps based on findings.

## References
Sources and citations.
```

## Example Task

```json
{
  "title": "Research WebSocket vs SSE for real-time dashboard",
  "skill": "research-report",
  "description": "Compare WebSocket and Server-Sent Events for our dashboard use case",
  "context": {
    "scope": "performance, browser support, complexity",
    "depth": "deep-dive"
  }
}
```

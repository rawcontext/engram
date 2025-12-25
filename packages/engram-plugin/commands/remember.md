---
description: Store important information to long-term memory
allowed-tools: engram_remember, engram_enrich_memory
---

# Remember

Persist valuable information to long-term memory for future sessions.

## Instructions

1. Parse the user's input for:
   - **Content**: The information to store (required)
   - **Type**: One of `decision`, `preference`, `insight`, `fact` (can be inferred or asked)
   - **Tags**: Keywords for discovery (can be inferred from content)

2. If type is unclear, infer from content patterns:
   - "We decided...", "Chose X over Y", "The approach is..." → `decision`
   - "Always...", "Never...", "Prefer...", "I like..." → `preference`
   - "Discovered...", "Found that...", "The issue was..." → `insight`
   - Objective statements, conventions, patterns → `fact`

3. If content is vague, optionally call `engram_enrich_memory` first to:
   - Generate a summary
   - Suggest keywords/tags
   - Confirm the category

4. Call `engram_remember` with:
   - `content`: Clear, self-contained statement (will be retrieved out of context)
   - `type`: The memory type
   - `tags`: Relevant keywords (lowercase, specific terms)

5. Confirm what was stored

## Memory Type Guide

| Type | Use For | Examples |
|------|---------|----------|
| `decision` | Architectural choices with rationale | "Chose Redis over Memcached for pub/sub support" |
| `preference` | User conventions, always/never rules | "Always use tabs, never spaces" |
| `insight` | Debugging discoveries, non-obvious learnings | "NATS reconnection requires explicit drain" |
| `fact` | Objective info about codebase/domain | "API rate limit is 100 req/min" |

## Example Usage

```
/engram:remember We chose bitemporal modeling to support time-travel queries
/engram:remember Always run typecheck before committing --type=preference
/engram:remember The flaky test was caused by timezone assumptions in date comparison
```

---
description: Search memories using semantic similarity
allowed-tools: engram_recall
---

# Recall Memory

Search long-term memory using semantic similarity to find relevant past context.

## Instructions

1. Call the `engram_recall` tool with:
   - `query`: The search text from the user (everything after `/engram:recall`)
   - `limit`: Default to 5, increase if user asks for "more" or "all"
   - `filters`: Parse any flags the user provides:
     - `--type=decision` → filter to decisions only
     - `--type=preference` → filter to preferences only
     - `--type=insight` → filter to insights only
     - `--type=fact` → filter to facts only
   - `rerank`: Default to true for better relevance

2. Present the results clearly:
   - Group by type if mixed results
   - Show relevance scores
   - Highlight the most relevant findings

3. Offer to dive deeper into any specific memory if useful

## Example Usage

```
/engram:recall authentication decisions
/engram:recall why we chose FalkorDB --type=decision
/engram:recall user preferences for code style --type=preference
/engram:recall debugging the NATS connection --type=insight
```

If no query is specified, ask: "What would you like to search for in memory?"

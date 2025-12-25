---
description: Initialize a work session with relevant context from memory
allowed-tools: engram_context, engram_recall
---

# Prime Session

Initialize this session by loading relevant memories, past decisions, and file history for the task at hand.

## Instructions

1. Call the `engram_context` tool with:
   - `task`: Use any text following this command, or ask the user what they're working on
   - `depth`: Use "medium" by default, or "deep" if the user mentions a complex task
   - `files`: If the user mentions specific files, include them

2. Review the returned context for:
   - **Decisions**: Past architectural choices that should inform current work
   - **Preferences**: User conventions and patterns to follow
   - **Insights**: Debugging discoveries or non-obvious learnings
   - **File history**: Recent modifications to relevant files

3. Summarize the key points that are relevant to the current task

4. Ask if the user wants to proceed with the task or needs any clarification based on the retrieved context

## Example Usage

```
/engram:prime implementing the search reranking pipeline
/engram:prime refactoring the graph writer
/engram:prime
```

If no task is specified, ask: "What are you working on today?"

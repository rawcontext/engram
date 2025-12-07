# Bead: Implement Context Window Manager

## Context
We cannot stuff infinite memory into the LLM context.

## Goal
Implement a strategy to select *what* goes into the prompt.

## Strategy
1.  **System Prompt**: Fixed.
2.  **Recent History**: Last N messages (sliding window).
3.  **Relevant Memories**: Results from `Semantic Search` (retrieved based on current query).
4.  **Active File**: Content of the file currently being edited.
5.  **Token Counting**: Use `tiktoken` (or similar) to ensure `Total < ContextLimit - Headroom`.

## Acceptance Criteria
-   [ ] `ContextAssembler` service implemented.
-   [ ] Pruning logic (drop oldest history first, keep system prompt).

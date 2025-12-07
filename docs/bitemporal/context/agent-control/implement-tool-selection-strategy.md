# Bead: Implement Tool Selection Strategy

## Context
The agent might have 50 tools. Sending all schemas to the LLM consumes tokens and confuses it.

## Goal
Dynamically select relevant tools.

## Strategy
-   **Static**: For now, just expose the Core Tools (Memory + Execution).
-   **Dynamic (Future)**: Use Semantic Search to find tools matching the user query, then inject only *those* schemas. *Decision: Stick to Static Core Tools for V1.*

## Acceptance Criteria
-   [ ] `ToolRegistry` defined with a static list of Core Tools.

# Bead: Define Decision Loop Logic

## Context
The core logic that drives the "Step 4: Decide" phase of the workflow.

## Goal
Implement the logic that interprets the LLM's output and routes control.

## Logic
-   **Input**: LLM Stream.
-   **Detection**:
    -   If `tool_calls` present -> **ACT**.
    -   If `<thinking>` present -> **LOG THOUGHT**.
    -   If plain text -> **SPEAK**.
-   **Routing**: Triggers the appropriate next step in the Workflow.

## Acceptance Criteria
-   [ ] `DecisionEngine` class implemented.
-   [ ] Handles mixed content (thought + tool call in same turn).

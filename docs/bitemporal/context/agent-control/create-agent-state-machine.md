# Bead: Create Agent State Machine

## Context
While Workflows handle the linear flow, we need a State Machine to handle the *lifecycle* of the agent (Idle, Thinking, Executing, AwaitingInput, Error).

## Goal
Define an XState machine (or Mastra's internal state equivalent) to track *status*.

## States
-   `IDLE`: Waiting for event.
-   `ANALYZING`: Querying Memory/Search.
-   `DELIBERATING`: Generating thoughts.
-   `ACTING`: Waiting for Tool Execution.
-   `REVIEWING`: Analyzing Tool Output.
-   `RESPONDING`: Streaming back to user.

## Acceptance Criteria
-   [ ] `src/state/agent_machine.ts` created.
-   [ ] State transitions defined.

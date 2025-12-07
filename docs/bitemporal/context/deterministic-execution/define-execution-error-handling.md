# Bead: Define Execution Error Handling

## Context
Tools fail. Code has bugs.

## Goal
Standardize error reporting.

## Schema
-   **UserError**: Bug in the script (SyntaxError, Exception).
-   **SystemError**: Sandbox failure, Timeout, OOM.

## Handling
-   **UserError**: Return as `Observation` with `is_error: true`. Agent sees it and can fix the code.
-   **SystemError**: Log to infrastructure, return generic "System Error" to agent (maybe retry).

## Acceptance Criteria
-   [ ] Error types defined.
-   [ ] Executor catches and classifies errors correctly.

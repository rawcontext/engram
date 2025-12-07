# Bead: Implement Deterministic Replay Engine

## Context
Crucial capability: "Replay this exact session with the exact same inputs."

## Goal
Ensure that given a `session_id`, we can re-run the code execution and get the *exact* same result (assuming code logic is deterministic).

## Strategy
-   **Inputs**: Rehydrate VFS + Tool Arguments.
-   **Randomness**: Seed the Random Number Generator (RNG) inside Wasm if possible, or mock `Math.random` via imports (if custom import object used).
-   **Time**: Mock `Date.now()` via modified WASI imports or system clock setting in the runtime config.

## Acceptance Criteria
-   [ ] `ReplayEngine` class.
-   [ ] Takes `ParsedEvent` (ToolCall) -> Reconstructs State -> Runs -> Verifies Output matches original `Observation`.

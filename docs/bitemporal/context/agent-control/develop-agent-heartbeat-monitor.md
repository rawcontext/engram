# Bead: Develop Agent Heartbeat Monitor

## Context
Agents can hang (infinite loops, stuck tool calls).

## Goal
A background monitor to ensure liveness.

## Logic
-   **Watchdog**: If state remains `ACTING` for > 30s without update, trigger `TimeoutError`.
-   **Recovery**: Cancel tool call, insert Error Observation, prompt Agent to retry or fail.

## Acceptance Criteria
-   [ ] `HeartbeatService` implemented.

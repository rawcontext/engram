# Bead: Develop Session Replay Endpoint

## Context
Triggering the Deterministic Execution engine to replay a session.

## Goal
`POST /api/replay`

## Logic
1.  Accept `sessionId`.
2.  Send command to **Execution Service** (via MCP `start_replay`).
3.  Return `jobId`.

## Acceptance Criteria
-   [ ] Route implemented.

# Bead: Create Agent Session Initializer

## Context
When a new conversation starts.

## Goal
Bootstrap the session.

## Logic
1.  Generate `session_id`.
2.  Create `SessionNode` in Memory (via MCP).
3.  Emit `SessionStarted` event to Redpanda (via Ingestion or direct).
4.  Initialize `ContextAssembler`.

## Acceptance Criteria
-   [ ] `SessionManager.start()` implemented.

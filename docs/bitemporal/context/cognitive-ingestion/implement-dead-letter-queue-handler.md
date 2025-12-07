# Bead: Implement Dead Letter Queue Handler

## Context
If the parser fails (e.g., malformed JSON from OpenAI), we shouldn't crash the stream. We should route the bad event to a DLQ.

## Goal
Capture failed events for inspection.

## Strategy
-   **Topic**: `ingestion.dead_letter`
-   **Logic**:
    -   Try to parse/process.
    -   Catch error.
    -   Publish original payload + error metadata to DLQ topic.
    -   Log error with severity `ERROR`.

## Acceptance Criteria
-   [ ] DLQ Topic created.
-   [ ] `try-catch` block in the Ingestion Processor routes to DLQ.

# Bead: Define Log Aggregation (Cloud Logging)

## Context
Centralized logging is vital for observability. Cloud Run automatically captures `stdout`/`stderr`.

## Goal
Ensure application logs are structured (JSON) so Cloud Logging can parse severity, timestamps, and metadata.

## Standard
-   **Format**: JSON (newline delimited).
-   **Library**: `pino` (Node/Bun) or `structlog` (Python).
-   **Required Fields**:
    -   `severity`: (INFO, WARNING, ERROR) - *Critical for GCP detection.*
    -   `message`: Human readable text.
    -   `trace`: GCP Trace ID (for distributed tracing correlation).
    -   `component`: (ingestion, memory, etc.)

## Example (TypeScript/Pino)
```typescript
import pino from 'pino';

const logger = pino({
  level: 'info',
  formatters: {
    level: (label) => {
      return { severity: label.toUpperCase() }; // Map pino level to GCP severity
    },
  },
  messageKey: 'message',
});

logger.info({ event_id: '123' }, 'Ingested event');
```

## Acceptance Criteria
-   [ ] `packages/logger` library created with GCP-compatible defaults.
-   [ ] All services verify log output format in tests.

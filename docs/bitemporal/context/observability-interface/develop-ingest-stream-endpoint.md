# Bead: Develop Ingest Stream Endpoint

## Context
For testing and simple integrations, we need an HTTP endpoint that accepts JSON events and pushes them to Redpanda (Cognitive Ingestion).

## Goal
`POST /api/ingest`

## Logic
1.  Validate Body (Zod `RawStreamEvent`).
2.  Push to Redpanda `raw_events` topic.
3.  Return `202 Accepted` + `event_id`.

## Acceptance Criteria
-   [ ] Route implemented.
-   [ ] Integration with `packages/storage` (Kafka Producer).

# Bead: Define Raw Stream Event Schema

## Context
The **Cognitive Ingestion** bounded context serves as the system's "Nervous System," accepting raw signals from various LLM providers (Anthropic, OpenAI). To ensure downstream consistency for the **Bitemporal Memory** ("Hippocampus") and **Deterministic Execution** layers, we must normalize these divergent inputs into a single, canonical `RawStreamEvent` schema.

## Goal
Define a strict JSON schema (using Zod) that encapsulates incoming LLM stream events, preserving vendor-specific metadata while providing a unified interface for the `Stream Protocol Detector` and `Parser Strategies`.

## Research & Rationale
-   **OpenAI**: Uses a list of `choices` with `delta`. Usage stats are now streamed in a final chunk with `stream_options: { include_usage: true }`.
-   **Anthropic**: Uses SSE with event types (`message_start`, `content_block_delta`, `message_delta`, `message_stop`). JSON payload.
-   **Pattern**: We need a "Envelope" pattern. The `payload` field should hold the *exact* JSON received from the provider to ensure we have a perfect audit trail (replayability).

## Schema Definition (Zod)

```typescript
import { z } from 'zod';

export const ProviderEnum = z.enum(['openai', 'anthropic', 'local_mock']);

export const RawStreamEventSchema = z.object({
  // Unique ID for this specific event (UUIDv4)
  event_id: z.string().uuid(),
  
  // ISO-8601 timestamp of when the event touched our edge
  ingest_timestamp: z.string().datetime(),
  
  // Origin IP (redacted in logs, kept here for security audit if needed)
  source_ip: z.string().ip().optional(),
  
  // The declared or detected provider
  provider: ProviderEnum,
  
  // Upstream API version (e.g., '2023-06-01') if available
  protocol_version: z.string().optional(),
  
  // The EXACT raw JSON body received from the upstream SSE event
  payload: z.record(z.unknown()),
  
  // HTTP Headers relevant to tracing (x-request-id, etc.)
  headers: z.record(z.string()).optional(),
  
  // Trace ID for distributed tracing (Google Cloud Trace compatible)
  trace_id: z.string().optional(),
});

export type RawStreamEvent = z.infer<typeof RawStreamEventSchema>;
```

## Downstream Impact
-   **Redpanda**: This structure is serialized to JSON and pushed to the `raw_events` topic.
-   **Memory**: The "Parser" consumes this, extracts the text/tool-calls, and produces `ParsedEvent` objects.

## Acceptance Criteria
-   [ ] `packages/events/src/schemas/raw-stream-event.ts` created.
-   [ ] Zod schema exports `RawStreamEventSchema` and type.
-   [ ] Unit tests validate sample payloads from OpenAI and Anthropic documentation.

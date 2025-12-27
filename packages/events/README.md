# @engram/events

Type-safe event schemas for the Engram streaming pipeline. Zod schemas and TypeScript types for validating and transforming LLM provider events.

## Purpose

Defines two core event types in Engram's bitemporal memory system:

1. **RawStreamEvent**: Provider-specific payloads as received from LLMs
2. **ParsedStreamEvent**: Normalized events after ingestion processing

Events flow: External Provider → Ingestion → NATS → Memory → FalkorDB

## Schemas

### RawStreamEvent

Raw provider payloads before processing.

```typescript
import { RawStreamEventSchema, generateEventId } from "@engram/events";

const rawEvent = RawStreamEventSchema.parse({
  event_id: generateEventId(),
  ingest_timestamp: new Date().toISOString(),
  provider: "anthropic", // openai, gemini, xai, claude_code, cline, codex, opencode, local_mock
  payload: { type: "content_block_delta", delta: { text: "Hello" } },
  headers: { "x-api-version": "2023-06-01" }, // optional
  // Bitemporal fields auto-generated if omitted
});
```

### ParsedStreamEvent

Normalized events with 6 types: `content`, `thought`, `tool_call`, `diff`, `usage`, `control`.

```typescript
import { ParsedStreamEventSchema, generateEventId } from "@engram/events";

const content = ParsedStreamEventSchema.parse({
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "content",
  role: "assistant", // user | assistant | system
  content: "Here's the solution...",
});

const toolCall = ParsedStreamEventSchema.parse({
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "tool_call",
  tool_call: { id: "call_abc", name: "read_file", arguments_delta: '{"path": "src/index.ts"}', index: 0 },
});

// Other types: thought, diff, usage, control (see src/index.ts)
```

## Bitemporal Fields

All events include `vt_start/vt_end` (valid time) and `tt_start/tt_end` (transaction time) for time-travel queries. Defaults to `Date.now()` and `253402300799000` (year 9999).

## Usage in Pipeline

```typescript
import { RawStreamEventSchema, ParsedStreamEventSchema, generateEventId } from "@engram/events";

// 1. Validate raw event from provider
const rawEvent = RawStreamEventSchema.parse({
  event_id: generateEventId(),
  ingest_timestamp: new Date().toISOString(),
  provider: "anthropic",
  payload: providerPayload,
});

// 2. Transform to parsed event
const parsedEvent = ParsedStreamEventSchema.parse({
  event_id: generateEventId(),
  original_event_id: rawEvent.event_id,
  timestamp: new Date().toISOString(),
  type: "content",
  role: "assistant",
  content: extractedContent,
});

// 3. Publish to NATS
await nats.sendEvent("events.parsed", sessionId, parsedEvent);
```

## Related Packages

- **@engram/parser**: Provider-specific parsers that transform raw events
- **@engram/storage**: NATS client for publishing events
- **@engram/graph**: Graph models that consume parsed events
- **apps/ingestion**: HTTP API for receiving provider webhooks (port 6175)
- **apps/memory**: NATS consumer that persists events to FalkorDB

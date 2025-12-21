# @engram/events

Type-safe event schema definitions for the Engram streaming pipeline. Provides Zod schemas and TypeScript types for validating and transforming LLM provider events through the ingestion pipeline.

## Overview

This package defines the event schemas used throughout Engram's bitemporal memory system. Events flow from raw provider payloads to normalized parsed events, with full validation and type safety at each stage.

## Installation

```bash
npm install @engram/events
```

## Key Features

- Zod 4.x schemas for runtime validation and static type inference
- Bitemporal field support (valid time and transaction time) for time-travel queries
- Support for 9 LLM providers (Anthropic, OpenAI, Gemini, XAI, Claude Code, Cline, Codex, OpenCode, local_mock)
- Type-safe event parsing with automatic defaults
- Comprehensive event types: content, thought, tool_call, diff, usage, control

## Exported APIs

### Utility Functions

#### `generateEventId()`

Generates a unique UUID v4 event identifier.

```typescript
import { generateEventId } from "@engram/events";

const eventId = generateEventId();
// "123e4567-e89b-12d3-a456-426614174000"
```

### Provider Enum

Zod enum for validating LLM provider identifiers.

```typescript
import { ProviderEnum } from "@engram/events";

// Supported providers
ProviderEnum.parse("openai");
ProviderEnum.parse("anthropic");
ProviderEnum.parse("gemini");
ProviderEnum.parse("xai");
ProviderEnum.parse("claude_code");
ProviderEnum.parse("cline");
ProviderEnum.parse("codex");
ProviderEnum.parse("opencode");
ProviderEnum.parse("local_mock");
```

### Raw Stream Events

Events as received from LLM providers before processing. These represent the raw provider payloads with minimal structure.

**Schema**: `RawStreamEventSchema`
**Type**: `RawStreamEvent`

```typescript
import { RawStreamEventSchema, type RawStreamEvent, generateEventId } from "@engram/events";

const rawEvent: RawStreamEvent = {
  event_id: generateEventId(),
  ingest_timestamp: new Date().toISOString(),
  provider: "anthropic",
  payload: {
    type: "content_block_delta",
    delta: { text: "Hello world" }
  },
  headers: {
    "x-api-version": "2023-06-01"
  },
  // Bitemporal fields (optional, auto-generated if omitted)
  vt_start: Date.now(),
  vt_end: 253402300799000,
  tt_start: Date.now(),
  tt_end: 253402300799000
};

// Validate and parse
const validated = RawStreamEventSchema.parse(rawEvent);
```

**Required Fields**:
- `event_id` (string, UUID v4)
- `ingest_timestamp` (ISO 8601 datetime string)
- `provider` (one of ProviderEnum values)
- `payload` (record of arbitrary provider data)

**Optional Fields**:
- `headers` (record of string key-value pairs)
- `vt_start`, `vt_end`, `tt_start`, `tt_end` (bitemporal timestamps, auto-generated)

### Parsed Stream Events

Normalized events after ingestion processing. The ingestion service transforms raw provider events into this standardized format.

**Schema**: `ParsedStreamEventSchema`
**Type**: `ParsedStreamEvent`

```typescript
import { ParsedStreamEventSchema, type ParsedStreamEvent, generateEventId } from "@engram/events";

// Content event
const contentEvent: ParsedStreamEvent = {
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "content",
  role: "assistant",
  content: "Here's the solution...",
};

// Thought event (extended thinking)
const thoughtEvent: ParsedStreamEvent = {
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "thought",
  thought: "First, I need to analyze the requirements...",
};

// Tool call event
const toolCallEvent: ParsedStreamEvent = {
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "tool_call",
  tool_call: {
    id: "call_abc123",
    name: "read_file",
    arguments_delta: '{"path": "src/index.ts"}',
    index: 0
  },
};

// Diff event (code changes)
const diffEvent: ParsedStreamEvent = {
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "diff",
  diff: {
    file: "src/index.ts",
    hunk: "@@ -1,3 +1,3 @@\n-const x = 1;\n+const x = 2;"
  },
};

// Usage event (token consumption)
const usageEvent: ParsedStreamEvent = {
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "usage",
  usage: {
    input_tokens: 150,
    output_tokens: 75
  },
};

// Control event (session management)
const controlEvent: ParsedStreamEvent = {
  event_id: generateEventId(),
  original_event_id: generateEventId(),
  timestamp: new Date().toISOString(),
  type: "control",
  metadata: {
    action: "session_start",
    session_id: "sess_xyz789"
  }
};

// Validate
ParsedStreamEventSchema.parse(contentEvent);
```

**Required Fields**:
- `event_id` (string, UUID v4)
- `original_event_id` (string, UUID v4, references the raw event)
- `timestamp` (ISO 8601 datetime string)
- `type` (one of: "content", "thought", "tool_call", "diff", "usage", "control")

**Optional Fields**:
- `role` ("user" | "assistant" | "system")
- `content` (text content from assistant)
- `thought` (extended thinking content)
- `tool_call` (object with id, name, arguments_delta, index)
- `diff` (object with file path and hunk)
- `usage` (object with input_tokens, output_tokens)
- `metadata` (arbitrary key-value pairs)
- `vt_start`, `vt_end`, `tt_start`, `tt_end` (bitemporal timestamps, auto-generated)

## Event Types

### Content Events
Text responses from the assistant, categorized by role (user, assistant, system).

### Thought Events
Extended thinking or reasoning content, typically from models with chain-of-thought capabilities.

### Tool Call Events
Function/tool invocations with arguments. Supports streaming with `arguments_delta` field.

### Diff Events
Code changes represented as unified diff hunks, associated with specific files.

### Usage Events
Token consumption metrics (input/output tokens) for billing and monitoring.

### Control Events
Session lifecycle and control flow events (start, stop, pause, resume).

## Bitemporal Fields

All events include bitemporal timestamps for time-travel queries:

- `vt_start` / `vt_end`: Valid time (when the fact was true in reality)
- `tt_start` / `tt_end`: Transaction time (when the fact was recorded in the system)

Default values:
- `vt_start`, `tt_start`: Current timestamp (`Date.now()`)
- `vt_end`, `tt_end`: Maximum date (year 9999, `253402300799000`)

These fields enable querying historical states and retroactive corrections in the graph database.

## Event Flow

```
External LLM Provider
    ↓
Raw Stream Event (provider-specific payload)
    ↓ Ingestion Service (packages/parser)
Parsed Stream Event (normalized)
    ↓ Kafka (parsed_events topic)
Memory Service
    ↓
Graph Nodes (FalkorDB, bitemporal)
```

## Usage in Ingestion Pipeline

```typescript
import { RawStreamEventSchema, ParsedStreamEventSchema, generateEventId } from "@engram/events";

// 1. Receive raw event from provider webhook
const rawEvent = RawStreamEventSchema.parse({
  event_id: generateEventId(),
  ingest_timestamp: new Date().toISOString(),
  provider: "anthropic",
  payload: providerPayload
});

// 2. Transform to parsed event
const parsedEvent = ParsedStreamEventSchema.parse({
  event_id: generateEventId(),
  original_event_id: rawEvent.event_id,
  timestamp: new Date().toISOString(),
  type: "content",
  role: "assistant",
  content: extractedContent
});

// 3. Publish to Kafka for downstream processing
await kafka.send({ topic: "parsed_events", messages: [parsedEvent] });
```

## Dependencies

- **zod** (^4.2.1): Runtime schema validation and type inference

## Related Packages

- `@engram/parser`: Provider-specific parsers that transform raw events
- `@engram/storage`: Kafka client for publishing events
- `@engram/graph`: Graph models that consume parsed events

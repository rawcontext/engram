# @engram/events

Event schema definitions for the Engram streaming pipeline.

## Overview

Standardizes event formats for stream ingestion using Zod schemas. Ensures validation and type safety across the event pipeline.

## Installation

```bash
npm install @engram/events
```

## Exports

### Provider Enum

```typescript
import { ProviderEnum } from "@engram/events";

// Supported LLM providers
ProviderEnum.OPENAI;
ProviderEnum.ANTHROPIC;
ProviderEnum.GEMINI;
ProviderEnum.CLAUDE_CODE;
ProviderEnum.CODEX;
ProviderEnum.XAI;
```

### Raw Stream Events

Events as received from LLM providers before processing.

```typescript
import { RawStreamEventSchema, type RawStreamEvent } from "@engram/events";

const event: RawStreamEvent = {
  id: "uuid",
  timestamp: new Date().toISOString(),
  provider: "anthropic",
  payload: { ... },
};

// Validate
RawStreamEventSchema.parse(event);
```

### Parsed Stream Events

Normalized events after ingestion processing.

```typescript
import { ParsedStreamEventSchema, type ParsedStreamEvent } from "@engram/events";

const event: ParsedStreamEvent = {
  id: "uuid",
  timestamp: new Date().toISOString(),
  provider: "anthropic",
  session_id: "session-123",
  content: "Response text",
  thought: "<thinking>...</thinking>",
  tool_call: { name: "read_file", arguments: { path: "..." } },
  diff: { file: "src/index.ts", changes: "..." },
  usage: { input_tokens: 100, output_tokens: 50 },
};
```

## Event Flow

```
Raw Events (from providers)
    ↓ Ingestion Service
Parsed Events (normalized)
    ↓ Memory Service
Graph Nodes (persisted)
```

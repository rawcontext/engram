# Bead: Implement Stream Protocol Detector

## Context
The system receives a unified stream of bytes via a single endpoint (e.g., `/api/ingest`) or specific provider webhooks. The **Stream Protocol Detector** acts as the initial classifier in the Ingestion Service, determining whether an incoming payload corresponds to an Anthropic stream or an OpenAI stream before tagging it.

## Goal
Implement a lightweight, high-performance logic to fingerprint incoming requests and tag them with the correct `provider` enum value.

## Research & Rationale
-   **Performance**: Detection happens on the hot path. We should inspect HTTP Headers first, then body structure.
-   **Signatures**:
    -   *Anthropic*: Headers often contain `anthropic-version`. Body events have `type` fields like `message_start` or `content_block_delta`.
    -   *OpenAI*: Headers have `Authorization: Bearer sk-...`. Body chunks have `object: "chat.completion.chunk"`.

## Implementation Strategy

```typescript
import { IncomingHttpHeaders } from 'http';

type Protocol = 'openai' | 'anthropic' | 'unknown';

export function detectProtocol(headers: IncomingHttpHeaders, bodyChunk: any): Protocol {
  // 1. Header Check (Fastest)
  if (headers['anthropic-version']) return 'anthropic';
  
  // 2. Body Structure Check (Robust)
  if (bodyChunk) {
    // Anthropic Event Shape
    if (bodyChunk.type === 'message_start' || bodyChunk.type === 'content_block_delta') {
      return 'anthropic';
    }
    
    // OpenAI Event Shape
    if (bodyChunk.object === 'chat.completion.chunk') {
      return 'openai';
    }
    
    // Azure OpenAI (often resembles OpenAI but might have specific fields)
    if (bodyChunk.object === 'chat.completion.chunk' && bodyChunk.model_extra) {
      return 'openai'; // Treat as OpenAI compatible
    }
  }

  return 'unknown';
}
```

## Acceptance Criteria
-   [ ] `packages/ingestion-core` library created.
-   [ ] `detectProtocol` function implemented.
-   [ ] Tests cover standard headers and body chunks for both providers.
-   [ ] "Unknown" fallback behavior defined (log warning, tag as unknown).

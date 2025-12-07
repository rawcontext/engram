# Bead: Create Anthropic Parser Strategy

## Context
Anthropic's streaming format is event-based (SSE). We need to parse these specific events into a normalized structure that the rest of the system can understand.

## Goal
Implement a `ParserStrategy` that converts Anthropic `RawStreamEvent` payloads into a generic `StreamDelta` format.

## Research & Rationale
-   **Events**:
    -   `message_start`: Contains usage info (input tokens).
    -   `content_block_start`: Defines if block is `text` or `tool_use`.
    -   `content_block_delta`: Contains the actual text fragment or JSON patch for tool args.
    -   `message_delta`: Contains usage info (output tokens) and stop reason.
-   **Thinking Blocks**: Claude 3.7+ might introduce explicit "thinking" blocks. Even if not, we handle standard `content_block` types.

## Strategy Interface
```typescript
interface StreamDelta {
  content?: string;
  toolCall?: {
    name?: string;
    id?: string;
    args?: string; // Partial JSON
  };
  usage?: {
    input?: number;
    output?: number;
  };
  stopReason?: string;
}
```

## Parsing Logic (Anthropic)
-   **Input**: `RawStreamEvent.payload` (typed as `AnthropicEvent`).
-   **Logic**:
    -   `message_start`: Extract `message.usage.input_tokens`.
    -   `content_block_start`: If `tool_use`, initialize tool call ID.
    -   `content_block_delta`: 
        -   If `delta.type === 'text_delta'`, return `{ content: delta.text }`.
        -   If `delta.type === 'input_json_delta'`, return `{ toolCall: { args: delta.partial_json } }`.
    -   `message_delta`: Extract `usage.output_tokens` and `delta.stop_reason`.

## Acceptance Criteria
-   [ ] `AnthropicParser` class implemented implementing a common `Parser` interface.
-   [ ] Correctly extracts text deltas.
-   [ ] Correctly extracts and reassembles partial JSON tool arguments.
-   [ ] Captures token usage statistics from start and delta events.

# Bead: Create OpenAI Parser Strategy

## Context
OpenAI's streaming format uses `chat.completion.chunk` objects.

## Goal
Implement a `ParserStrategy` for OpenAI events.

## Research & Rationale
-   **Structure**: `choices[0].delta` contains `content` (string) or `tool_calls` (array).
-   **Usage**: The *final* chunk (if `stream_options` enabled) contains a `usage` field and an empty `choices` array.

## Parsing Logic (OpenAI)
-   **Input**: `RawStreamEvent.payload` (typed as `OpenAIChunk`).
-   **Logic**:
    -   Check `usage`: If present, return `{ usage: { ... } }`.
    -   Check `choices[0].delta.content`: If present, return `{ content: ... }`.
    -   Check `choices[0].delta.tool_calls`:
        -   OpenAI tool calls stream index-based updates.
        -   Map `index` to a specific tool call in the normalized output.
        -   Return `{ toolCall: { index, id, name, args } }`.

## Acceptance Criteria
-   [ ] `OpenAIParser` class implemented.
-   [ ] Handles standard text content.
-   [ ] Handles multi-tool call streaming (rare but possible).
-   [ ] correctly extracts usage stats from the final chunk.

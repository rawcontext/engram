# Bead: Implement Tool Call Extractor

## Context
While providers have native tool calling APIs, sometimes we force tool use via text/XML for advanced scenarios. Also, we need to normalize native tool calls (OpenAI/Anthropic) into a single structure.

## Goal
Ensure both "Native" tool calls and "Text-based" tool calls result in the same `ToolCallEvent` structure.

## Strategy
-   **Native**: The `ParserStrategy` (OpenAI/Anthropic) already outputs `{ toolCall: ... }`. This extractor just passes them through.
-   **Text-based**: If we use a system prompt that says "Call tools like this: [TOOL:name(args)]", this extractor parses that text.
    -   *Decision*: Stick to **Native Tool Calling** primarily. This bead focuses on normalizing the *native* parser outputs into a final `ParsedEvent` tool structure.

## Acceptance Criteria
-   [ ] Normalization logic ensures `openai.tool_calls` and `anthropic.content_block.tool_use` map to the same internal `ToolCall` shape.

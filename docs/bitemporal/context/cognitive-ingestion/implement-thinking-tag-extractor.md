# Bead: Implement Thinking Tag Extractor

## Context
Some models (or system prompts) produce "Thinking" blocks enclosed in tags like `<thinking>...</thinking>` or `

Thinking:
...`. These describe internal reasoning that should be stored in **Memory** (`ThoughtNode`) but potentially hidden from the final user or specific tools.

## Goal
Create a transform that detects and segregates "Thinking" content from "Speech" content.

## Strategy
-   **Streaming State Machine**: Since tags might be split across chunks (e.g., `<thi`, `nking>`), we need a stateful buffer.
-   **Logic**:
    -   Maintain a `buffer`.
    -   Scan for open tag `<thinking>`.
    -   If inside tag, route content to `StreamDelta.thought` instead of `StreamDelta.content`.
    -   Scan for close tag `</thinking>`.
-   **Complexity**: If the provider natively supports thinking blocks (e.g., future Anthropic API), use that. Otherwise, implementing a reliable streaming XML parser for specific tags is required.

## Acceptance Criteria
-   [ ] `ThinkingExtractor` class implemented.
-   [ ] Reliably detects split tags across stream chunks.
-   [ ] Separates content into `thought` vs `content` fields.
-   [ ] Handles nested tags gracefully (or ignores them).

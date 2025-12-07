# Bead: Implement Diff Block Extractor

## Context
The **Deterministic Execution** context applies code changes. The model emits these changes as "Diff Blocks" (e.g., `<<<<`, `====`, `>>>>` or custom XML `<diff>`).

## Goal
Extract these blocks in real-time to trigger "Speculative Execution" or just for structured storage in **Memory** (`DiffHunkNode`).

## Strategy
-   **Regex/State Machine**: Similar to Thinking Tags, but looking for diff markers.
-   **Format**: We will standardize on a format (likely Search/Replace blocks or Unified Diff).
    -   *Standard*: Search/Replace blocks are robust for LLMs.
        ```text
        <<<<<<< SEARCH
        old line
        =======
        new line
        >>>>>>> REPLACE
        ```
-   **Implementation**:
    -   Detect `<<<<<<< SEARCH`. Enter `DIFF_STATE`.
    -   Accumulate lines.
    -   Detect `>>>>>>> REPLACE`. Exit `DIFF_STATE`.
    -   Emit a structured `DiffEvent`.

## Acceptance Criteria
-   [ ] `DiffExtractor` implemented.
-   [ ] correctly identifies and isolates search/replace blocks from the stream.
-   [ ] Handles edge cases where markers are split across chunks.

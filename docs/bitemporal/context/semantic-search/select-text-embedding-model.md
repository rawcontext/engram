# Bead: Select Text Embedding Model

## Context
We need a model for embedding text (Thoughts, Documentation).

## Goal
Select the optimal Open Source model for 2024/2025.

## Decision
**`intfloat/multilingual-e5-small`** (ONNX).
-   **Reasoning**:
    -   High performance on MTEB benchmarks.
    -   Small size (~130MB), perfect for local inference in the Search Service sidecar.
    -   ONNX compatible (fast on CPU/Metal).
    -   Multilingual support is a bonus.

## Implementation
-   Use `ort-wasm` (ONNX Runtime WebAssembly) or `transformers.js` in the Search Service.

## Acceptance Criteria
-   [ ] Model selection documented.
-   [ ] URL to huggingface model provided in config.

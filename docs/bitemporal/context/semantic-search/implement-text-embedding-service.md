# Bead: Implement Text Embedding Service

## Context
The service that wraps the ONNX runtime to generate vectors from text.

## Goal
Implement `TextEmbedder` class.

## Interface
```typescript
interface Embedder {
  embed(text: string): Promise<number[]>; // Dense
  embedSparse(text: string): Promise<{ indices: number[], values: number[] }>; // Sparse (SPLADE/BM25)
}
```

## Strategy
-   **Library**: `fast-embed` (Python) or `transformers.js` (Node/Bun).
-   *Decision*: **`fast-embed`** (Rust-based, Python/JS bindings) is extremely fast and supports `e5` and `bge-m3` out of the box with ONNX.

## Acceptance Criteria
-   [ ] `TextEmbedder` using `fast-embed`.
-   [ ] Unit tests comparing output vector dimensions.

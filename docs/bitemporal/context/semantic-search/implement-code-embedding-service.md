# Bead: Implement Code Embedding Service

## Context
Same as TextEmbedder, but configured for the Code model.

## Goal
Implement `CodeEmbedder` class.

## Strategy
-   Reuse `fast-embed` logic but initialize with the Code Model ID (e.g. `nomic-embed-text-v1.5`).
-   Handle longer sequences (chunking/truncation strategies) if the model supports 8k context.

## Acceptance Criteria
-   [ ] `CodeEmbedder` instantiated.
-   [ ] Verifies 8192 token limit support.

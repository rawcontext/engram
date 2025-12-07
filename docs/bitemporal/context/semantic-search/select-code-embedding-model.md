# Bead: Select Code Embedding Model

## Context
We need a specialized model for code snippets (`CodeArtifact`). General text models often fail at capturing code semantics.

## Goal
Select the optimal Code Embedding model.

## Decision
**`nomic-ai/nomic-embed-text-v1.5`** (specifically the code fine-tune if available, or just the base model which is excellent at code).
*Alternative*: `Voyage-code-2` (API).
*Local Decision*: **`Snowflake/snowflake-arctic-embed-m-v1.5`** or **`nomic-embed-text-v1.5`** (quantized).
*Final Choice*: **`nomic-embed-text-v1.5`** (GGUF/ONNX) due to 8192 context window, crucial for large files.

## Acceptance Criteria
-   [ ] Model selection documented.
-   [ ] Context window requirement (8k) verified.

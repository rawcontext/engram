# Bead: Define Vector Point Schema

## Context
The **Semantic Search** service needs a strict schema for the data points stored in Qdrant. This ensures that every vector has the necessary metadata for filtering and reconstruction.

## Goal
Define the `SearchPoint` schema using Zod.

## Research & Rationale
-   **Qdrant Structure**: Points have `id` (UUID/Int), `vector` (Dense), `sparse_vectors` (Sparse), and `payload` (JSON).
-   **Hybrid Search**: We need named vectors for `dense` and `sparse`.
-   **Metadata**: Essential for filtering (e.g., `session_id`, `timestamp`, `type`).

## Schema Definition

```typescript
import { z } from 'zod';

export const VectorPointSchema = z.object({
  id: z.string().uuid(),
  vectors: z.object({
    dense: z.array(z.number()), // 384d to 1536d
    sparse: z.object({
      indices: z.array(z.number()),
      values: z.array(z.number()),
    }),
  }),
  payload: z.object({
    content: z.string(), // The text chunk
    node_id: z.string(), // Link back to Graph Node
    session_id: z.string(),
    type: z.enum(['thought', 'code', 'doc']),
    timestamp: z.number(), // Epoch
    file_path: z.string().optional(),
  }),
});
```

## Acceptance Criteria
-   [ ] `packages/search-core` initialized.
-   [ ] Zod schema defined.
-   [ ] Type exported as `VectorPoint`.

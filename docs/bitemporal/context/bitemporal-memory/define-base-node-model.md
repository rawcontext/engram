# Bead: Define Base Node Model

## Context
All nodes in the Knowledge Graph must share a common structure to support the bitemporal queries and ID resolution.

## Goal
Define the `BaseNode` schema using Zod.

## Schema Definition

```typescript
import { z } from 'zod';
import { BitemporalSchema } from './time';

export const BaseNodeSchema = z.object({
  id: z.string().ulid(),   // Unique Node ID
  labels: z.array(z.string()), // e.g., ['Thought', 'Session']
}).merge(BitemporalSchema);

export type BaseNode = z.infer<typeof BaseNodeSchema>;
```

## Research & Rationale
-   **ULID**: We use ULID instead of UUID for IDs because they are lexicographically sortable by time, which helps with data locality and debugging.
-   **Labels**: Mapped to Cypher labels.

## Acceptance Criteria
-   [ ] Zod schema created.
-   [ ] Types exported.

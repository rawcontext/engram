# Bead: Define Session Node Schema

## Context
The root of any interaction is a `Session`.

## Schema

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const SessionNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['Session']),
  title: z.string().optional(),
  user_id: z.string(),
  started_at: z.number(), // Epoch
});
```

## Acceptance Criteria
-   [ ] Schema defined.

# Bead: Define Observation Node Schema

## Context
The result of a Tool Call (stdout, stderr, or API return value).

## Schema

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const ObservationNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['Observation']),
  tool_call_id: z.string(), // Links back to ToolCall
  content: z.string(), // Output
  is_error: z.boolean().default(false),
});
```

## Acceptance Criteria
-   [ ] Schema defined.

# Bead: Define ToolCall Node Schema

## Context
Represents a specific invocation of a tool.

## Schema

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const ToolCallNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['ToolCall']),
  tool_name: z.string(),
  call_id: z.string(), // Provider ID (e.g. call_abc123)
  arguments_json: z.string(), // The full JSON args
  status: z.enum(['pending', 'success', 'error']),
});
```

## Acceptance Criteria
-   [ ] Schema defined.

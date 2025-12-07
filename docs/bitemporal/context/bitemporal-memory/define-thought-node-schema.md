# Bead: Define ThoughtNode Schema

## Context
Represents an LLM's internal monologue or a user's message.

## Schema

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const ThoughtNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['Thought']),
  content_hash: z.string(), // SHA256 of content for dedupe
  role: z.enum(['user', 'assistant', 'system']),
  is_thinking: z.boolean().default(false), // True if <thinking> block
  
  // Note: Actual large text content is stored in BlobStore, 
  // but short thoughts might be stored directly.
  // We include a 'summary' or 'preview' here.
  preview: z.string().max(1000), 
  blob_ref: z.string().optional(), // URI to GCS if content > 1KB
});
```

## Acceptance Criteria
-   [ ] Schema defined.
-   [ ] `blob_ref` field included for off-graph storage.

# Bead: Define DiffHunk Node Schema

## Context
Represents a specific change applied to a file. Crucial for "Time Travel" reconstruction of the Virtual File System.

## Schema

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const DiffHunkNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['DiffHunk']),
  file_path: z.string(),
  original_line_start: z.number().int(),
  original_line_end: z.number().int(),
  patch_content: z.string(), // The unified diff or search/replace block
});
```

## Acceptance Criteria
-   [ ] Schema defined.

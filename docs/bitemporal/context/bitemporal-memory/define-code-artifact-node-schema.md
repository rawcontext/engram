# Bead: Define CodeArtifact Node Schema

## Context
Represents a generated file or code snippet.

## Schema

```typescript
import { z } from 'zod';
import { BaseNodeSchema } from './base';

export const CodeArtifactNodeSchema = BaseNodeSchema.extend({
  labels: z.literal(['CodeArtifact']),
  filename: z.string(),
  language: z.string(), // ts, py, etc.
  content_hash: z.string(),
  blob_ref: z.string(), // Content is almost always > 1KB
});
```

## Acceptance Criteria
-   [ ] Schema defined.

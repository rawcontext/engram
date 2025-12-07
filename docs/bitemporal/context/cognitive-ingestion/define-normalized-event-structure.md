# Bead: Define Normalized Event Structure

## Context
After parsing and extraction, we need a clean, rich event format to publish to the `parsed_events` topic. This is the "Clean Water" that the rest of the system drinks.

## Goal
Define the `ParsedStreamEvent` schema.

## Schema Definition (Zod)

```typescript
import { z } from 'zod';

export const ParsedStreamEventSchema = z.object({
  event_id: z.string().uuid(),
  original_event_id: z.string().uuid(), // Link to RawStreamEvent
  timestamp: z.string().datetime(),
  
  // The aggregated state of this "turn" or "chunk"
  type: z.enum(['content', 'thought', 'tool_call', 'diff', 'usage', 'control']),
  
  // The entity producing this event (User, Assistant, System)
  // Essential for Memory to construct the correct ThoughtNode role
  role: z.enum(['user', 'assistant', 'system']).optional(),

  // Content payloads
  content: z.string().optional(), // Text meant for user
  thought: z.string().optional(), // Internal thought
  
  tool_call: z.object({
    id: z.string(),
    name: z.string(),
    arguments_delta: z.string(), // Partial JSON
    index: z.number().default(0),
  }).optional(),
  
  diff: z.object({
    file: z.string().optional(),
    hunk: z.string(),
  }).optional(),
  
  usage: z.object({
    input_tokens: z.number().default(0),
    output_tokens: z.number().default(0),
  }).optional(),
  
  metadata: z.record(z.unknown()).optional(),
});
```

## Acceptance Criteria
-   [ ] Zod schema defined in `packages/events`.
-   [ ] Covers all data types extracted by previous beads.

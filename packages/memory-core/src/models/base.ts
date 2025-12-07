import { z } from "zod";

// We can't import the interface directly into Zod easily without defining the schema twice usually,
// but we can define the schema then infer.

export const BitemporalSchema = z.object({
  vt_start: z.number(),
  vt_end: z.number(),
  tt_start: z.number(),
  tt_end: z.number(),
});

export const BaseNodeSchema = z
  .object({
    id: z.string().ulid(), // Unique Node ID
    labels: z.array(z.string()), // e.g., ['Thought', 'Session']
  })
  .merge(BitemporalSchema);

export type BaseNode = z.infer<typeof BaseNodeSchema>;

import { z } from "zod";
import { BitemporalSchema } from "./base";

// All edges are bitemporal
export const BaseEdgeSchema = BitemporalSchema.extend({
  type: z.string(), // e.g., 'NEXT', 'TRIGGERS'
});

export const NextEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("NEXT"),
});

export const MotivatedByEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("MOTIVATED_BY"),
});

export const TriggersEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("TRIGGERS"),
});

export const ModifiesEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("MODIFIES"),
});

export const YieldsEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("YIELDS"),
});

export const SnapshotOfEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("SNAPSHOT_OF"),
});

export const ReplacesEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("REPLACES"),
});

export const SameAsEdgeSchema = BaseEdgeSchema.extend({
  type: z.literal("SAME_AS"),
});

// Union of all edge types
export const EdgeSchema = z.union([
  NextEdgeSchema,
  MotivatedByEdgeSchema,
  TriggersEdgeSchema,
  ModifiesEdgeSchema,
  YieldsEdgeSchema,
  SnapshotOfEdgeSchema,
  ReplacesEdgeSchema,
  SameAsEdgeSchema,
]);

export type Edge = z.infer<typeof EdgeSchema>;

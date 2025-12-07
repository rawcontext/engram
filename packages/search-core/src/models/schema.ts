import { z } from "zod";

export const VectorPointSchema = z.object({
  id: z.string().uuid(),
  vectors: z.object({
    dense: z.array(z.number()), // 384d to 1536d
    sparse: z.object({
      indices: z.array(z.number()),
      values: z.array(z.number()),
    }),
  }),
  payload: z.object({
    content: z.string(), // The text chunk
    node_id: z.string(), // Link back to Graph Node
    session_id: z.string(),
    type: z.enum(["thought", "code", "doc"]),
    timestamp: z.number(), // Epoch
    file_path: z.string().optional(),
  }),
});

export type VectorPoint = z.infer<typeof VectorPointSchema>;

// Extract the 'type' enum from VectorPointSchema to ensure consistency
export const SearchTypeEnum = VectorPointSchema.shape.payload.shape.type;
export type SearchType = z.infer<typeof SearchTypeEnum>;

export interface SearchQuery {
  text: string;
  limit?: number;
  threshold?: number;
  filters?: {
    session_id?: string;
    // Use the inferred type from the schema
    type?: SearchType;
    time_range?: { start: number; end: number };
  };
  strategy?: "hybrid" | "dense" | "sparse"; // Made optional
}

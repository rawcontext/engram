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

export interface SearchQuery {
  text: string;
  limit?: number;
  threshold?: number;
  filters?: {
    session_id?: string;
    type?: "thought" | "code" | "doc"; // Updated to include 'doc' matching VectorPointSchema
    time_range?: { start: number; end: number };
  };
  strategy: "hybrid" | "dense" | "sparse";
}

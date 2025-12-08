import { z } from "zod";

// Sparse vector schema for BM25-based keyword search
const SparseVectorSchema = z.object({
	indices: z.array(z.number()),
	values: z.array(z.number()),
});

// Vector point schema with separate text/code dense vectors
export const VectorPointSchema = z.object({
	id: z.string().uuid(),
	vectors: z.object({
		// Text dense vector: 384d (e5-small)
		text_dense: z.array(z.number()).optional(),
		// Code dense vector: 768d (nomic-embed-text-v1)
		code_dense: z.array(z.number()).optional(),
		// Sparse vector for hybrid search
		sparse: SparseVectorSchema,
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

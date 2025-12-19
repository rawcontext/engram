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

/**
 * Reranker tier determines which model is used for cross-encoder scoring.
 * - fast: Optimized for speed (< 50ms), uses lightweight model
 * - accurate: Higher quality scoring for complex queries
 * - code: Specialized for code search queries
 * - llm: Premium LLM-based listwise reranking (highest latency)
 */
export type RerankerTier = "fast" | "accurate" | "code" | "llm";

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
	strategy?: "hybrid" | "dense" | "sparse";

	// Reranking options
	/** Enable/disable reranking. Default: true */
	rerank?: boolean;
	/** Reranker tier to use. Default: auto-routed based on query */
	rerankTier?: RerankerTier;
	/** Number of candidates to fetch for reranking. Default: 30 */
	rerankDepth?: number;
}

/** Payload returned in search results */
export interface SearchResultPayload {
	content: string;
	node_id: string;
	session_id: string;
	type: SearchType;
	timestamp: number;
	file_path?: string;
}

/** Search result with optional reranking scores */
export interface SearchResult {
	id: string | number;

	/** Final score used for ranking (rerankerScore if reranked, otherwise original) */
	score: number;

	/** Original RRF/dense/sparse score before reranking */
	rrfScore?: number;

	/** Cross-encoder relevance score (0-1), present if reranking was applied */
	rerankerScore?: number;

	/** Which reranker tier was used, present if reranking was applied */
	rerankTier?: RerankerTier;

	/** Document payload */
	payload?: SearchResultPayload;

	/** Indicates if the search result is degraded (reranker failed) */
	degraded?: boolean;

	/** Reason for degradation if applicable */
	degradedReason?: string;
}

import { QdrantClient } from "@qdrant/js-client-rest";
import { DEFAULT_SEARCH_CONFIG } from "../config";
import type { SearchQuery } from "../models/schema";
import { QueryClassifier } from "./classifier";
import { CodeEmbedder } from "./code-embedder";
import { Reranker } from "./reranker";
import { TextEmbedder } from "./text-embedder";

/** Default depth for reranking - how many candidates to fetch before reranking */
const DEFAULT_RERANK_DEPTH = 30;

/** Maximum time to wait for reranking before falling back to RRF results */
const RERANK_TIMEOUT_MS = 500;

/** Creates a timeout promise that rejects after specified milliseconds */
function createTimeout(ms: number): Promise<never> {
	return new Promise((_, reject) => {
		setTimeout(() => reject(new Error(`Reranking timeout after ${ms}ms`)), ms);
	});
}

export class SearchRetriever {
	private client: QdrantClient;
	private textEmbedder: TextEmbedder;
	private codeEmbedder: CodeEmbedder;
	private classifier: QueryClassifier;
	private reranker: Reranker;
	private collectionName = "engram_memory";

	constructor(url: string = "http://localhost:6333") {
		this.client = new QdrantClient({ url });
		this.textEmbedder = new TextEmbedder();
		this.codeEmbedder = new CodeEmbedder();
		this.classifier = new QueryClassifier();
		this.reranker = new Reranker();
	}

	async search(query: SearchQuery) {
		const {
			text,
			limit = DEFAULT_SEARCH_CONFIG.limits.defaultResults,
			strategy: userStrategy,
			filters,
			threshold,
			rerank = true,
			rerankDepth = DEFAULT_RERANK_DEPTH,
		} = query;

		// Determine effective limit: oversample if reranking is enabled
		const fetchLimit = rerank ? Math.max(rerankDepth, limit) : limit;

		// Determine strategy using classifier if not provided
		let strategy = userStrategy;
		if (!strategy) {
			const classification = this.classifier.classify(text);
			strategy = classification.strategy;
			// We could use classification.alpha for hybrid weighting later
		}

		const effectiveThreshold = threshold ?? DEFAULT_SEARCH_CONFIG.minScore[strategy];

		// Determine which vector field to use based on type filter
		const isCodeSearch = filters?.type === "code";
		const vectorName = isCodeSearch ? "code_dense" : "text_dense";

		// Build Filter
		const filter: Record<string, unknown> = {};
		if (filters) {
			const conditions = [];
			if (filters.session_id) {
				conditions.push({ key: "session_id", match: { value: filters.session_id } });
			}
			if (filters.type) {
				conditions.push({ key: "type", match: { value: filters.type } });
			}
			if (conditions.length > 0) {
				filter.must = conditions;
			}
		}

		// Fetch raw results based on strategy
		let rawResults: Array<{ id: string | number; score: number; payload?: unknown }> = [];

		// Dense Search
		if (strategy === "dense") {
			const vector = isCodeSearch
				? await this.codeEmbedder.embedQuery(text)
				: await this.textEmbedder.embedQuery(text);

			const denseResults = await this.client.search(this.collectionName, {
				vector: {
					name: vectorName,
					vector: vector,
				},
				filter: Object.keys(filter).length > 0 ? filter : undefined,
				limit: fetchLimit,
				with_payload: true,
				score_threshold: effectiveThreshold,
			});

			rawResults = denseResults;
		}
		// Hybrid Search (Dense + Sparse with RRF Fusion)
		else if (strategy === "hybrid") {
			// Generate both dense and sparse query vectors in parallel
			const [denseVector, sparseVector] = await Promise.all([
				isCodeSearch
					? this.codeEmbedder.embedQuery(text)
					: this.textEmbedder.embedQuery(text),
				this.textEmbedder.embedSparseQuery(text),
			]);

			// Prefetch from both vector spaces, fuse with RRF
			const results = await this.client.query(this.collectionName, {
				prefetch: [
					{
						query: denseVector,
						using: vectorName,
						limit: fetchLimit * 2, // Oversample for fusion
					},
					{
						query: {
							indices: sparseVector.indices,
							values: sparseVector.values,
						},
						using: "sparse",
						limit: fetchLimit * 2,
					},
				],
				query: { fusion: "rrf" },
				filter: Object.keys(filter).length > 0 ? filter : undefined,
				limit: fetchLimit,
				with_payload: true,
				// No score_threshold with RRF (scores are rank-based, not similarity-based)
			});

			rawResults = results.points;
		}
		// Sparse Search
		else if (strategy === "sparse") {
			const sparseVector = await this.textEmbedder.embedSparseQuery(text);

			const results = await this.client.query(this.collectionName, {
				query: {
					indices: sparseVector.indices,
					values: sparseVector.values,
				},
				using: "sparse",
				filter: Object.keys(filter).length > 0 ? filter : undefined,
				limit: fetchLimit,
				with_payload: true,
				score_threshold: effectiveThreshold,
			});

			rawResults = results.points;
		}

		// Apply reranking if enabled
		if (rerank && rawResults.length > 0) {
			try {
				// Extract content for reranking
				const documents = rawResults.map((r) => {
					const payload = r.payload as { content?: string } | undefined;
					return payload?.content ?? "";
				});

				// Rerank with timeout circuit breaker
				const reranked = await Promise.race([
					this.reranker.rerank(text, documents, limit),
					createTimeout(RERANK_TIMEOUT_MS),
				]);

				// Map reranked results back to original results with scores
				return reranked.map((r) => {
					const original = rawResults[r.originalIndex];
					return {
						...original,
						score: r.score, // Use reranker score as final score
						rrfScore: original.score, // Preserve original RRF/dense score
						rerankerScore: r.score,
					};
				});
			} catch (error) {
				// Circuit breaker: fall back to RRF results on timeout or error
				console.warn("[SearchRetriever] Reranking fallback:", error instanceof Error ? error.message : error);
				return rawResults.slice(0, limit);
			}
		}

		// No reranking - return raw results trimmed to limit
		return rawResults.slice(0, limit);
	}
}

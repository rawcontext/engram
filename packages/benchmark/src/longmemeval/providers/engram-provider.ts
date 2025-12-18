import type { EmbeddingProvider, RetrievalResult, RetrieverConfig } from "../retriever.js";
import type { EngramDocument, MappedInstance } from "../mapper.js";

/**
 * Configuration for the Engram provider
 */
export interface EngramProviderConfig {
	/** Qdrant server URL */
	qdrantUrl: string;
	/** Collection name for benchmark data */
	collectionName: string;
	/** Enable hybrid search (dense + sparse with RRF) */
	hybridSearch: boolean;
	/** Enable reranking */
	rerank: boolean;
	/** Reranker tier: fast, accurate, code, or colbert */
	rerankTier: "fast" | "accurate" | "code" | "colbert";
	/** Number of candidates to fetch before reranking */
	rerankDepth: number;
	/** Number of documents to return */
	topK: number;
}

const DEFAULT_CONFIG: EngramProviderConfig = {
	qdrantUrl: "http://localhost:6333",
	collectionName: "longmemeval_engram",
	hybridSearch: true,
	rerank: true,
	rerankTier: "fast",
	rerankDepth: 30,
	topK: 10,
};

/**
 * Full Engram retrieval pipeline using search-core
 *
 * Features:
 * - Dense embeddings (E5-small, 384d)
 * - Sparse embeddings (SPLADE)
 * - Hybrid search with RRF fusion
 * - ColBERT late interaction reranking
 * - Cross-encoder reranking (fast/accurate/code tiers)
 */
export class EngramRetriever {
	private config: EngramProviderConfig;
	private textEmbedder: TextEmbedderInterface | null = null;
	private spladeEmbedder: SpladeEmbedderInterface | null = null;
	private colbertEmbedder: ColBERTEmbedderInterface | null = null;
	private reranker: RerankerInterface | null = null;
	private colbertReranker: ColBERTRerankerInterface | null = null;
	private client: QdrantClientInterface | null = null;
	private indexed: boolean = false;
	private documentEmbeddings: Map<string, Float32Array[]> = new Map(); // ColBERT embeddings cache

	constructor(config: Partial<EngramProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Initialize all embedders and rerankers (lazy loading)
	 */
	private async initialize(): Promise<void> {
		if (this.textEmbedder) return;

		try {
			// Import search-core components
			const searchCore = await import("@engram/search-core");

			// Initialize embedders
			this.textEmbedder = new searchCore.TextEmbedder() as unknown as TextEmbedderInterface;

			if (this.config.hybridSearch) {
				this.spladeEmbedder = new searchCore.SpladeEmbedder() as unknown as SpladeEmbedderInterface;
			}

			if (this.config.rerank && this.config.rerankTier === "colbert") {
				const colbertEmb = new searchCore.ColBERTEmbedder();
				this.colbertEmbedder = colbertEmb as unknown as ColBERTEmbedderInterface;
				this.colbertReranker = new searchCore.ColBERTReranker(
					colbertEmb,
				) as unknown as ColBERTRerankerInterface;
			}

			if (this.config.rerank && this.config.rerankTier !== "colbert") {
				// Use BatchedReranker for cross-encoder tiers
				this.reranker = searchCore.BatchedReranker.forTier(
					this.config.rerankTier,
				) as unknown as RerankerInterface;
			}

			// Initialize Qdrant client
			const { QdrantClient } = await import("@qdrant/js-client-rest");
			this.client = new QdrantClient({ url: this.config.qdrantUrl }) as QdrantClientInterface;
		} catch (error) {
			console.error("Failed to initialize Engram provider:", error);
			throw new Error("@engram/search-core not available. Install it or use a different provider.");
		}
	}

	/**
	 * Ensure collection exists with proper multi-vector schema
	 */
	async ensureCollection(): Promise<void> {
		await this.initialize();
		if (!this.client) throw new Error("Client not initialized");

		try {
			await this.client.getCollection(this.config.collectionName);
			// Collection exists, delete it to start fresh for each benchmark instance
			await this.client.deleteCollection(this.config.collectionName);
		} catch {
			// Collection doesn't exist, that's fine
		}

		// Create collection with multi-vector support
		const vectorsConfig: Record<string, unknown> = {
			dense: {
				size: 384,
				distance: "Cosine",
			},
		};

		const sparseVectorsConfig: Record<string, unknown> = {};
		if (this.config.hybridSearch) {
			sparseVectorsConfig.sparse = {
				index: {
					on_disk: false,
				},
			};
		}

		await this.client.createCollection(this.config.collectionName, {
			vectors: vectorsConfig,
			sparse_vectors: Object.keys(sparseVectorsConfig).length > 0 ? sparseVectorsConfig : undefined,
		});
	}

	/**
	 * Index a mapped instance for retrieval (Retriever interface)
	 */
	async indexInstance(mapped: MappedInstance): Promise<void> {
		await this.index(mapped.documents);
	}

	/**
	 * Retrieve relevant documents for a question (Retriever interface)
	 */
	async retrieve(question: string, _questionDate?: Date): Promise<RetrievalResult> {
		return this.search(question, this.config.topK);
	}

	/**
	 * Index documents with dense, sparse, and optionally ColBERT embeddings
	 */
	async index(documents: EngramDocument[]): Promise<void> {
		await this.initialize();
		if (!this.client || !this.textEmbedder) throw new Error("Not initialized");

		await this.ensureCollection();

		// Generate dense embeddings
		const texts = documents.map((d) => d.content);
		const denseEmbeddings = await Promise.all(texts.map((text) => this.textEmbedder!.embed(text)));

		// Generate sparse embeddings if hybrid search enabled
		let sparseEmbeddings: SparseVector[] | null = null;
		if (this.config.hybridSearch && this.spladeEmbedder) {
			sparseEmbeddings = await Promise.all(texts.map((text) => this.spladeEmbedder!.embed(text)));
		}

		// Generate ColBERT embeddings if using ColBERT reranking
		if (this.config.rerank && this.config.rerankTier === "colbert" && this.colbertEmbedder) {
			for (const doc of documents) {
				const colbertEmb = await this.colbertEmbedder.encodeDocument(doc.content);
				this.documentEmbeddings.set(doc.id, colbertEmb);
			}
		}

		// Prepare points for Qdrant
		const points = documents.map((doc, i) => {
			const point: QdrantPoint = {
				id: this.hashId(doc.id),
				vector: {
					dense: Array.from(denseEmbeddings[i]),
				},
				payload: {
					doc_id: doc.id,
					instance_id: doc.instanceId,
					session_id: doc.sessionId,
					content: doc.content,
					valid_time: doc.validTime.toISOString(),
					has_answer: doc.metadata.hasAnswer,
					role: doc.metadata.role,
					turn_index: doc.metadata.turnIndex,
					session_index: doc.metadata.sessionIndex,
				},
			};

			// Add sparse vector if available
			if (sparseEmbeddings && sparseEmbeddings[i]) {
				point.vector.sparse = sparseEmbeddings[i];
			}

			return point;
		});

		// Batch upsert with retry logic
		const batchSize = 50; // Smaller batches to reduce memory pressure
		for (let i = 0; i < points.length; i += batchSize) {
			const batch = points.slice(i, i + batchSize);
			await this.retryOperation(() =>
				this.client!.upsert(this.config.collectionName, {
					wait: true,
					points: batch,
				}),
			);
		}

		this.indexed = true;
	}

	/**
	 * Retry an operation with exponential backoff
	 */
	private async retryOperation<T>(
		operation: () => Promise<T>,
		maxRetries = 3,
		baseDelayMs = 100,
	): Promise<T> {
		let lastError: Error | undefined;
		for (let attempt = 0; attempt < maxRetries; attempt++) {
			try {
				return await operation();
			} catch (error) {
				lastError = error as Error;
				if (attempt < maxRetries - 1) {
					const delay = baseDelayMs * Math.pow(2, attempt);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}
		}
		throw lastError;
	}

	/**
	 * Search with full Engram pipeline: hybrid retrieval + reranking
	 */
	async search(query: string, topK: number): Promise<RetrievalResult> {
		if (!this.indexed || !this.client || !this.textEmbedder) {
			return { documents: [], scores: [], retrievedIds: [] };
		}

		try {
			// Step 1: Generate query embeddings
			const denseQuery = await this.textEmbedder.embedQuery(query);
			let sparseQuery: SparseVector | null = null;
			if (this.config.hybridSearch && this.spladeEmbedder) {
				try {
					sparseQuery = await this.spladeEmbedder.embedQuery(query);
				} catch (error) {
					// Fall back to dense-only if SPLADE fails
					console.warn("SPLADE embedding failed, using dense-only:", error);
				}
			}

			// Step 2: Retrieve candidates (fetch more for reranking)
			const fetchLimit = this.config.rerank ? this.config.rerankDepth : topK;
			let results: QdrantSearchResult[];

			if (this.config.hybridSearch && sparseQuery) {
				// Hybrid search with RRF fusion
				results = await this.hybridSearch(denseQuery, sparseQuery, fetchLimit);
			} else {
				// Dense-only search
				results = await this.denseSearch(denseQuery, fetchLimit);
			}

			// Step 3: Rerank if enabled
			if (this.config.rerank && results.length > 0) {
				try {
					results = await this.rerank(query, results, topK);
				} catch (error) {
					// Fall back to retrieval results if reranking fails
					console.warn("Reranking failed, using retrieval scores:", error);
					results = results.slice(0, topK);
				}
			} else {
				results = results.slice(0, topK);
			}

			// Step 4: Convert to EngramDocuments
			const documents: EngramDocument[] = results.map((r) => {
				const payload = r.payload as Record<string, unknown>;
				return {
					id: payload.doc_id as string,
					instanceId: payload.instance_id as string,
					sessionId: payload.session_id as string,
					content: payload.content as string,
					validTime: new Date(payload.valid_time as string),
					metadata: {
						questionId: payload.instance_id as string,
						hasAnswer: payload.has_answer as boolean,
						role: payload.role as "user" | "assistant" | "combined",
						turnIndex: payload.turn_index as number | undefined,
						sessionIndex: payload.session_index as number,
					},
				};
			});

			return {
				documents,
				scores: results.map((r) => r.score),
				retrievedIds: documents.map((d) => d.id),
			};
		} catch (error) {
			console.error("Search failed:", error);
			return { documents: [], scores: [], retrievedIds: [] };
		}
	}

	/**
	 * Dense-only vector search with retry
	 */
	private async denseSearch(
		queryVector: number[] | Float32Array,
		limit: number,
	): Promise<QdrantSearchResult[]> {
		if (!this.client) return [];

		return this.retryOperation(async () => {
			const results = await this.client!.search(this.config.collectionName, {
				vector: { name: "dense", vector: Array.from(queryVector) },
				limit,
				with_payload: true,
			});
			return results;
		});
	}

	/**
	 * Hybrid search with RRF fusion (dense + sparse)
	 */
	private async hybridSearch(
		denseQuery: number[] | Float32Array,
		sparseQuery: SparseVector,
		limit: number,
	): Promise<QdrantSearchResult[]> {
		if (!this.client) return [];

		// Use Qdrant's native query API with prefetch for RRF
		try {
			const results = await this.client.query(this.config.collectionName, {
				prefetch: [
					{
						query: Array.from(denseQuery),
						using: "dense",
						limit: limit * 2,
					},
					{
						query: {
							indices: sparseQuery.indices,
							values: sparseQuery.values,
						},
						using: "sparse",
						limit: limit * 2,
					},
				],
				query: { fusion: "rrf" },
				limit,
				with_payload: true,
			});

			return results.points || [];
		} catch {
			// Fall back to dense-only if hybrid fails
			console.warn("Hybrid search failed, falling back to dense-only");
			return this.denseSearch(denseQuery, limit);
		}
	}

	/**
	 * Rerank results using configured reranker
	 */
	private async rerank(
		query: string,
		results: QdrantSearchResult[],
		topK: number,
	): Promise<QdrantSearchResult[]> {
		if (results.length === 0) return results;

		try {
			if (this.config.rerankTier === "colbert" && this.colbertReranker) {
				// ColBERT late interaction reranking
				const candidates = results.map((r) => {
					const payload = r.payload as Record<string, unknown>;
					const docId = payload.doc_id as string;
					return {
						id: docId,
						content: payload.content as string,
						score: r.score,
						colbertEmbeddings: this.documentEmbeddings.get(docId),
					};
				});

				const reranked = await this.colbertReranker.rerank(query, candidates, topK);

				// Map back to QdrantSearchResult format
				return reranked.map((item) => {
					const original = results.find(
						(r) => (r.payload as Record<string, unknown>).doc_id === item.id,
					);
					return {
						...original!,
						score: item.score,
					};
				});
			} else if (this.reranker) {
				// Cross-encoder reranking
				const candidates = results.map((r) => {
					const payload = r.payload as Record<string, unknown>;
					return {
						id: payload.doc_id as string,
						content: payload.content as string,
						score: r.score,
					};
				});

				const reranked = await this.reranker.rerank(query, candidates, topK);

				// Map back to QdrantSearchResult format
				return reranked.map((item) => {
					const original = results.find(
						(r) => (r.payload as Record<string, unknown>).doc_id === item.id,
					);
					return {
						...original!,
						score: item.score,
					};
				});
			}
		} catch (error) {
			console.warn("Reranking failed, using retrieval scores:", error);
		}

		return results.slice(0, topK);
	}

	/**
	 * Clear the collection and release resources
	 */
	clear(): void {
		this.indexed = false;
		this.documentEmbeddings.clear();
		// Note: We don't delete the collection here as it will be recreated on next index
		// This avoids unnecessary Qdrant operations between instances
	}

	/**
	 * Generate numeric hash for Qdrant point ID
	 */
	private hashId(id: string): number {
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = (hash << 5) - hash + id.charCodeAt(i);
			hash = hash >>> 0;
		}
		return hash;
	}
}

/**
 * Engram embedding provider (wrapper for compatibility)
 */
export class EngramEmbeddingProvider implements EmbeddingProvider {
	readonly dimension = 384;
	private textEmbedder: TextEmbedderInterface | null = null;

	async embed(texts: string[]): Promise<number[][]> {
		const embedder = await this.getEmbedder();
		return Promise.all(texts.map((text) => embedder.embed(text).then((v) => Array.from(v))));
	}

	async embedQuery(text: string): Promise<number[]> {
		const embedder = await this.getEmbedder();
		const result = await embedder.embedQuery(text);
		return Array.from(result);
	}

	private async getEmbedder(): Promise<TextEmbedderInterface> {
		if (this.textEmbedder) return this.textEmbedder;

		try {
			const { TextEmbedder } = await import("@engram/search-core");
			this.textEmbedder = new TextEmbedder() as unknown as TextEmbedderInterface;
		} catch {
			throw new Error("@engram/search-core not available");
		}

		return this.textEmbedder;
	}
}

// Type interfaces for search-core components
interface TextEmbedderInterface {
	embed(text: string): Promise<number[] | Float32Array>;
	embedQuery(text: string): Promise<number[] | Float32Array>;
}

interface SpladeEmbedderInterface {
	embed(text: string): Promise<SparseVector>;
	embedQuery(text: string): Promise<SparseVector>;
}

interface ColBERTEmbedderInterface {
	encodeDocument(text: string): Promise<Float32Array[]>;
	encodeQuery(text: string): Promise<Float32Array[]>;
}

interface RerankerInterface {
	rerank(
		query: string,
		candidates: Array<{ id: string; content: string; score: number }>,
		topK: number,
	): Promise<Array<{ id: string; content: string; score: number }>>;
}

interface ColBERTRerankerInterface {
	rerank(
		query: string,
		candidates: Array<{
			id: string;
			content: string;
			score: number;
			colbertEmbeddings?: Float32Array[];
		}>,
		topK: number,
	): Promise<Array<{ id: string; content: string; score: number }>>;
}

interface SparseVector {
	indices: number[];
	values: number[];
}

interface QdrantClientInterface {
	getCollection(name: string): Promise<unknown>;
	createCollection(name: string, config: unknown): Promise<unknown>;
	deleteCollection(name: string): Promise<unknown>;
	upsert(name: string, config: unknown): Promise<unknown>;
	search(name: string, config: unknown): Promise<QdrantSearchResult[]>;
	query(name: string, config: unknown): Promise<{ points?: QdrantSearchResult[] }>;
}

interface QdrantPoint {
	id: number;
	vector: {
		dense: number[];
		sparse?: SparseVector;
	};
	payload: Record<string, unknown>;
}

interface QdrantSearchResult {
	id: number | string;
	score: number;
	payload?: Record<string, unknown>;
}

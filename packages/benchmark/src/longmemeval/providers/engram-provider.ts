import type { EngramDocument, MappedInstance } from "../mapper.js";
import type { EmbeddingProvider, RetrievalResult } from "../retriever.js";

/**
 * Embedding model options for configurable embeddings.
 */
export type EmbeddingModelOption =
	| "e5-small"
	| "e5-base"
	| "e5-large"
	| "gte-base"
	| "gte-large"
	| "bge-small"
	| "bge-base"
	| "bge-large";

/**
 * Configuration for the Engram provider
 */
export interface EngramProviderConfig {
	/** Qdrant server URL */
	qdrantUrl: string;
	/** FalkorDB (Redis) URL for graph storage */
	falkorUrl: string;
	/** Collection name for benchmark data */
	collectionName: string;
	/** Enable hybrid search (dense + sparse with RRF) */
	hybridSearch: boolean;
	/** Use learned fusion weights instead of fixed RRF */
	learnedFusion: boolean;
	/** Path to fusion MLP ONNX model */
	fusionModel: string;
	/** Enable reranking */
	rerank: boolean;
	/** Reranker tier: fast, accurate, code, colbert, or llm */
	rerankTier: "fast" | "accurate" | "code" | "colbert" | "llm";
	/** Number of candidates to fetch before reranking */
	rerankDepth: number;
	/** Number of documents to return */
	topK: number;
	/** Enable multi-query expansion with RRF fusion */
	multiQuery: boolean;
	/** Number of query variations to generate */
	multiQueryVariations: number;
	/** Enable retrieval confidence abstention detection */
	abstention: boolean;
	/** Minimum retrieval score to proceed (0-1) */
	abstentionThreshold: number;
	/** Enable session-aware hierarchical retrieval */
	sessionAware: boolean;
	/** Number of sessions to retrieve in stage 1 */
	topSessions: number;
	/** Number of turns per session in stage 2 */
	turnsPerSession: number;
	/** Enable temporal query parsing */
	temporalAware: boolean;
	/** Minimum confidence to apply temporal filter (0-1) */
	temporalConfidenceThreshold: number;
	/** Embedding model to use */
	embeddingModel: EmbeddingModelOption;
	/** Reference date for temporal queries (defaults to question date) */
	referenceDate?: Date;
}

const DEFAULT_CONFIG: EngramProviderConfig = {
	qdrantUrl: "http://localhost:6333",
	falkorUrl: "redis://localhost:6379",
	collectionName: "longmemeval_engram",
	hybridSearch: true,
	learnedFusion: false,
	fusionModel: "models/fusion_mlp.onnx",
	rerank: true,
	rerankTier: "fast",
	rerankDepth: 30,
	topK: 10,
	multiQuery: false,
	multiQueryVariations: 3,
	abstention: false,
	abstentionThreshold: 0.3,
	sessionAware: false,
	topSessions: 5,
	turnsPerSession: 3,
	temporalAware: false,
	temporalConfidenceThreshold: 0.5,
	embeddingModel: "e5-small",
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
// FalkorDB graph client interface
interface FalkorGraphInterface {
	query(
		cypher: string,
		params?: { params: Record<string, unknown> },
	): Promise<{ data: unknown[][] }>;
}

interface FalkorDBInterface {
	selectGraph(name: string): FalkorGraphInterface;
	close(): Promise<void>;
}

export class EngramRetriever {
	private config: EngramProviderConfig;
	private textEmbedder: TextEmbedderInterface | null = null;
	private spladeEmbedder: SpladeEmbedderInterface | null = null;
	private colbertEmbedder: ColBERTEmbedderInterface | null = null;
	private reranker: RerankerInterface | null = null;
	private colbertReranker: ColBERTRerankerInterface | null = null;
	private client: QdrantClientInterface | null = null;
	private falkorDb: FalkorDBInterface | null = null;
	private falkorGraph: FalkorGraphInterface | null = null;
	private indexed: boolean = false;
	private documentEmbeddings: Map<string, Float32Array[]> = new Map(); // ColBERT embeddings cache
	private xaiClient: XAIClientInterface | null = null; // For multi-query expansion
	private abstentionDetector: AbstentionDetectorInterface | null = null;
	private sessionSummarizer: SessionSummarizerInterface | null = null;
	private sessionRetriever: SessionRetrieverInterface | null = null;
	private llmProvider: LLMProviderInterface | null = null;
	private temporalParser: TemporalParserInterface | null = null;
	private learnedFusion: LearnedFusionInterface | null = null;
	private embeddingDimensions: number = 384; // Default for e5-small

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
			const searchCore = await import("@engram/search");

			// Initialize embedders with configurable model
			if (this.config.embeddingModel === "e5-small") {
				// Use legacy TextEmbedder for backwards compatibility
				this.textEmbedder = new searchCore.TextEmbedder() as unknown as TextEmbedderInterface;
				this.embeddingDimensions = 384;
			} else {
				// Use configurable embedder for other models
				const embedder = searchCore.createEmbedder({
					model: this.config.embeddingModel,
					sparse: this.config.hybridSearch,
				});
				this.textEmbedder = embedder as unknown as TextEmbedderInterface;
				this.embeddingDimensions = embedder.dimensions;
				console.log(`Using ${this.config.embeddingModel} embedder (${this.embeddingDimensions}d)`);
			}

			// Initialize temporal parser
			if (this.config.temporalAware) {
				this.temporalParser = new searchCore.TemporalQueryParser(
					this.config.referenceDate,
				) as unknown as TemporalParserInterface;
			}

			if (this.config.hybridSearch) {
				this.spladeEmbedder = new searchCore.SpladeEmbedder() as unknown as SpladeEmbedderInterface;
			}

			// Initialize learned fusion if enabled
			if (this.config.learnedFusion) {
				this.learnedFusion = new searchCore.LearnedFusion({
					modelPath: this.config.fusionModel,
				}) as unknown as LearnedFusionInterface;
				console.log(`  [Learned Fusion] Using model: ${this.config.fusionModel}`);
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

			// Initialize FalkorDB client
			const { FalkorDB } = await import("falkordb");
			const falkorUrl = new URL(this.config.falkorUrl);
			this.falkorDb = (await FalkorDB.connect({
				socket: { host: falkorUrl.hostname, port: Number.parseInt(falkorUrl.port) || 6379 },
			})) as unknown as FalkorDBInterface;
			this.falkorGraph = this.falkorDb.selectGraph("engram_benchmark");
			console.log(`  [FalkorDB] Connected to ${this.config.falkorUrl}`);

			// Initialize Google AI client for multi-query expansion
			if (this.config.multiQuery) {
				const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
				const { generateText } = await import("ai");
				const googleProvider = createGoogleGenerativeAI();
				this.xaiClient = {
					chat: async (messages: Array<{ role: string; content: string }>) => {
						const result = await generateText({
							model: googleProvider("gemini-3-flash-preview"),
							system: messages.find((m) => m.role === "system")?.content,
							prompt: messages.find((m) => m.role === "user")?.content ?? "",
						});
						return result.text;
					},
				};
			}

			// Initialize abstention detector
			if (this.config.abstention) {
				const { AbstentionDetector } = await import("@engram/search");
				this.abstentionDetector = new AbstentionDetector({
					minRetrievalScore: this.config.abstentionThreshold,
				}) as unknown as AbstentionDetectorInterface;
			}

			// Initialize session-aware components
			if (this.config.sessionAware) {
				// Create a simple LLM provider for summarization
				const { SessionSummarizer, SessionAwareRetriever } = await import("@engram/search");
				const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
				const { generateText } = await import("ai");

				// Use Google AI via AI SDK as LLM provider for summarization
				const googleProvider = createGoogleGenerativeAI();

				this.llmProvider = {
					complete: async (prompt: string) => {
						const result = await generateText({
							model: googleProvider("gemini-3-flash-preview"),
							prompt,
						});
						return { text: result.text };
					},
				};

				this.sessionSummarizer = new SessionSummarizer(
					this.llmProvider,
				) as unknown as SessionSummarizerInterface;

				// Session retriever will be initialized after collection setup
				// Cast client to the expected type for SessionAwareRetriever
				const sessionRetrieverInstance = new SessionAwareRetriever(
					this.client as never,
					{
						topSessions: this.config.topSessions,
						turnsPerSession: this.config.turnsPerSession,
						finalTopK: this.config.topK,
						sessionCollection: `${this.config.collectionName}_sessions`,
						turnCollection: this.config.collectionName,
					},
					this.reranker as never,
				);
				this.sessionRetriever = sessionRetrieverInstance as unknown as SessionRetrieverInterface;

				console.log("  [Session-Aware] Initialized session summarizer and retriever");
			}
		} catch (error) {
			console.error("Failed to initialize Engram provider:", error);
			throw new Error("@engram/search not available. Install it or use a different provider.");
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

		// Create sessions collection for session-aware retrieval
		if (this.config.sessionAware) {
			const sessionsCollection = `${this.config.collectionName}_sessions`;
			try {
				await this.client.getCollection(sessionsCollection);
				await this.client.deleteCollection(sessionsCollection);
			} catch {
				// Collection doesn't exist, that's fine
			}

			// Sessions collection uses text_dense vector for summary embeddings
			await this.client.createCollection(sessionsCollection, {
				vectors: {
					text_dense: {
						size: 384,
						distance: "Cosine",
					},
				},
			});
			console.log(`  [Session-Aware] Created sessions collection: ${sessionsCollection}`);
		}
	}

	/**
	 * Index a mapped instance for retrieval (Retriever interface)
	 * If FalkorDB is connected, loads memories from graph; otherwise uses mapped documents.
	 */
	async indexInstance(mapped: MappedInstance): Promise<void> {
		await this.initialize();

		// If FalkorDB is connected, load memories from graph instead of mapped documents
		if (this.falkorGraph) {
			const documents = await this.loadDocumentsFromFalkor(mapped);
			if (documents.length > 0) {
				console.log(`  [FalkorDB] Loaded ${documents.length} memories from graph`);
				await this.index(documents);
				return;
			}
			// Fall back to mapped documents if no memories found in graph
			console.log("  [FalkorDB] No memories found in graph, using mapped documents");
		}

		await this.index(mapped.documents);
	}

	/**
	 * Load documents from FalkorDB for a given instance.
	 * Queries Memory nodes linked to the instance's sessions.
	 */
	private async loadDocumentsFromFalkor(mapped: MappedInstance): Promise<EngramDocument[]> {
		if (!this.falkorGraph) return [];

		const documents: EngramDocument[] = [];

		// Get all session IDs from the mapped instance
		const sessionIds = mapped.instance.sessions.map(
			(s, idx) => `session_${mapped.instance.questionId}_${idx}`,
		);

		for (let sessionIndex = 0; sessionIndex < sessionIds.length; sessionIndex++) {
			const sessionId = sessionIds[sessionIndex];

			// Query memories for this session
			const result = await this.falkorGraph.query(
				`MATCH (s:Session {id: $sid})-[:HAS_TURN]->(t:Turn)-[:PRODUCES]->(m:Memory)
				 RETURN m.id as id, m.content as content, m.vt_start as validTime,
				        t.user_content as userContent, t.assistant_preview as assistantContent,
				        t.sequence_index as turnIndex`,
				{ params: { sid: sessionId } },
			);

			for (const row of result.data) {
				const [id, content, validTime, userContent, assistantContent, turnIndex] = row as [
					string,
					string,
					string,
					string,
					string,
					number,
				];

				documents.push({
					id: id as string,
					instanceId: mapped.instance.questionId,
					sessionId: sessionId,
					content: (content as string) || `${userContent || ""} ${assistantContent || ""}`.trim(),
					validTime: new Date(validTime as string),
					metadata: {
						questionId: mapped.instance.questionId,
						hasAnswer: false, // Will be updated during evaluation
						role: "combined" as const,
						turnIndex: turnIndex as number,
						sessionIndex,
					},
				});
			}
		}

		return documents;
	}

	/**
	 * Retrieve relevant documents for a question (Retriever interface)
	 * Uses session-aware retrieval, multi-query expansion, or standard search.
	 */
	async retrieve(question: string, _questionDate?: Date): Promise<RetrievalResult> {
		// Session-aware two-stage retrieval
		if (this.config.sessionAware && this.sessionRetriever) {
			return this.sessionAwareSearch(question);
		}
		// Multi-query expansion with RRF fusion
		if (this.config.multiQuery && this.xaiClient) {
			return this.multiQuerySearch(question, this.config.topK);
		}
		return this.search(question, this.config.topK);
	}

	/**
	 * Session-aware two-stage retrieval.
	 * Stage 1: Retrieve relevant sessions
	 * Stage 2: Retrieve turns within each session
	 */
	private async sessionAwareSearch(query: string): Promise<RetrievalResult> {
		if (!this.sessionRetriever) {
			return this.search(query, this.config.topK);
		}

		try {
			const results = await this.sessionRetriever.retrieve(query);

			// Convert SessionAwareSearchResult to EngramDocument
			const documents: EngramDocument[] = results.map((r) => {
				const payload = r.payload;
				return {
					id: payload?.node_id ?? String(r.id),
					instanceId: payload?.session_id ?? "",
					sessionId: r.sessionId,
					content: payload?.content ?? "",
					validTime: new Date(payload?.timestamp ?? Date.now()),
					metadata: {
						questionId: payload?.session_id ?? "",
						hasAnswer: false,
						role: "combined" as const,
						turnIndex: undefined,
						sessionIndex: 0,
					},
				};
			});

			return {
				documents,
				scores: results.map((r) => r.score),
				retrievedIds: documents.map((d) => d.id),
			};
		} catch (error) {
			console.warn("[Session-Aware] Retrieval failed, falling back to standard search:", error);
			return this.search(query, this.config.topK);
		}
	}

	/**
	 * Multi-query search: expand query into variations and fuse results with RRF.
	 * Based on DMQR-RAG: Diverse Multi-Query Rewriting for RAG.
	 * @see https://arxiv.org/abs/2411.13154
	 */
	private async multiQuerySearch(query: string, topK: number): Promise<RetrievalResult> {
		await this.initialize();

		try {
			// Step 1: Expand query into variations
			const variations = await this.expandQuery(query);
			console.log(`  [Multi-Query] Generated ${variations.length} query variations`);

			// Step 2: Search with each variation in parallel
			const perQueryLimit = Math.max(topK * 2, 20);
			const allResults = await Promise.all(
				variations.map((varQuery) => this.search(varQuery, perQueryLimit)),
			);

			// Step 3: Fuse results using RRF
			const fused = this.rrfFusionResults(allResults, topK);

			console.log(
				`  [Multi-Query] Fused ${allResults.reduce((sum, r) => sum + r.documents.length, 0)} candidates into ${fused.documents.length} results`,
			);

			return fused;
		} catch (error) {
			console.warn("[Multi-Query] Expansion failed, falling back to single query:", error);
			return this.search(query, topK);
		}
	}

	/**
	 * Expand a query into multiple variations using LLM.
	 */
	private async expandQuery(query: string): Promise<string[]> {
		const variations: string[] = [query]; // Always include original

		if (!this.xaiClient) {
			return variations;
		}

		const systemPrompt = `You are a search query expansion expert. Given a user query, generate alternative search queries that will help retrieve relevant documents.

Rules:
- Generate queries that are semantically different but target the same information need
- Each query should emphasize different aspects or use different vocabulary
- Return ONLY a JSON array of query strings
- Example: ["query 1", "query 2", "query 3"]
- Do not include numbering, bullets, or markdown formatting`;

		const userPrompt = `Generate ${this.config.multiQueryVariations} alternative search queries for:
"${query}"

Use these strategies:
- Paraphrase: Rephrase the query using different words and synonyms
- Keyword: Focus on key entities, names, and technical terms
- Step-back: Generalize to a broader concept or category

Return ONLY a JSON array of query strings. No explanations.`;

		try {
			const response = await this.xaiClient.chat([
				{ role: "system", content: systemPrompt },
				{ role: "user", content: userPrompt },
			]);

			// Parse JSON array from response
			const jsonMatch = response.match(/\[[\s\S]*\]/);
			if (jsonMatch) {
				const parsed = JSON.parse(jsonMatch[0]) as string[];
				const validVariations = parsed
					.filter((v) => typeof v === "string" && v.trim().length > 0 && v !== query)
					.slice(0, this.config.multiQueryVariations);
				variations.push(...validVariations);
			}
		} catch (error) {
			console.warn("[Multi-Query] Query expansion parsing failed:", error);
		}

		return variations;
	}

	/**
	 * Fuse multiple RetrievalResults using Reciprocal Rank Fusion (RRF).
	 * RRF score = sum(1 / (k + rank_i)) across all result sets.
	 */
	private rrfFusionResults(resultSets: RetrievalResult[], topK: number): RetrievalResult {
		const k = 60; // RRF constant
		const scoreMap = new Map<string, { document: EngramDocument; rrfScore: number }>();

		for (const results of resultSets) {
			for (let rank = 0; rank < results.documents.length; rank++) {
				const doc = results.documents[rank];
				const rrfScore = 1 / (k + rank + 1);

				const existing = scoreMap.get(doc.id);
				if (existing) {
					existing.rrfScore += rrfScore;
				} else {
					scoreMap.set(doc.id, { document: doc, rrfScore });
				}
			}
		}

		// Sort by RRF score and return top K
		const sorted = Array.from(scoreMap.values())
			.sort((a, b) => b.rrfScore - a.rrfScore)
			.slice(0, topK);

		return {
			documents: sorted.map((s) => s.document),
			scores: sorted.map((s) => s.rrfScore),
			retrievedIds: sorted.map((s) => s.document.id),
		};
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
		const denseEmbeddings = await Promise.all(
			texts.map((text) => this.textEmbedder?.embed(text) ?? Promise.resolve(new Float32Array(384))),
		);

		// Generate sparse embeddings if hybrid search enabled
		let sparseEmbeddings: SparseVector[] | null = null;
		if (this.config.hybridSearch && this.spladeEmbedder) {
			sparseEmbeddings = await Promise.all(
				texts.map(
					(text) =>
						this.spladeEmbedder?.embed(text) ?? Promise.resolve({ indices: [], values: [] }),
				),
			);
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
			const embedding = denseEmbeddings[i] ?? new Float32Array(384);
			const point: QdrantPoint = {
				id: this.hashId(doc.id),
				vector: {
					dense: Array.from(embedding),
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
			if (sparseEmbeddings?.[i]) {
				point.vector.sparse = sparseEmbeddings[i];
			}

			return point;
		});

		// Batch upsert with retry logic
		const batchSize = 50; // Smaller batches to reduce memory pressure
		for (let i = 0; i < points.length; i += batchSize) {
			const batch = points.slice(i, i + batchSize);
			if (!this.client) throw new Error("Client not initialized");
			const client = this.client;
			await this.retryOperation(() =>
				client.upsert(this.config.collectionName, {
					wait: true,
					points: batch,
				}),
			);
		}

		// Index session summaries if session-aware is enabled
		if (this.config.sessionAware && this.sessionSummarizer) {
			await this.indexSessionSummaries(documents);
		}

		this.indexed = true;
	}

	/**
	 * Group documents by session and index session summaries
	 */
	private async indexSessionSummaries(documents: EngramDocument[]): Promise<void> {
		if (!this.client || !this.sessionSummarizer) return;

		// Group documents by session
		const sessionGroups = this.groupBySession(documents);
		const sessionIds = Object.keys(sessionGroups);

		console.log(`  [Session-Aware] Generating summaries for ${sessionIds.length} sessions...`);

		// Generate summaries for each session
		const summaries = await Promise.all(
			sessionIds.map(async (sessionId) => {
				const docs = sessionGroups[sessionId];
				// Convert EngramDocument to Turn format for SessionSummarizer
				const turns = docs.map((doc) => ({
					id: doc.id,
					sessionId: doc.sessionId,
					role: doc.metadata.role as "user" | "assistant" | "system",
					content: doc.content,
					timestamp: doc.validTime,
				}));

				try {
					return await this.sessionSummarizer?.summarize(turns);
				} catch (error) {
					console.warn(`  [Session-Aware] Failed to summarize session ${sessionId}:`, error);
					return null;
				}
			}),
		);

		// Filter out failed summaries (type guard to narrow type)
		const validSummaries = summaries.filter((s): s is NonNullable<typeof s> => s !== null);
		console.log(`  [Session-Aware] Generated ${validSummaries.length} session summaries`);

		// Index summaries in sessions collection
		const sessionsCollection = `${this.config.collectionName}_sessions`;
		const sessionPoints = validSummaries.map((summary) => ({
			id: this.hashId(summary.sessionId),
			vector: {
				text_dense: summary.embedding,
			},
			payload: {
				session_id: summary.sessionId,
				summary: summary.summary,
				topics: summary.topics,
				entities: summary.entities,
				start_time: summary.startTime.toISOString(),
				end_time: summary.endTime.toISOString(),
				turn_count: summary.turnCount,
			},
		}));

		// Batch upsert sessions
		const client = this.client;
		for (let i = 0; i < sessionPoints.length; i += 50) {
			const batch = sessionPoints.slice(i, i + 50);
			await this.retryOperation(() =>
				client.upsert(sessionsCollection, {
					wait: true,
					points: batch,
				}),
			);
		}

		console.log(`  [Session-Aware] Indexed ${sessionPoints.length} session summaries`);
	}

	/**
	 * Group documents by session ID
	 */
	private groupBySession(docs: EngramDocument[]): Record<string, EngramDocument[]> {
		const groups: Record<string, EngramDocument[]> = {};
		for (const doc of docs) {
			if (!groups[doc.sessionId]) {
				groups[doc.sessionId] = [];
			}
			groups[doc.sessionId].push(doc);
		}
		// Sort each group by validTime
		for (const sessionId of Object.keys(groups)) {
			groups[sessionId].sort((a, b) => a.validTime.getTime() - b.validTime.getTime());
		}
		return groups;
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
					const delay = baseDelayMs * 2 ** attempt;
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
			// Step 0: Parse temporal expressions if enabled
			let semanticQuery = query;
			let temporalFilter: TemporalFilterType | null = null;

			if (this.temporalParser) {
				const parsed = this.temporalParser.parse(query);
				if (parsed.temporalFilter && parsed.confidence >= this.config.temporalConfidenceThreshold) {
					semanticQuery = parsed.semanticQuery;
					temporalFilter = parsed.temporalFilter;
					console.log(
						`  [Temporal] "${parsed.temporalFilter.expression}" → ` +
							`${parsed.temporalFilter.after?.toISOString().split("T")[0] ?? "∞"} to ` +
							`${parsed.temporalFilter.before?.toISOString().split("T")[0] ?? "∞"} ` +
							`(conf: ${parsed.confidence.toFixed(2)})`,
					);
				}
			}

			// Step 1: Generate query embeddings (use semantic query without temporal)
			const denseQuery = await this.textEmbedder.embedQuery(semanticQuery);
			let sparseQuery: SparseVector | null = null;
			if (this.config.hybridSearch && this.spladeEmbedder) {
				try {
					sparseQuery = await this.spladeEmbedder.embedQuery(semanticQuery);
				} catch (error) {
					// Fall back to dense-only if SPLADE fails
					console.warn("SPLADE embedding failed, using dense-only:", error);
				}
			}

			// Step 2: Retrieve candidates (fetch more for reranking)
			const fetchLimit = this.config.rerank ? this.config.rerankDepth : topK;
			let results: QdrantSearchResult[];

			if (this.config.hybridSearch && sparseQuery) {
				if (this.config.learnedFusion && this.learnedFusion) {
					// Learned fusion: fetch dense and sparse separately, then fuse with predicted weights
					results = await this.learnedFusionSearch(
						query,
						denseQuery,
						sparseQuery,
						fetchLimit,
						temporalFilter,
					);
				} else {
					// Standard hybrid search with fixed RRF fusion
					results = await this.hybridSearch(denseQuery, sparseQuery, fetchLimit, temporalFilter);
				}
			} else {
				// Dense-only search
				results = await this.denseSearch(denseQuery, fetchLimit, temporalFilter);
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

			const retrievalResult: RetrievalResult = {
				documents,
				scores: results.map((r) => r.score),
				retrievedIds: documents.map((d) => d.id),
			};

			// Apply abstention detection if enabled
			if (this.abstentionDetector && results.length > 0) {
				const abstentionResult = this.abstentionDetector.checkRetrievalConfidence(results);
				retrievalResult.abstained = abstentionResult.shouldAbstain;
				retrievalResult.abstentionReason = abstentionResult.reason;
				retrievalResult.retrievalConfidence = abstentionResult.confidence;

				if (abstentionResult.shouldAbstain) {
					console.log(`  [Abstention] ${abstentionResult.reason}: ${abstentionResult.details}`);
				}
			}

			return retrievalResult;
		} catch (error) {
			console.error("Search failed:", error);
			return { documents: [], scores: [], retrievedIds: [] };
		}
	}

	/**
	 * Dense-only vector search with retry and optional temporal filter
	 */
	private async denseSearch(
		queryVector: number[] | Float32Array,
		limit: number,
		temporalFilter?: TemporalFilterType | null,
	): Promise<QdrantSearchResult[]> {
		if (!this.client) return [];

		const client = this.client;
		const qdrantFilter = temporalFilter ? this.buildQdrantFilter(temporalFilter) : undefined;

		return this.retryOperation(async () => {
			const results = await client.search(this.config.collectionName, {
				vector: { name: "dense", vector: Array.from(queryVector) },
				limit,
				with_payload: true,
				filter: qdrantFilter,
			});
			return results ?? [];
		});
	}

	/**
	 * Build Qdrant filter from temporal constraints
	 */
	private buildQdrantFilter(filter: TemporalFilterType): Record<string, unknown> {
		const conditions: Array<{ key: string; range: { gte?: string; lte?: string } }> = [];

		if (filter.after) {
			conditions.push({
				key: "valid_time",
				range: { gte: filter.after.toISOString() },
			});
		}

		if (filter.before) {
			conditions.push({
				key: "valid_time",
				range: { lte: filter.before.toISOString() },
			});
		}

		return { must: conditions };
	}

	/**
	 * Hybrid search with RRF fusion (dense + sparse) and optional temporal filter
	 */
	private async hybridSearch(
		denseQuery: number[] | Float32Array,
		sparseQuery: SparseVector,
		limit: number,
		temporalFilter?: TemporalFilterType | null,
	): Promise<QdrantSearchResult[]> {
		if (!this.client) return [];

		const qdrantFilter = temporalFilter ? this.buildQdrantFilter(temporalFilter) : undefined;

		// Use Qdrant's native query API with prefetch for RRF
		try {
			const results = await this.client.query(this.config.collectionName, {
				prefetch: [
					{
						query: Array.from(denseQuery),
						using: "dense",
						limit: limit * 2,
						filter: qdrantFilter,
					},
					{
						query: {
							indices: sparseQuery.indices,
							values: sparseQuery.values,
						},
						using: "sparse",
						limit: limit * 2,
						filter: qdrantFilter,
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
			return this.denseSearch(denseQuery, limit, temporalFilter);
		}
	}

	/**
	 * Learned fusion search: fetch dense and sparse separately, then use MLP-predicted weights
	 */
	private async learnedFusionSearch(
		query: string,
		denseQuery: number[] | Float32Array,
		sparseQuery: SparseVector,
		limit: number,
		temporalFilter?: TemporalFilterType | null,
	): Promise<QdrantSearchResult[]> {
		if (!this.client || !this.learnedFusion) {
			return this.hybridSearch(denseQuery, sparseQuery, limit, temporalFilter);
		}

		try {
			// Fetch dense and sparse results separately
			const denseResults = await this.denseSearch(denseQuery, limit * 2, temporalFilter);
			const sparseResults = await this.sparseSearch(sparseQuery, limit * 2, temporalFilter);

			// Convert to SearchResult format for LearnedFusion
			const denseSearchResults = denseResults.map((r) => {
				const payload = r.payload as Record<string, unknown>;
				return {
					id: payload.doc_id as string,
					content: payload.content as string,
					score: r.score,
				};
			});

			const sparseSearchResults = sparseResults.map((r) => {
				const payload = r.payload as Record<string, unknown>;
				return {
					id: payload.doc_id as string,
					content: payload.content as string,
					score: r.score,
				};
			});

			// Use learned fusion to combine results
			const fusedResults = await this.learnedFusion.fuse(
				query,
				denseSearchResults,
				sparseSearchResults,
			);

			// Map back to QdrantSearchResult format
			const resultMap = new Map<string, QdrantSearchResult>();
			for (const r of denseResults) {
				const payload = r.payload as Record<string, unknown>;
				resultMap.set(payload.doc_id as string, r);
			}
			for (const r of sparseResults) {
				const payload = r.payload as Record<string, unknown>;
				if (!resultMap.has(payload.doc_id as string)) {
					resultMap.set(payload.doc_id as string, r);
				}
			}

			return fusedResults.slice(0, limit).map((f) => {
				const original = resultMap.get(f.id);
				if (!original) throw new Error(`Missing result for ${f.id}`);
				return { ...original, score: f.score };
			});
		} catch (error) {
			console.warn("Learned fusion failed, falling back to RRF:", error);
			return this.hybridSearch(denseQuery, sparseQuery, limit, temporalFilter);
		}
	}

	/**
	 * Sparse-only search
	 */
	private async sparseSearch(
		sparseQuery: SparseVector,
		limit: number,
		temporalFilter?: TemporalFilterType | null,
	): Promise<QdrantSearchResult[]> {
		if (!this.client) return [];

		const qdrantFilter = temporalFilter ? this.buildQdrantFilter(temporalFilter) : undefined;

		try {
			const results = await this.client.query(this.config.collectionName, {
				query: {
					indices: sparseQuery.indices,
					values: sparseQuery.values,
				},
				using: "sparse",
				limit,
				with_payload: true,
				filter: qdrantFilter,
			});
			return results.points || [];
		} catch {
			return [];
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
					if (!original) throw new Error(`Original result not found for ${item.id}`);
					return {
						...original,
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
					if (!original) throw new Error(`Original result not found for ${item.id}`);
					return {
						...original,
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
			const { TextEmbedder } = await import("@engram/search");
			this.textEmbedder = new TextEmbedder() as unknown as TextEmbedderInterface;
		} catch {
			throw new Error("@engram/search not available");
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

interface XAIClientInterface {
	chat(messages: Array<{ role: string; content: string }>): Promise<string>;
}

interface AbstentionDetectorInterface {
	checkRetrievalConfidence(results: Array<{ score: number }>): {
		shouldAbstain: boolean;
		reason?: string;
		confidence: number;
		details?: string;
	};
}

interface SessionSummarizerInterface {
	summarize(
		turns: Array<{
			id: string;
			sessionId: string;
			role: "user" | "assistant" | "system";
			content: string;
			timestamp: Date;
		}>,
	): Promise<{
		sessionId: string;
		summary: string;
		topics: string[];
		entities: string[];
		startTime: Date;
		endTime: Date;
		turnCount: number;
		embedding: number[];
	}>;
}

interface SessionRetrieverInterface {
	retrieve(query: string): Promise<
		Array<{
			id: string | number;
			score: number;
			sessionId: string;
			sessionSummary?: string;
			sessionScore?: number;
			payload?: {
				content?: string;
				node_id?: string;
				session_id?: string;
				timestamp?: number;
			};
		}>
	>;
}

interface LLMProviderInterface {
	complete(prompt: string): Promise<{ text: string }>;
}

interface TemporalFilterType {
	after?: Date;
	before?: Date;
	sortByRecency?: boolean;
	expression?: string;
}

interface TemporalParserInterface {
	parse(query: string): {
		semanticQuery: string;
		temporalFilter: TemporalFilterType | null;
		confidence: number;
	};
	setReferenceDate(date: Date): void;
}

interface LearnedFusionInterface {
	fuse(
		query: string,
		denseResults: Array<{ id: string; content: string; score: number }>,
		sparseResults: Array<{ id: string; content: string; score: number }>,
		rerankResults?: Array<{ id: string; content: string; score: number }>,
	): Promise<Array<{ id: string; content: string; score: number }>>;
}

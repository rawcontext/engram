import { QdrantClient } from "@qdrant/js-client-rest";
import type { EngramDocument } from "../mapper.js";
import type { EmbeddingProvider, RetrievalResult } from "../retriever.js";

/**
 * Configuration for the Qdrant provider
 */
export interface QdrantProviderConfig {
	/** Qdrant server URL */
	url: string;
	/** Collection name for benchmark data */
	collectionName: string;
	/** Embedding model to use */
	embeddingModel: "e5-small" | "e5-base" | "e5-large";
	/** Whether to use hybrid search (dense + sparse) */
	hybridSearch: boolean;
}

const DEFAULT_CONFIG: QdrantProviderConfig = {
	url: "http://localhost:6333",
	collectionName: "longmemeval_benchmark",
	embeddingModel: "e5-small",
	hybridSearch: true,
};

/**
 * Embedding dimensions by model
 */
const EMBEDDING_DIMENSIONS: Record<string, number> = {
	"e5-small": 384,
	"e5-base": 768,
	"e5-large": 1024,
};

/**
 * Qdrant-based embedding provider using HuggingFace transformers
 *
 * Uses @engram/search-core's TextEmbedder under the hood when available,
 * otherwise falls back to a lightweight implementation.
 */
export class QdrantEmbeddingProvider implements EmbeddingProvider {
	readonly dimension: number;
	private config: QdrantProviderConfig;
	private embedder: TextEmbedderInterface | null = null;

	constructor(config: Partial<QdrantProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.dimension = EMBEDDING_DIMENSIONS[this.config.embeddingModel] ?? 384;
	}

	/**
	 * Initialize the embedder (lazy loading)
	 */
	private async getEmbedder(): Promise<TextEmbedderInterface> {
		if (this.embedder) {
			return this.embedder;
		}

		try {
			// Try to import from search-core
			const { TextEmbedder } = await import("@engram/search-core");
			this.embedder = new TextEmbedder() as unknown as TextEmbedderInterface;
		} catch {
			// Fall back to stub if search-core not available
			console.warn("@engram/search-core not available, using stub embedder");
			this.embedder = new StubTextEmbedder(this.dimension);
		}

		return this.embedder;
	}

	/**
	 * Generate embeddings for a batch of texts
	 */
	async embed(texts: string[]): Promise<number[][]> {
		const embedder = await this.getEmbedder();

		// Embed in batches to avoid memory issues
		const embeddings: number[][] = [];
		const batchSize = 32;

		for (let i = 0; i < texts.length; i += batchSize) {
			const batch = texts.slice(i, i + batchSize);
			const batchEmbeddings = await Promise.all(batch.map((text) => embedder.embed(text)));
			embeddings.push(...batchEmbeddings);
		}

		return embeddings;
	}

	/**
	 * Generate embedding for a query
	 */
	async embedQuery(text: string): Promise<number[]> {
		const embedder = await this.getEmbedder();
		return embedder.embedQuery(text);
	}
}

/**
 * Interface for text embedders
 */
interface TextEmbedderInterface {
	embed(text: string): Promise<number[]>;
	embedQuery(text: string): Promise<number[]>;
}

/**
 * Stub embedder for when search-core is not available
 */
class StubTextEmbedder implements TextEmbedderInterface {
	private dimension: number;

	constructor(dimension: number) {
		this.dimension = dimension;
	}

	async embed(text: string): Promise<number[]> {
		return this.generateEmbedding(text, "passage:");
	}

	async embedQuery(text: string): Promise<number[]> {
		return this.generateEmbedding(text, "query:");
	}

	private generateEmbedding(text: string, prefix: string): number[] {
		// Simple deterministic embedding based on text hash
		const hash = this.hashString(prefix + text);
		return Array.from({ length: this.dimension }, (_, i) => {
			const x = Math.sin(hash + i) * 10000;
			return x - Math.floor(x);
		});
	}

	private hashString(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash = hash & hash;
		}
		return Math.abs(hash);
	}
}

/**
 * Qdrant-based retriever with hybrid search support
 */
export class QdrantRetriever {
	private client: QdrantClient;
	private config: QdrantProviderConfig;
	private embedder: QdrantEmbeddingProvider;
	private indexed: boolean = false;

	constructor(config: Partial<QdrantProviderConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.client = new QdrantClient({ url: this.config.url });
		this.embedder = new QdrantEmbeddingProvider(config);
	}

	/**
	 * Ensure collection exists with proper schema
	 */
	async ensureCollection(): Promise<void> {
		try {
			await this.client.getCollection(this.config.collectionName);
		} catch {
			// Collection doesn't exist, create it
			await this.client.createCollection(this.config.collectionName, {
				vectors: {
					dense: {
						size: this.embedder.dimension,
						distance: "Cosine",
					},
				},
			});
		}
	}

	/**
	 * Index documents for retrieval
	 */
	async index(documents: EngramDocument[]): Promise<void> {
		await this.ensureCollection();

		// Generate embeddings
		const texts = documents.map((d) => d.content);
		const embeddings = await this.embedder.embed(texts);

		// Upsert to Qdrant
		const points = documents.map((doc, i) => ({
			id: this.hashId(doc.id),
			vector: { dense: embeddings[i] },
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
		}));

		// Batch upsert
		const batchSize = 100;
		for (let i = 0; i < points.length; i += batchSize) {
			const batch = points.slice(i, i + batchSize);
			await this.client.upsert(this.config.collectionName, {
				wait: true,
				points: batch,
			});
		}

		this.indexed = true;
	}

	/**
	 * Search for relevant documents
	 */
	async search(query: string, topK: number): Promise<RetrievalResult> {
		if (!this.indexed) {
			return { documents: [], scores: [], retrievedIds: [] };
		}

		const queryVector = await this.embedder.embedQuery(query);

		const results = await this.client.search(this.config.collectionName, {
			vector: { name: "dense", vector: queryVector },
			limit: topK,
			with_payload: true,
		});

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
	}

	/**
	 * Clear the collection
	 */
	async clear(): Promise<void> {
		try {
			await this.client.deleteCollection(this.config.collectionName);
			this.indexed = false;
		} catch {
			// Collection might not exist
		}
	}

	/**
	 * Generate numeric hash for Qdrant point ID
	 */
	private hashId(id: string): number {
		let hash = 0;
		for (let i = 0; i < id.length; i++) {
			hash = (hash << 5) - hash + id.charCodeAt(i);
			hash = hash >>> 0; // Convert to unsigned
		}
		return hash;
	}
}

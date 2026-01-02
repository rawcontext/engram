import type { Logger } from "@engram/logger";

/**
 * Service for generating embeddings for entity resolution.
 *
 * Integrates with the Search service's /v1/search/embed endpoint to generate
 * BGE embeddings (384 dimensions) for entities. Embeddings are used for
 * similarity-based entity resolution in the knowledge graph.
 *
 * Entity embeddings are generated from:
 * - Entity name (canonical identifier)
 * - Description (optional context)
 * - Aliases (optional alternative names)
 *
 * These are concatenated and embedded using the same BGE model as memory
 * embeddings, enabling cross-collection similarity search.
 */

/**
 * Entity to embed with name, description, and aliases
 */
export interface EntityInput {
	/** Canonical name of the entity */
	name: string;
	/** Optional description providing context */
	description?: string;
	/** Optional array of alternative names */
	aliases?: string[];
}

/**
 * Response from Search service /v1/search/embed endpoint
 */
interface EmbedResponse {
	/** Dense embedding vector */
	embedding: number[];
	/** Number of dimensions */
	dimensions: number;
	/** Embedder type used */
	embedder_type: string;
	/** Time taken in milliseconds */
	took_ms: number;
}

/**
 * Service for generating entity embeddings via Search service.
 *
 * Uses the BGE model (384 dimensions) for consistency with memory embeddings.
 * Supports batch embedding for efficiency when processing multiple entities.
 */
export class EntityEmbeddingService {
	private readonly searchUrl: string;
	private readonly logger: Logger;

	/**
	 * Create a new EntityEmbeddingService.
	 *
	 * @param searchUrl - Base URL of the Search service (e.g., http://localhost:6176)
	 * @param logger - Logger instance for debugging and error tracking
	 */
	constructor(searchUrl: string, logger: Logger) {
		this.searchUrl = searchUrl.replace(/\/$/, ""); // Remove trailing slash
		this.logger = logger;
	}

	/**
	 * Generate embedding for a single entity.
	 *
	 * Concatenates entity name, description, and aliases into a single text
	 * string and embeds it using the BGE model via Search service.
	 *
	 * @param entity - Entity with name, description, and aliases
	 * @returns 384-dimensional BGE embedding vector
	 * @throws Error if embedding generation fails
	 */
	async embed(entity: EntityInput): Promise<number[]> {
		const text = this.buildEmbedText(entity);
		return await this.embedText(text);
	}

	/**
	 * Generate embeddings for multiple entities in batch.
	 *
	 * Processes entities sequentially to avoid overwhelming the Search service.
	 * For large batches, consider implementing parallel processing with rate limiting.
	 *
	 * @param entities - Array of entities to embed
	 * @returns Array of 384-dimensional BGE embedding vectors (same order as input)
	 * @throws Error if any embedding generation fails
	 */
	async embedBatch(entities: EntityInput[]): Promise<number[][]> {
		if (entities.length === 0) {
			return [];
		}

		this.logger.debug({ count: entities.length }, "Batch embedding entities");

		const embeddings: number[][] = [];

		// Process sequentially to avoid overwhelming the service
		// TODO: Consider parallel processing with rate limiting for large batches
		for (const entity of entities) {
			const embedding = await this.embed(entity);
			embeddings.push(embedding);
		}

		this.logger.debug({ count: embeddings.length }, "Batch embedding completed");

		return embeddings;
	}

	/**
	 * Build text to embed from entity properties.
	 *
	 * Concatenates name, description, and aliases with newlines for better
	 * semantic representation. Format:
	 *
	 * ```
	 * EntityName
	 * Description of the entity
	 * Alias1, Alias2, Alias3
	 * ```
	 *
	 * @param entity - Entity with name, description, and aliases
	 * @returns Concatenated text string for embedding
	 * @private
	 */
	private buildEmbedText(entity: EntityInput): string {
		const parts: string[] = [entity.name];

		if (entity.description) {
			parts.push(entity.description);
		}

		if (entity.aliases && entity.aliases.length > 0) {
			// Join aliases with commas for compact representation
			parts.push(entity.aliases.join(", "));
		}

		// Join with newlines for better semantic separation
		return parts.join("\n");
	}

	/**
	 * Call Search service /v1/search/embed endpoint to generate embedding.
	 *
	 * Uses embedder_type="text" to get BGE embeddings (384 dimensions).
	 * Sets is_query=false since entities are documents, not queries.
	 *
	 * @param text - Text to embed
	 * @returns 384-dimensional BGE embedding vector
	 * @throws Error if Search service request fails
	 * @private
	 */
	private async embedText(text: string): Promise<number[]> {
		const url = `${this.searchUrl}/v1/search/embed`;

		this.logger.debug({ text: text.substring(0, 50), url }, "Generating entity embedding");

		const startTime = Date.now();

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text,
				embedder_type: "text", // Use BGE model
				is_query: false, // Entities are documents, not queries
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			this.logger.error(
				{ status: response.status, error: errorText },
				"Search service embedding failed",
			);
			throw new Error(`Embedding failed: ${response.status} ${errorText}`);
		}

		const data = (await response.json()) as EmbedResponse;

		const tookMs = Date.now() - startTime;

		this.logger.debug(
			{
				dimensions: data.dimensions,
				search_took_ms: data.took_ms,
				total_took_ms: tookMs,
			},
			"Entity embedding generated",
		);

		return data.embedding;
	}
}

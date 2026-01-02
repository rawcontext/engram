import { createGeminiClient, type GeminiClient } from "@engram/common/clients";
import type { Entity, EntityRepository } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EntityEmbeddingService, EntityInput } from "./entity-embedding";
import type { ExtractedEntity } from "./entity-extractor";

/**
 * Result of entity resolution indicating whether an existing entity was matched
 * or a new entity was created.
 */
export interface EntityResolutionResult {
	/** The resolved or created entity */
	entity: Entity;
	/** Whether the entity existed already or was newly created */
	isNew: boolean;
	/** The resolution method used to match the entity */
	resolutionMethod:
		| "exact_name"
		| "alias_match"
		| "embedding_similarity"
		| "llm_confirmed"
		| "created";
	/** Similarity score if resolved via embedding (0-1) */
	similarityScore?: number;
}

/**
 * Configuration for entity resolution thresholds and behavior.
 */
export interface EntityResolverConfig {
	/** Minimum cosine similarity threshold for embedding-based matching (default: 0.9) */
	embeddingSimilarityThreshold: number;
	/** Maximum number of embedding candidates to consider (default: 5) */
	embeddingCandidateLimit: number;
	/** Whether to use LLM confirmation for high-similarity but not exact matches (default: true) */
	useLlmConfirmation: boolean;
	/** Gemini API key for LLM confirmation (optional, falls back to env) */
	geminiApiKey?: string;
}

/**
 * Default configuration for entity resolution.
 */
const DEFAULT_CONFIG: EntityResolverConfig = {
	embeddingSimilarityThreshold: 0.9,
	embeddingCandidateLimit: 5,
	useLlmConfirmation: true,
};

/**
 * Service for resolving extracted entities to existing entities or creating new ones.
 *
 * Entity resolution uses a multi-stage approach:
 * 1. **Exact Name Match**: Direct lookup by canonical name
 * 2. **Alias Match**: Search through entity aliases
 * 3. **Embedding Similarity**: Vector similarity search with configurable threshold
 * 4. **LLM Confirmation**: Optional LLM verification for high-similarity non-exact matches
 * 5. **Create New**: If no match found, create a new entity with generated embedding
 *
 * Merge behavior for matched entities:
 * - Add new name to aliases if not present
 * - Update description if new context provides richer information
 * - Do NOT update type (trust original classification)
 *
 * @example
 * ```typescript
 * const resolver = new EntityResolverService(entityRepo, embeddingService, server, logger);
 *
 * const extracted = { name: "Postgres", type: "technology", context: "used as primary database" };
 * const result = await resolver.resolve(extracted, "my-project");
 *
 * if (result.isNew) {
 *   console.log(`Created new entity: ${result.entity.id}`);
 * } else {
 *   console.log(`Matched existing entity via ${result.resolutionMethod}`);
 * }
 * ```
 *
 * @see https://arxiv.org/abs/2101.06126 - EAGER entity resolution
 * @see https://towardsdatascience.com/the-rise-of-semantic-entity-resolution/ - Semantic patterns
 */
export class EntityResolverService {
	private readonly entityRepo: EntityRepository;
	private readonly embeddingService: EntityEmbeddingService;
	private readonly server: McpServer;
	private readonly logger: Logger;
	private readonly config: EntityResolverConfig;
	private readonly geminiClient?: GeminiClient;

	constructor(
		entityRepo: EntityRepository,
		embeddingService: EntityEmbeddingService,
		server: McpServer,
		logger: Logger,
		config: Partial<EntityResolverConfig> = {},
	) {
		this.entityRepo = entityRepo;
		this.embeddingService = embeddingService;
		this.server = server;
		this.logger = logger;
		this.config = { ...DEFAULT_CONFIG, ...config };
		const geminiApiKey = config.geminiApiKey || process.env.GEMINI_API_KEY;
		if (geminiApiKey) {
			this.geminiClient = createGeminiClient({ apiKey: geminiApiKey });
		}
	}

	/**
	 * Resolve an extracted entity to an existing entity or create a new one.
	 *
	 * Resolution strategy (in order of priority):
	 * 1. Exact name match - fastest, highest confidence
	 * 2. Alias match - medium confidence
	 * 3. Embedding similarity - uses configurable threshold (default 0.9)
	 * 4. LLM confirmation - for high-similarity but uncertain matches
	 * 5. Create new entity - when no match found
	 *
	 * @param extracted - The extracted entity with name, type, and context
	 * @param project - Optional project scope for resolution
	 * @returns Resolution result with the matched/created entity and metadata
	 */
	async resolve(extracted: ExtractedEntity, project?: string): Promise<EntityResolutionResult> {
		const startTime = Date.now();

		this.logger.debug(
			{
				name: extracted.name,
				type: extracted.type,
				project,
			},
			"Resolving entity",
		);

		// 1. Exact Name Match
		const exactMatch = await this.resolveByExactName(extracted.name, project);
		if (exactMatch) {
			this.logger.debug(
				{ entityId: exactMatch.id, took_ms: Date.now() - startTime },
				"Resolved via exact name match",
			);
			await this.mergeEntityData(exactMatch, extracted);
			return { entity: exactMatch, isNew: false, resolutionMethod: "exact_name" };
		}

		// 2. Alias Match
		const aliasMatch = await this.resolveByAlias(extracted.name, project);
		if (aliasMatch) {
			this.logger.debug(
				{ entityId: aliasMatch.id, took_ms: Date.now() - startTime },
				"Resolved via alias match",
			);
			await this.mergeEntityData(aliasMatch, extracted);
			return { entity: aliasMatch, isNew: false, resolutionMethod: "alias_match" };
		}

		// 3. Embedding Similarity
		const embeddingResult = await this.resolveByEmbedding(extracted, project);
		if (embeddingResult) {
			// If similarity is very high (>0.95), accept without LLM confirmation
			if (embeddingResult.score >= 0.95) {
				this.logger.debug(
					{
						entityId: embeddingResult.entity.id,
						score: embeddingResult.score,
						took_ms: Date.now() - startTime,
					},
					"Resolved via high-confidence embedding similarity",
				);
				await this.mergeEntityData(embeddingResult.entity, extracted);
				return {
					entity: embeddingResult.entity,
					isNew: false,
					resolutionMethod: "embedding_similarity",
					similarityScore: embeddingResult.score,
				};
			}

			// 4. LLM Confirmation for moderate similarity
			if (this.config.useLlmConfirmation) {
				const confirmed = await this.confirmWithLlm(extracted.name, embeddingResult.entity.name);
				if (confirmed) {
					this.logger.debug(
						{
							entityId: embeddingResult.entity.id,
							score: embeddingResult.score,
							took_ms: Date.now() - startTime,
						},
						"Resolved via LLM-confirmed embedding similarity",
					);
					await this.mergeEntityData(embeddingResult.entity, extracted);
					return {
						entity: embeddingResult.entity,
						isNew: false,
						resolutionMethod: "llm_confirmed",
						similarityScore: embeddingResult.score,
					};
				}
			}
		}

		// 5. Create New Entity
		const newEntity = await this.createNewEntity(extracted, project);
		this.logger.debug(
			{ entityId: newEntity.id, took_ms: Date.now() - startTime },
			"Created new entity",
		);

		return { entity: newEntity, isNew: true, resolutionMethod: "created" };
	}

	/**
	 * Resolve multiple extracted entities in batch.
	 *
	 * Processes entities sequentially to avoid race conditions when
	 * multiple extractions might match the same entity.
	 *
	 * @param entities - Array of extracted entities
	 * @param project - Optional project scope
	 * @returns Array of resolution results in same order as input
	 */
	async resolveBatch(
		entities: ExtractedEntity[],
		project?: string,
	): Promise<EntityResolutionResult[]> {
		if (entities.length === 0) {
			return [];
		}

		this.logger.debug({ count: entities.length }, "Batch resolving entities");

		const results: EntityResolutionResult[] = [];

		// Process sequentially to avoid race conditions
		for (const extracted of entities) {
			const result = await this.resolve(extracted, project);
			results.push(result);
		}

		this.logger.debug(
			{
				total: results.length,
				new: results.filter((r) => r.isNew).length,
				matched: results.filter((r) => !r.isNew).length,
			},
			"Batch resolution complete",
		);

		return results;
	}

	// =============================================================================
	// Resolution Methods
	// =============================================================================

	/**
	 * Resolve by exact canonical name match.
	 */
	private async resolveByExactName(name: string, project?: string): Promise<Entity | null> {
		return await this.entityRepo.findByName(name, project);
	}

	/**
	 * Resolve by alias match.
	 * Searches existing entities where the extracted name appears in aliases.
	 */
	private async resolveByAlias(name: string, project?: string): Promise<Entity | null> {
		return await this.entityRepo.findByAlias(name, project);
	}

	/**
	 * Resolve by embedding similarity.
	 * Generates embedding for the extracted entity and searches for similar entities.
	 */
	private async resolveByEmbedding(
		extracted: ExtractedEntity,
		project?: string,
	): Promise<{ entity: Entity; score: number } | null> {
		try {
			// Build entity input for embedding
			const entityInput: EntityInput = {
				name: extracted.name,
				description: extracted.context,
			};

			// Generate embedding
			const embedding = await this.embeddingService.embed(entityInput);

			// Search for similar entities
			const similar = await this.entityRepo.findByEmbedding(
				embedding,
				this.config.embeddingCandidateLimit,
				this.config.embeddingSimilarityThreshold,
			);

			if (similar.length === 0) {
				return null;
			}

			// Filter by project if specified
			const candidates = project
				? similar.filter((e) => e.project === project || !e.project)
				: similar;

			if (candidates.length === 0) {
				return null;
			}

			// Return the highest-scoring candidate
			// Note: findByEmbedding returns results sorted by similarity descending
			// The score is not returned by the repository, so we use a placeholder
			// In a real implementation, the repository would return scores
			const topCandidate = candidates[0];

			// Re-compute similarity for the top candidate if it has an embedding
			if (topCandidate.embedding) {
				const score = this.cosineSimilarity(embedding, topCandidate.embedding);
				if (score >= this.config.embeddingSimilarityThreshold) {
					return { entity: topCandidate, score };
				}
			}

			// If no embedding on candidate, trust the repository threshold
			return { entity: topCandidate, score: this.config.embeddingSimilarityThreshold };
		} catch (error) {
			this.logger.warn({ error }, "Embedding-based resolution failed");
			return null;
		}
	}

	/**
	 * Confirm entity match using LLM.
	 * Asks the LLM if two entity names refer to the same entity.
	 */
	private async confirmWithLlm(extractedName: string, existingName: string): Promise<boolean> {
		try {
			// Try MCP sampling first
			const confirmed = await this.tryLlmConfirmWithSampling(extractedName, existingName);
			if (confirmed !== null) {
				return confirmed;
			}

			// Fall back to Gemini
			return await this.confirmWithGemini(extractedName, existingName);
		} catch (error) {
			this.logger.warn({ error }, "LLM confirmation failed, assuming no match");
			return false;
		}
	}

	/**
	 * Try LLM confirmation using MCP sampling.
	 * Returns null if sampling is unavailable.
	 */
	private async tryLlmConfirmWithSampling(
		extractedName: string,
		existingName: string,
	): Promise<boolean | null> {
		try {
			const clientCaps = (this.server.server as any).getClientCapabilities?.();
			if (!clientCaps?.sampling) {
				return null;
			}

			const prompt = this.buildConfirmationPrompt(extractedName, existingName);

			const response = await this.server.server.createMessage({
				messages: [
					{
						role: "user",
						content: { type: "text", text: prompt },
					},
				],
				maxTokens: 10,
			});

			if (!response || response.content.type !== "text") {
				return null;
			}

			return this.parseConfirmationResponse(response.content.text);
		} catch {
			return null;
		}
	}

	/**
	 * Confirm entity match using Gemini API via Vercel AI SDK.
	 */
	private async confirmWithGemini(extractedName: string, existingName: string): Promise<boolean> {
		if (!this.geminiClient) {
			this.logger.debug("Gemini client not configured, skipping LLM confirmation");
			return false;
		}

		const prompt = this.buildConfirmationPrompt(extractedName, existingName);

		const text = await this.geminiClient.generateText({
			prompt,
			maxTokens: 10,
		});

		if (!text) {
			return false;
		}

		return this.parseConfirmationResponse(text);
	}

	/**
	 * Build the LLM confirmation prompt.
	 */
	private buildConfirmationPrompt(extractedName: string, existingName: string): string {
		return `Are these two terms referring to the same entity/concept?

Term 1: "${extractedName}"
Term 2: "${existingName}"

Reply with only "YES" or "NO".`;
	}

	/**
	 * Parse LLM confirmation response.
	 */
	private parseConfirmationResponse(text: string): boolean {
		const normalized = text.trim().toUpperCase();
		return normalized === "YES" || normalized.startsWith("YES");
	}

	// =============================================================================
	// Entity Creation and Merging
	// =============================================================================

	/**
	 * Create a new entity with generated embedding.
	 */
	private async createNewEntity(extracted: ExtractedEntity, project?: string): Promise<Entity> {
		// Generate embedding for the new entity
		const entityInput: EntityInput = {
			name: extracted.name,
			description: extracted.context,
		};

		let embedding: number[] | undefined;
		try {
			embedding = await this.embeddingService.embed(entityInput);
		} catch (error) {
			this.logger.warn({ error }, "Failed to generate embedding for new entity");
		}

		// Create the entity
		return await this.entityRepo.create({
			name: extracted.name,
			type: extracted.type,
			description: extracted.context,
			aliases: [],
			project,
			embedding,
			mentionCount: 1,
		});
	}

	/**
	 * Merge new entity data into an existing entity.
	 *
	 * Merge rules:
	 * - Add new name to aliases if not already present
	 * - Update description if new context is richer (longer and informative)
	 * - Do NOT update type (trust original classification)
	 * - Increment mention count
	 */
	private async mergeEntityData(existing: Entity, extracted: ExtractedEntity): Promise<void> {
		const updates: {
			aliases?: string[];
			description?: string;
			mentionCount?: number;
		} = {};

		// Add extracted name to aliases if it differs from the canonical name
		// and is not already an alias
		const extractedNameNormalized = extracted.name.toLowerCase();
		const existingNameNormalized = existing.name.toLowerCase();

		if (
			extractedNameNormalized !== existingNameNormalized &&
			!existing.aliases.some((a) => a.toLowerCase() === extractedNameNormalized)
		) {
			updates.aliases = [...existing.aliases, extracted.name];
		}

		// Update description if new context is richer
		// Heuristic: longer description with substance is likely richer
		if (extracted.context && extracted.context.length > 10) {
			if (!existing.description || extracted.context.length > existing.description.length) {
				updates.description = extracted.context;
			}
		}

		// Always increment mention count
		updates.mentionCount = existing.mentionCount + 1;

		// Only update if there are changes
		if (Object.keys(updates).length > 0) {
			await this.entityRepo.update(existing.id, updates);
		}
	}

	// =============================================================================
	// Utility Methods
	// =============================================================================

	/**
	 * Compute cosine similarity between two vectors.
	 */
	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error("Vectors must have the same length");
		}

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		normA = Math.sqrt(normA);
		normB = Math.sqrt(normB);

		if (normA === 0 || normB === 0) {
			return 0;
		}

		return dotProduct / (normA * normB);
	}
}

/**
 * Summarizer Job Handler
 *
 * Generates descriptive summaries for entity communities using Gemini.
 * Subscribes to engram.jobs.summarization NATS subject.
 *
 * Flow:
 * 1. Receive community ID needing summarization
 * 2. Load member entities from MEMBER_OF edges via CommunityRepository
 * 3. For each entity, load memories via EntityRepository.findMentioningMemories()
 * 4. Deduplicate and sort by recency, limit to 100 total memories
 * 5. Build prompt using buildCommunitySummaryPrompt()
 * 6. Call Gemini with community-summary prompt
 * 7. Generate embedding for summary text via Search service
 * 8. Update Community node with generated content
 *
 * Performance:
 * - Limits entities to 50 per community
 * - Limits memories to 50 per entity, 100 total
 * - Single Gemini call per community
 */

import type { FalkorCommunityRepository, FalkorEntityRepository, Memory } from "@engram/graph";
import type { Logger } from "@engram/logger";
import { z } from "zod";
import {
	buildCommunitySummaryPrompt,
	COMMUNITY_SUMMARY_SYSTEM_MESSAGE,
	type CommunityInput,
} from "../prompts/community-summary";
import { BaseJobConsumer } from "./base";

// =============================================================================
// Constants
// =============================================================================

/** Maximum entities to process per community */
const MAX_ENTITIES_PER_COMMUNITY = 50;

/** Maximum memories to fetch per entity */
const MAX_MEMORIES_PER_ENTITY = 50;

/** Maximum total memories for summarization */
const MAX_TOTAL_MEMORIES = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Job message schema for community summarization jobs.
 */
export interface SummarizationJob {
	/** Community ID to summarize */
	communityId: string;

	/** Project identifier for context */
	project: string;

	/** Organization ID for tenant isolation */
	orgId: string;
}

/**
 * Zod schema for Gemini response validation
 */
const CommunitySummarySchema = z.object({
	name: z.string().describe("2-4 word descriptive community name"),
	text: z.string().describe("2-3 sentence summary of the community"),
	keywords: z.array(z.string()).describe("3-5 relevant keywords for search"),
});

type CommunitySummaryOutput = z.infer<typeof CommunitySummarySchema>;

/**
 * Result of a summarization job.
 */
interface SummarizationResult {
	communityId: string;
	name: string;
	summaryLength: number;
	keywordCount: number;
	entitiesProcessed: number;
	memoriesProcessed: number;
	embeddingDimensions: number;
	durationMs: number;
}

/**
 * Gemini client interface for generating structured output.
 */
interface GeminiClient {
	generateStructuredOutput<T>(options: {
		prompt: string;
		schema: z.ZodSchema<T>;
		systemInstruction?: string;
		temperature?: number;
	}): Promise<T>;
}

/**
 * Response from Search service /v1/search/embed endpoint
 */
interface EmbedResponse {
	embedding: number[];
	dimensions: number;
	embedder_type: string;
	took_ms: number;
}

// =============================================================================
// SummarizerConsumer Job Consumer
// =============================================================================

/**
 * Job consumer for community summarization using Gemini.
 *
 * Loads community member entities and their associated memories,
 * generates a descriptive summary using Gemini, and updates the
 * Community node with the generated content.
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 * import { FalkorCommunityRepository, FalkorEntityRepository } from "@engram/graph";
 * import { createGeminiClient } from "@engram/common/clients";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const gemini = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY });
 *
 * const consumer = new SummarizerConsumer(
 *   logger,
 *   communityRepo,
 *   entityRepo,
 *   gemini,
 *   "http://localhost:6176"
 * );
 * await consumer.subscribe();
 * ```
 */
export class SummarizerConsumer extends BaseJobConsumer<SummarizationJob> {
	readonly subject = "engram.jobs.summarization";
	readonly consumerName = "summarizer-worker";

	private communityRepo: FalkorCommunityRepository;
	private entityRepo: FalkorEntityRepository;
	private gemini: GeminiClient;
	private searchUrl: string;

	constructor(
		logger: Logger,
		communityRepo: FalkorCommunityRepository,
		entityRepo: FalkorEntityRepository,
		gemini: GeminiClient,
		searchUrl: string,
		natsUrl?: string,
	) {
		super(logger, natsUrl);
		this.communityRepo = communityRepo;
		this.entityRepo = entityRepo;
		this.gemini = gemini;
		this.searchUrl = searchUrl.replace(/\/$/, ""); // Remove trailing slash
	}

	/**
	 * Process a community summarization job.
	 *
	 * @param job - The summarization job parameters
	 */
	async process(job: SummarizationJob): Promise<void> {
		const startTime = Date.now();

		this.logger.info(
			{
				communityId: job.communityId,
				project: job.project,
				orgId: job.orgId,
			},
			"Starting community summarization job",
		);

		// Step 1: Load community to verify it exists
		const community = await this.communityRepo.findById(job.communityId);
		if (!community) {
			this.logger.warn({ communityId: job.communityId }, "Community not found, skipping");
			return;
		}

		// Step 2: Load member entity IDs
		const memberIds = await this.communityRepo.getMembers(job.communityId);

		if (memberIds.length === 0) {
			this.logger.warn({ communityId: job.communityId }, "No member entities found, skipping");
			return;
		}

		this.logger.info(
			{
				communityId: job.communityId,
				memberCount: memberIds.length,
			},
			"Loading member entities",
		);

		// Step 3: Load entity details and memories
		const communityInput = await this.buildCommunityInput(memberIds);

		if (communityInput.entities.length === 0) {
			this.logger.warn({ communityId: job.communityId }, "No valid entities loaded, skipping");
			return;
		}

		this.logger.info(
			{
				entityCount: communityInput.entities.length,
				memoryCount: communityInput.memories.length,
			},
			"Built community input for summarization",
		);

		// Step 4: Generate summary using Gemini
		const summary = await this.generateSummary(communityInput);

		this.logger.info(
			{
				name: summary.name,
				keywordCount: summary.keywords.length,
			},
			"Generated community summary",
		);

		// Step 5: Generate embedding for the summary text
		const embedding = await this.generateEmbedding(summary.text);

		// Step 6: Update community with generated content
		await this.communityRepo.update(job.communityId, {
			name: summary.name,
			summary: summary.text,
			keywords: summary.keywords,
			memoryCount: communityInput.memories.length,
			embedding,
		});

		// Log summary
		const result: SummarizationResult = {
			communityId: job.communityId,
			name: summary.name,
			summaryLength: summary.text.length,
			keywordCount: summary.keywords.length,
			entitiesProcessed: communityInput.entities.length,
			memoriesProcessed: communityInput.memories.length,
			embeddingDimensions: embedding.length,
			durationMs: Date.now() - startTime,
		};

		this.logger.info(
			{
				...result,
				project: job.project,
				orgId: job.orgId,
			},
			"Community summarization job completed",
		);
	}

	/**
	 * Build CommunityInput from member entity IDs.
	 *
	 * Loads entity details and their associated memories, deduplicates,
	 * and limits to configured maximums.
	 *
	 * @param memberIds - Array of entity IDs to load
	 * @returns CommunityInput for prompt building
	 */
	private async buildCommunityInput(memberIds: string[]): Promise<CommunityInput> {
		const entities: CommunityInput["entities"] = [];
		const allMemories: Array<{ memory: Memory; vtStart: number }> = [];

		// Limit entities
		const limitedMemberIds = memberIds.slice(0, MAX_ENTITIES_PER_COMMUNITY);

		// Load each entity and its memories
		for (const entityId of limitedMemberIds) {
			const entity = await this.entityRepo.findById(entityId);
			if (!entity) {
				this.logger.debug({ entityId }, "Entity not found, skipping");
				continue;
			}

			// Add entity to list
			entities.push({
				name: entity.name,
				type: entity.type,
				description: entity.description,
			});

			// Load memories mentioning this entity
			const memories = await this.entityRepo.findMentioningMemories(entityId);

			// Add memories with their timestamps for sorting
			for (const memory of memories.slice(0, MAX_MEMORIES_PER_ENTITY)) {
				allMemories.push({
					memory,
					vtStart: memory.vtStart,
				});
			}
		}

		// Deduplicate memories by ID
		const seenMemoryIds = new Set<string>();
		const uniqueMemories = allMemories.filter((m) => {
			if (seenMemoryIds.has(m.memory.id)) {
				return false;
			}
			seenMemoryIds.add(m.memory.id);
			return true;
		});

		// Sort by recency (newest first) and limit
		const sortedMemories = uniqueMemories
			.sort((a, b) => b.vtStart - a.vtStart)
			.slice(0, MAX_TOTAL_MEMORIES);

		// Convert to prompt format
		const memories: CommunityInput["memories"] = sortedMemories.map((m) => ({
			content: m.memory.content,
			type: m.memory.type,
		}));

		return { entities, memories };
	}

	/**
	 * Generate community summary using Gemini.
	 *
	 * @param input - CommunityInput with entities and memories
	 * @returns Generated summary with name, text, and keywords
	 */
	private async generateSummary(input: CommunityInput): Promise<CommunitySummaryOutput> {
		const prompt = buildCommunitySummaryPrompt(input);

		const result = await this.gemini.generateStructuredOutput({
			prompt,
			schema: CommunitySummarySchema,
			systemInstruction: COMMUNITY_SUMMARY_SYSTEM_MESSAGE,
			temperature: 0.7, // Allow some creativity for naming
		});

		return result;
	}

	/**
	 * Generate embedding for summary text via Search service.
	 *
	 * @param text - Summary text to embed
	 * @returns 384-dimensional BGE embedding vector
	 */
	private async generateEmbedding(text: string): Promise<number[]> {
		const url = `${this.searchUrl}/v1/search/embed`;

		this.logger.debug({ textLength: text.length, url }, "Generating summary embedding");

		const startTime = Date.now();

		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				text,
				embedder_type: "text", // Use BGE model
				is_query: false, // Summaries are documents, not queries
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
			"Summary embedding generated",
		);

		return data.embedding;
	}
}

/**
 * Factory function to create a SummarizerConsumer.
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 * import { FalkorClient } from "@engram/storage";
 * import { FalkorCommunityRepository, FalkorEntityRepository } from "@engram/graph";
 * import { createGeminiClient } from "@engram/common/clients";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const falkor = new FalkorClient(process.env.FALKOR_URL);
 * await falkor.connect();
 *
 * const communityRepo = new FalkorCommunityRepository(falkor, logger);
 * const entityRepo = new FalkorEntityRepository(falkor, logger);
 * const gemini = createGeminiClient();
 *
 * const consumer = createSummarizerConsumer({
 *   logger,
 *   communityRepo,
 *   entityRepo,
 *   gemini,
 *   searchUrl: process.env.SEARCH_URL || "http://localhost:6176",
 *   natsUrl: process.env.NATS_URL,
 * });
 *
 * await consumer.subscribe();
 * ```
 */
export function createSummarizerConsumer(options: {
	logger: Logger;
	communityRepo: FalkorCommunityRepository;
	entityRepo: FalkorEntityRepository;
	gemini: GeminiClient;
	searchUrl: string;
	natsUrl?: string;
}): SummarizerConsumer {
	return new SummarizerConsumer(
		options.logger,
		options.communityRepo,
		options.entityRepo,
		options.gemini,
		options.searchUrl,
		options.natsUrl,
	);
}

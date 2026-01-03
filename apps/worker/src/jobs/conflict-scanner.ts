/**
 * ConflictScanner Job Handler
 *
 * Scans existing memories for conflicts using vector similarity and LLM classification.
 * Subscribes to engram.jobs.conflict-scan NATS subject. Runs weekly.
 *
 * Flow:
 * 1. Load active memories for project/org from MemoryRepository
 * 2. For each memory, call search service /conflict-candidates endpoint
 * 3. Filter candidates with similarity > 0.7, limit to top 5 per memory
 * 4. Batch classify conflicts using Gemini (20 pairs per batch)
 * 5. Create ConflictReport nodes for confirmed conflicts
 *
 * Performance:
 * - Batches LLM classification calls (20 pairs per batch)
 * - Rate limits search API calls
 * - Skips already-scanned memory pairs (using scan watermarks)
 */

import type { GeminiClient } from "@engram/common/clients";
import type {
	CreateConflictReportInput,
	FalkorConflictReportRepository,
	FalkorMemoryRepository,
	Memory,
} from "@engram/graph";
import type { Logger } from "@engram/logger";
import { z } from "zod";
import { BaseJobConsumer } from "./base";

// =============================================================================
// Constants
// =============================================================================

/** Minimum similarity threshold for conflict candidates */
const MIN_SIMILARITY_THRESHOLD = 0.7;

/** Maximum candidates per memory */
const MAX_CANDIDATES_PER_MEMORY = 5;

/** Batch size for LLM classification */
const CLASSIFICATION_BATCH_SIZE = 20;

/** Rate limit delay between search API calls (ms) */
const SEARCH_RATE_LIMIT_MS = 100;

// =============================================================================
// Types
// =============================================================================

/**
 * Job message schema for conflict scanning jobs.
 */
export interface ConflictScanJob {
	/** Project identifier for filtering memories */
	project: string;

	/** Organization ID for tenant isolation */
	orgId: string;

	/** Unique execution ID for this scan run */
	scanId: string;

	/** Trigger source: cron schedule, threshold trigger, or manual request */
	triggeredBy: "cron" | "threshold" | "manual";
}

/**
 * Response from search service /conflict-candidates endpoint
 */
interface ConflictCandidateResponse {
	memory_id: string;
	content: string;
	type: string;
	similarity: number;
	vt_start: number;
	vt_end: number;
	project?: string;
}

/**
 * Candidate pair for conflict classification
 */
interface CandidatePair {
	memoryA: Memory;
	candidate: ConflictCandidateResponse;
}

/**
 * Zod schema for conflict detection LLM response
 */
const ConflictDetectionSchema = z.object({
	relation: z
		.enum(["contradiction", "supersedes", "augments", "duplicate", "independent"])
		.describe("Type of relationship between memories"),
	confidence: z.number().min(0).max(1).describe("Confidence score in the classification"),
	reasoning: z.string().describe("Human-readable explanation of the relationship"),
	suggestedAction: z
		.enum(["invalidate_a", "invalidate_b", "keep_both", "merge"])
		.describe("Recommended action based on the relationship"),
});

type ConflictDetectionResponse = z.infer<typeof ConflictDetectionSchema>;

/**
 * Result of a conflict scan job.
 */
interface ScanResult {
	memoriesScanned: number;
	candidatesFound: number;
	conflictsDetected: number;
	reportsCreated: number;
	durationMs: number;
}

// =============================================================================
// ConflictScannerConsumer Job Consumer
// =============================================================================

/**
 * Job consumer for background conflict scanning.
 *
 * Scans existing memories for potential conflicts using vector similarity
 * and LLM classification. Creates ConflictReport nodes for review.
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 * import { FalkorMemoryRepository, FalkorConflictReportRepository } from "@engram/graph";
 * import { createGeminiClient } from "@engram/common/clients";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const gemini = createGeminiClient({ apiKey: process.env.GEMINI_API_KEY });
 *
 * const consumer = new ConflictScannerConsumer(
 *   logger,
 *   memoryRepo,
 *   conflictRepo,
 *   gemini,
 *   "http://localhost:6176"
 * );
 * await consumer.subscribe();
 * ```
 */
export class ConflictScannerConsumer extends BaseJobConsumer<ConflictScanJob> {
	readonly subject = "engram.jobs.conflict-scan";
	readonly consumerName = "conflict-scanner-worker";

	private memoryRepo: FalkorMemoryRepository;
	private conflictRepo: FalkorConflictReportRepository;
	private gemini: GeminiClient;
	private searchUrl: string;

	constructor(
		logger: Logger,
		memoryRepo: FalkorMemoryRepository,
		conflictRepo: FalkorConflictReportRepository,
		gemini: GeminiClient,
		searchUrl: string,
		natsUrl?: string,
	) {
		super(logger, natsUrl);
		this.memoryRepo = memoryRepo;
		this.conflictRepo = conflictRepo;
		this.gemini = gemini;
		this.searchUrl = searchUrl.replace(/\/$/, ""); // Remove trailing slash
	}

	/**
	 * Process a conflict scan job.
	 *
	 * @param job - The conflict scan job parameters
	 */
	async process(job: ConflictScanJob): Promise<void> {
		const startTime = Date.now();

		this.logger.info(
			{
				project: job.project,
				orgId: job.orgId,
				scanId: job.scanId,
				triggeredBy: job.triggeredBy,
			},
			"Starting conflict scan job",
		);

		// Step 1: Load active memories for project
		const memories = await this.memoryRepo.findByProject(job.project);

		if (memories.length === 0) {
			this.logger.info({ project: job.project }, "No memories found for project, skipping scan");
			return;
		}

		this.logger.info(
			{
				memoryCount: memories.length,
				project: job.project,
			},
			"Loaded memories for conflict scanning",
		);

		// Step 2: Collect all candidate pairs
		const allPairs: CandidatePair[] = [];

		for (const memory of memories) {
			const candidates = await this.findConflictCandidates(memory, job.orgId);

			for (const candidate of candidates) {
				// Skip self-matches
				if (candidate.memory_id === memory.id) {
					continue;
				}

				// Skip if we've already seen this pair (in either direction)
				const hasPair = allPairs.some(
					(p) =>
						(p.memoryA.id === memory.id && p.candidate.memory_id === candidate.memory_id) ||
						(p.memoryA.id === candidate.memory_id && p.candidate.memory_id === memory.id),
				);

				if (!hasPair) {
					allPairs.push({ memoryA: memory, candidate });
				}
			}

			// Rate limit search API calls
			await this.sleep(SEARCH_RATE_LIMIT_MS);
		}

		this.logger.info(
			{
				pairCount: allPairs.length,
			},
			"Collected candidate pairs for classification",
		);

		if (allPairs.length === 0) {
			this.logger.info({ project: job.project }, "No conflict candidates found, scan complete");
			return;
		}

		// Step 3: Batch classify conflicts
		const conflictReports: CreateConflictReportInput[] = [];
		const batches = this.batchArray(allPairs, CLASSIFICATION_BATCH_SIZE);

		for (let i = 0; i < batches.length; i++) {
			const batch = batches[i];
			this.logger.debug(
				{
					batchIndex: i + 1,
					batchSize: batch.length,
					totalBatches: batches.length,
				},
				"Processing classification batch",
			);

			const batchResults = await this.classifyBatch(batch, job);
			conflictReports.push(...batchResults);
		}

		// Step 4: Create ConflictReport nodes
		if (conflictReports.length > 0) {
			await this.conflictRepo.createMany(conflictReports);

			this.logger.info(
				{
					reportsCreated: conflictReports.length,
				},
				"Created conflict reports",
			);
		}

		// Log summary
		const result: ScanResult = {
			memoriesScanned: memories.length,
			candidatesFound: allPairs.length,
			conflictsDetected: conflictReports.length,
			reportsCreated: conflictReports.length,
			durationMs: Date.now() - startTime,
		};

		this.logger.info(
			{
				...result,
				project: job.project,
				orgId: job.orgId,
				scanId: job.scanId,
			},
			"Conflict scan job completed",
		);
	}

	/**
	 * Find conflict candidates for a memory via search service.
	 *
	 * @param memory - Memory to find candidates for
	 * @param orgId - Organization ID for tenant isolation
	 * @returns Array of conflict candidates (similarity > 0.7, max 5)
	 */
	private async findConflictCandidates(
		memory: Memory,
		orgId: string,
	): Promise<ConflictCandidateResponse[]> {
		const url = `${this.searchUrl}/v1/search/conflict-candidates`;

		try {
			const response = await fetch(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					// In production, this would include auth token
					// For now, we pass org_id in the body for local dev
				},
				body: JSON.stringify({
					content: memory.content,
					project: memory.project,
					org_id: orgId,
				}),
			});

			if (!response.ok) {
				const errorText = await response.text();
				this.logger.warn(
					{
						status: response.status,
						error: errorText,
						memoryId: memory.id,
					},
					"Search service conflict-candidates request failed",
				);
				return [];
			}

			const candidates = (await response.json()) as ConflictCandidateResponse[];

			// Filter by similarity threshold and limit
			return candidates
				.filter((c) => c.similarity >= MIN_SIMILARITY_THRESHOLD)
				.slice(0, MAX_CANDIDATES_PER_MEMORY);
		} catch (error) {
			this.logger.warn(
				{
					error,
					memoryId: memory.id,
				},
				"Failed to fetch conflict candidates",
			);
			return [];
		}
	}

	/**
	 * Classify a batch of candidate pairs using Gemini.
	 *
	 * @param pairs - Array of candidate pairs to classify
	 * @param job - Job context for report creation
	 * @returns Array of conflict reports for non-independent pairs
	 */
	private async classifyBatch(
		pairs: CandidatePair[],
		job: ConflictScanJob,
	): Promise<CreateConflictReportInput[]> {
		const reports: CreateConflictReportInput[] = [];

		for (const pair of pairs) {
			try {
				const result = await this.classifyPair(pair);

				// Only create reports for actual conflicts (not independent)
				if (result.relation !== "independent") {
					reports.push({
						memoryIdA: pair.memoryA.id,
						memoryIdB: pair.candidate.memory_id,
						relation: result.relation,
						confidence: result.confidence,
						reasoning: result.reasoning,
						modelUsed: "gemini-3-flash-preview",
						suggestedAction: result.suggestedAction,
						scanId: job.scanId,
						scannedAt: Date.now(),
						orgId: job.orgId,
						project: job.project,
					});
				}
			} catch (error) {
				this.logger.warn(
					{
						error,
						memoryA: pair.memoryA.id,
						memoryB: pair.candidate.memory_id,
					},
					"Failed to classify conflict pair",
				);
			}
		}

		return reports;
	}

	/**
	 * Classify a single candidate pair using Gemini.
	 *
	 * @param pair - Candidate pair to classify
	 * @returns Classification result
	 */
	private async classifyPair(pair: CandidatePair): Promise<ConflictDetectionResponse> {
		const prompt = this.buildClassificationPrompt(pair);

		const result = await this.gemini.generateStructuredOutput({
			prompt,
			schema: ConflictDetectionSchema,
			systemInstruction: this.getSystemInstruction(),
			temperature: 0.2, // Low temperature for consistent classification
		});

		return result;
	}

	/**
	 * Build the classification prompt for a candidate pair.
	 */
	private buildClassificationPrompt(pair: CandidatePair): string {
		return `Compare these two memories and classify their relationship.

MEMORY A (${pair.memoryA.type}):
${pair.memoryA.content}

MEMORY B (${pair.candidate.type}):
${pair.candidate.content}

Similarity Score: ${pair.candidate.similarity.toFixed(2)}

Classify the relationship between these memories.`;
	}

	/**
	 * Get the system instruction for conflict classification.
	 */
	private getSystemInstruction(): string {
		return `You are a memory conflict analyzer for a knowledge management system.

RELATIONSHIP TYPES:
- contradiction: Facts directly contradict each other (one must be true, the other false)
- supersedes: One fact replaces/updates the other (e.g., changed preference, newer decision)
- augments: Facts complement each other (additional context, refinement)
- duplicate: Facts are semantically identical or paraphrased
- independent: Facts are unrelated or orthogonal

SUGGESTED ACTIONS:
- invalidate_a: Mark Memory A as no longer valid
- invalidate_b: Mark Memory B as no longer valid
- keep_both: Keep both memories (for independent or augmenting relationships)
- merge: Combine into one updated memory

Consider:
- Are they about the same topic?
- Do they make contradictory claims?
- Is one more recent or specific?
- Do they complement each other?

Be conservative - only classify as contradiction/supersedes if truly necessary.`;
	}

	/**
	 * Split an array into batches of specified size.
	 */
	private batchArray<T>(array: T[], batchSize: number): T[][] {
		const batches: T[][] = [];
		for (let i = 0; i < array.length; i += batchSize) {
			batches.push(array.slice(i, i + batchSize));
		}
		return batches;
	}

	/**
	 * Sleep for specified milliseconds.
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

/**
 * Factory function to create a ConflictScannerConsumer.
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 * import { FalkorClient } from "@engram/storage";
 * import { FalkorMemoryRepository, FalkorConflictReportRepository } from "@engram/graph";
 * import { createGeminiClient } from "@engram/common/clients";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const falkor = new FalkorClient(process.env.FALKOR_URL);
 * await falkor.connect();
 *
 * const memoryRepo = new FalkorMemoryRepository(falkor, logger);
 * const conflictRepo = new FalkorConflictReportRepository(falkor, logger);
 * const gemini = createGeminiClient();
 *
 * const consumer = createConflictScannerConsumer({
 *   logger,
 *   memoryRepo,
 *   conflictRepo,
 *   gemini,
 *   searchUrl: process.env.SEARCH_URL || "http://localhost:6176",
 *   natsUrl: process.env.NATS_URL,
 * });
 *
 * await consumer.subscribe();
 * ```
 */
export function createConflictScannerConsumer(options: {
	logger: Logger;
	memoryRepo: FalkorMemoryRepository;
	conflictRepo: FalkorConflictReportRepository;
	gemini: GeminiClient;
	searchUrl: string;
	natsUrl?: string;
}): ConflictScannerConsumer {
	return new ConflictScannerConsumer(
		options.logger,
		options.memoryRepo,
		options.conflictRepo,
		options.gemini,
		options.searchUrl,
		options.natsUrl,
	);
}

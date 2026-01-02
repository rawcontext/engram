/**
 * DecayCalculator Job Handler
 *
 * Calculates and updates decay scores for active memories in FalkorDB.
 * Subscribes to engram.jobs.decay-calculation NATS subject.
 * Runs daily at 2am via cron scheduler.
 *
 * Flow:
 * 1. Load active memories (exclude pinned): tt_end = MAX_DATE, vt_end = MAX_DATE, pinned = false
 * 2. Partition by project/org for isolation
 * 3. Calculate decay_score using decay algorithm
 * 4. Batch update (100 at a time) with UNWIND to minimize graph transactions
 * 5. Log summary: memories processed, avg decay, min/max scores
 *
 * Performance:
 * - 100K memories target: ~30 seconds with batching
 * - Skip memories where |old_score - new_score| < 0.01 (no meaningful change)
 */

import type { FalkorClient, QueryParams } from "@engram/storage";
import { calculateDecayScore, type DecayInput } from "../algorithms/decay";
import { BaseJobConsumer } from "./base";

// =============================================================================
// Constants
// =============================================================================

/** Batch size for FalkorDB UNWIND updates */
const BATCH_SIZE = 100;

/** Minimum score change threshold to skip unnecessary updates */
const SCORE_CHANGE_THRESHOLD = 0.01;

/** MAX_DATE for bitemporal queries (year 9999) */
const MAX_DATE = 253402300799999;

// =============================================================================
// Types
// =============================================================================

/**
 * Job message schema for decay calculation jobs.
 */
export interface DecayCalculationJob {
	/** Optional project filter (default: all projects) */
	project?: string;

	/** Organization ID for tenant isolation */
	orgId: string;

	/** Whether triggered by cron or manual request */
	triggeredBy: "cron" | "manual";
}

/**
 * Memory data loaded from FalkorDB for decay calculation.
 */
interface MemoryRecord {
	id: string;
	type: string;
	vt_start: number;
	last_accessed: number | null;
	access_count: number;
	decay_score: number;
	pinned: boolean;
	project: string | null;
}

/**
 * Decay update to apply to a memory.
 */
interface DecayUpdate {
	id: string;
	score: number;
}

/**
 * Summary statistics for a decay calculation run.
 */
interface DecaySummary {
	memoriesProcessed: number;
	memoriesUpdated: number;
	memoriesSkipped: number;
	avgScore: number;
	minScore: number;
	maxScore: number;
	durationMs: number;
}

// =============================================================================
// DecayCalculator Job Consumer
// =============================================================================

/**
 * Job consumer for decay score calculations.
 *
 * Processes memories in batches, calculates new decay scores using the
 * exponential decay algorithm, and updates FalkorDB efficiently using UNWIND.
 *
 * @example
 * ```typescript
 * import { createNodeLogger } from "@engram/logger";
 * import { FalkorClient } from "@engram/storage";
 *
 * const logger = createNodeLogger({ service: "worker" });
 * const falkor = new FalkorClient(process.env.FALKOR_URL);
 * await falkor.connect();
 *
 * const consumer = new DecayCalculatorConsumer(logger, falkor);
 * await consumer.subscribe();
 * ```
 */
export class DecayCalculatorConsumer extends BaseJobConsumer<DecayCalculationJob> {
	readonly subject = "engram.jobs.decay-calculation";
	readonly consumerName = "decay-calculator-worker";

	private falkor: FalkorClient;

	constructor(logger: import("@engram/logger").Logger, falkor: FalkorClient, natsUrl?: string) {
		super(logger, natsUrl);
		this.falkor = falkor;
	}

	/**
	 * Process a decay calculation job.
	 *
	 * @param job - The decay calculation job parameters
	 */
	async process(job: DecayCalculationJob): Promise<void> {
		const startTime = Date.now();

		this.logger.info(
			{
				orgId: job.orgId,
				project: job.project,
				triggeredBy: job.triggeredBy,
			},
			"Starting decay calculation job",
		);

		// Load active memories
		const memories = await this.loadActiveMemories(job.project);

		if (memories.length === 0) {
			this.logger.info("No active memories to process");
			return;
		}

		this.logger.info(
			{ memoryCount: memories.length },
			"Loaded active memories for decay calculation",
		);

		// Calculate new decay scores
		const now = Date.now();
		const updates: DecayUpdate[] = [];
		let skipped = 0;

		for (const memory of memories) {
			const input: DecayInput = {
				type: memory.type as DecayInput["type"],
				createdAt: memory.vt_start,
				lastAccessed: memory.last_accessed ?? undefined,
				accessCount: memory.access_count,
				pinned: memory.pinned,
			};

			const newScore = calculateDecayScore(input, now);

			// Skip if score hasn't changed meaningfully
			if (Math.abs(memory.decay_score - newScore) < SCORE_CHANGE_THRESHOLD) {
				skipped++;
				continue;
			}

			updates.push({ id: memory.id, score: newScore });
		}

		this.logger.info(
			{
				updatesNeeded: updates.length,
				skipped,
			},
			"Calculated decay scores",
		);

		// Batch update to FalkorDB
		let _updated = 0;
		for (let i = 0; i < updates.length; i += BATCH_SIZE) {
			const batch = updates.slice(i, i + BATCH_SIZE);
			await this.batchUpdateScores(batch, now);
			_updated += batch.length;

			// Log progress for large batches
			if (updates.length > BATCH_SIZE && (i + BATCH_SIZE) % 1000 === 0) {
				this.logger.debug(
					{ processed: i + BATCH_SIZE, total: updates.length },
					"Decay update progress",
				);
			}
		}

		// Calculate summary statistics
		const summary = this.calculateSummary(updates, skipped, startTime);

		this.logger.info(
			{
				...summary,
				orgId: job.orgId,
				project: job.project,
			},
			"Decay calculation job completed",
		);
	}

	/**
	 * Load active memories from FalkorDB.
	 * Active = tt_end = MAX_DATE AND vt_end = MAX_DATE AND pinned = false
	 *
	 * @param project - Optional project filter
	 * @returns Array of memory records for decay calculation
	 */
	private async loadActiveMemories(project?: string): Promise<MemoryRecord[]> {
		const projectFilter = project ? "AND m.project = $project" : "";

		const cypher = `
			MATCH (m:Memory)
			WHERE m.tt_end = $maxDate
				AND m.vt_end = $maxDate
				AND m.pinned = false
				${projectFilter}
			RETURN m.id AS id,
				m.type AS type,
				m.vt_start AS vt_start,
				m.last_accessed AS last_accessed,
				m.access_count AS access_count,
				m.decay_score AS decay_score,
				m.pinned AS pinned,
				m.project AS project
		`;

		const params: QueryParams = { maxDate: MAX_DATE };
		if (project) {
			params.project = project;
		}

		return this.falkor.query<MemoryRecord>(cypher, params);
	}

	/**
	 * Batch update decay scores using UNWIND for efficiency.
	 * Uses UNWIND to update multiple nodes in a single query, minimizing
	 * round trips to FalkorDB.
	 *
	 * @param updates - Array of decay updates to apply
	 * @param now - Current timestamp for decay_updated_at
	 */
	private async batchUpdateScores(updates: DecayUpdate[], now: number): Promise<void> {
		if (updates.length === 0) {
			return;
		}

		// UNWIND the updates list and match by ID
		const cypher = `
			UNWIND $updates AS update
			MATCH (m:Memory {id: update.id})
			WHERE m.tt_end = $maxDate
			SET m.decay_score = update.score,
				m.decay_updated_at = $now
		`;

		await this.falkor.query(cypher, {
			updates: updates.map((u) => ({ id: u.id, score: u.score })),
			maxDate: MAX_DATE,
			now,
		});
	}

	/**
	 * Calculate summary statistics for the decay calculation run.
	 *
	 * @param updates - The updates that were applied
	 * @param skipped - Number of memories skipped (no meaningful change)
	 * @param startTime - Start timestamp of the job
	 * @returns Summary statistics
	 */
	private calculateSummary(
		updates: DecayUpdate[],
		skipped: number,
		startTime: number,
	): DecaySummary {
		const durationMs = Date.now() - startTime;
		const memoriesProcessed = updates.length + skipped;

		if (updates.length === 0) {
			return {
				memoriesProcessed,
				memoriesUpdated: 0,
				memoriesSkipped: skipped,
				avgScore: 0,
				minScore: 0,
				maxScore: 0,
				durationMs,
			};
		}

		const scores = updates.map((u) => u.score);
		const sum = scores.reduce((a, b) => a + b, 0);

		return {
			memoriesProcessed,
			memoriesUpdated: updates.length,
			memoriesSkipped: skipped,
			avgScore: sum / scores.length,
			minScore: Math.min(...scores),
			maxScore: Math.max(...scores),
			durationMs,
		};
	}
}

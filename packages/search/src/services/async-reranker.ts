import { randomBytes } from "node:crypto";
import { createLogger } from "@engram/logger";
import type { BatchedReranker, BatchedRerankResult, DocumentCandidate } from "./batched-reranker";

const logger = createLogger({ component: "AsyncReranker" });

/**
 * Options for async reranking operation.
 */
export interface AsyncRerankOptions {
	/** Search query */
	query: string;
	/** Documents to rerank */
	candidates: DocumentCandidate[];
	/** Number of top results to return */
	topK: number;
	/** Callback when reranking completes */
	onComplete: (results: BatchedRerankResult[]) => void;
	/** Optional callback for errors */
	onError?: (error: Error) => void;
	/** Optional callback for progress updates */
	onProgress?: (progress: { processed: number; total: number }) => void;
}

/**
 * Status of an async reranking job.
 */
export type AsyncRerankStatus = "pending" | "running" | "completed" | "cancelled" | "failed";

/**
 * Job metadata for tracking.
 */
interface RerankJob {
	id: string;
	status: AsyncRerankStatus;
	query: string;
	candidateCount: number;
	startTime: number;
	endTime?: number;
	error?: Error;
	cancelFn?: () => void;
}

/**
 * AsyncReranker enables background reranking with immediate RRF fallback.
 *
 * Use case:
 * 1. Return RRF results immediately to user
 * 2. Start reranking in background
 * 3. Push refined results via WebSocket when ready
 *
 * Features:
 * - Non-blocking reranking operations
 * - Job tracking and status monitoring
 * - Cancellable jobs
 * - Progress callbacks
 * - Error handling with fallback
 */
export class AsyncReranker {
	private jobs: Map<string, RerankJob> = new Map();
	private readonly maxConcurrentJobs: number;
	private readonly jobRetentionMs: number;
	private cleanupInterval?: NodeJS.Timeout;

	constructor(
		private reranker: BatchedReranker,
		options?: {
			maxConcurrentJobs?: number;
			jobRetentionMs?: number;
		},
	) {
		this.maxConcurrentJobs = options?.maxConcurrentJobs ?? 10;
		this.jobRetentionMs = options?.jobRetentionMs ?? 5 * 60 * 1000; // 5 minutes

		// Start periodic cleanup of old jobs
		this.startCleanup();
	}

	/**
	 * Start background reranking.
	 * Returns immediately with job ID and cancel function.
	 *
	 * @param options - Reranking options with completion callback
	 * @returns Job ID and cancel function
	 */
	startAsync(options: AsyncRerankOptions): { jobId: string; cancel: () => void } {
		const jobId = this.generateJobId();

		// Check concurrent job limit
		const runningJobs = Array.from(this.jobs.values()).filter(
			(job) => job.status === "running" || job.status === "pending",
		);

		if (runningJobs.length >= this.maxConcurrentJobs) {
			logger.warn({
				msg: "Max concurrent jobs reached, rejecting new job",
				maxConcurrentJobs: this.maxConcurrentJobs,
				currentJobs: runningJobs.length,
			});

			// Immediately call error callback
			if (options.onError) {
				options.onError(new Error("Max concurrent reranking jobs reached"));
			}

			// Return a no-op cancel function
			return {
				jobId,
				cancel: () => {},
			};
		}

		// Create job metadata
		const job: RerankJob = {
			id: jobId,
			status: "pending",
			query: options.query,
			candidateCount: options.candidates.length,
			startTime: Date.now(),
		};

		// Track whether job has been cancelled
		let cancelled = false;

		// Create cancel function
		const cancel = () => {
			cancelled = true;
			job.status = "cancelled";
			job.endTime = Date.now();

			logger.info({
				msg: "Reranking job cancelled",
				jobId,
				query: options.query.substring(0, 50),
			});
		};

		job.cancelFn = cancel;
		this.jobs.set(jobId, job);

		logger.info({
			msg: "Starting async reranking job",
			jobId,
			candidateCount: options.candidates.length,
			topK: options.topK,
			query: options.query.substring(0, 50),
		});

		// Start reranking in background (non-blocking)
		this.executeReranking(job, options, () => cancelled).catch((error) => {
			logger.error({
				msg: "Async reranking failed",
				jobId,
				error: error instanceof Error ? error.message : String(error),
			});

			// Update job status
			job.status = "failed";
			job.endTime = Date.now();
			job.error = error instanceof Error ? error : new Error(String(error));

			// Call error callback if provided
			if (options.onError) {
				options.onError(job.error);
			}
		});

		return { jobId, cancel };
	}

	/**
	 * Check job status.
	 *
	 * @param jobId - Job identifier
	 * @returns Job status or undefined if not found
	 */
	getStatus(jobId: string): AsyncRerankStatus | undefined {
		const job = this.jobs.get(jobId);
		return job?.status;
	}

	/**
	 * Get detailed job information.
	 *
	 * @param jobId - Job identifier
	 * @returns Job metadata or undefined if not found
	 */
	getJob(jobId: string): Readonly<RerankJob> | undefined {
		return this.jobs.get(jobId);
	}

	/**
	 * Get all active jobs.
	 *
	 * @returns Array of active job metadata
	 */
	getActiveJobs(): ReadonlyArray<Readonly<RerankJob>> {
		return Array.from(this.jobs.values()).filter(
			(job) => job.status === "running" || job.status === "pending",
		);
	}

	/**
	 * Execute reranking in background.
	 *
	 * @param job - Job metadata
	 * @param options - Reranking options
	 * @param isCancelled - Function to check if job is cancelled
	 */
	private async executeReranking(
		job: RerankJob,
		options: AsyncRerankOptions,
		isCancelled: () => boolean,
	): Promise<void> {
		// Check if cancelled before starting
		if (isCancelled()) {
			return;
		}

		// Update status to running
		job.status = "running";

		try {
			// Perform reranking
			const results = await this.reranker.rerank(options.query, options.candidates, options.topK);

			// Check if cancelled after reranking
			if (isCancelled()) {
				return;
			}

			// Update job status
			job.status = "completed";
			job.endTime = Date.now();

			const durationMs = job.endTime - job.startTime;

			logger.info({
				msg: "Async reranking completed",
				jobId: job.id,
				durationMs,
				resultCount: results.length,
			});

			// Call completion callback
			options.onComplete(results);
		} catch (error) {
			// Update job status
			job.status = "failed";
			job.endTime = Date.now();
			job.error = error instanceof Error ? error : new Error(String(error));

			logger.error({
				msg: "Async reranking execution failed",
				jobId: job.id,
				error: error instanceof Error ? error.message : String(error),
			});

			throw error;
		}
	}

	/**
	 * Generate unique job ID.
	 */
	private generateJobId(): string {
		return `rerank_${Date.now()}_${randomBytes(8).toString("hex")}`;
	}

	/**
	 * Start periodic cleanup of old jobs.
	 */
	private startCleanup(): void {
		// Clean up every minute
		this.cleanupInterval = setInterval(() => {
			this.cleanupOldJobs();
		}, 60 * 1000);
	}

	/**
	 * Remove old completed/failed/cancelled jobs.
	 */
	private cleanupOldJobs(): void {
		const now = Date.now();
		let removedCount = 0;

		for (const [jobId, job] of this.jobs.entries()) {
			// Only clean up completed, failed, or cancelled jobs
			if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
				const age = now - job.startTime;
				if (age > this.jobRetentionMs) {
					this.jobs.delete(jobId);
					removedCount++;
				}
			}
		}

		if (removedCount > 0) {
			logger.debug({
				msg: "Cleaned up old reranking jobs",
				removedCount,
				remainingJobs: this.jobs.size,
			});
		}
	}

	/**
	 * Stop cleanup interval and clear all jobs.
	 * Should be called when shutting down.
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
		}
		this.jobs.clear();
	}
}

/**
 * Example usage with WebSocket integration:
 *
 * ```typescript
 * // In search route handler:
 * const asyncReranker = new AsyncReranker(reranker);
 *
 * if (params.asyncRerank) {
 *   // Return RRF results immediately
 *   const rrfResults = await performRRFFusion(denseResults, sparseResults);
 *   res.json({
 *     results: rrfResults,
 *     rerankJobId: null, // Will be set after starting job
 *   });
 *
 *   // Start background reranking
 *   const { jobId, cancel } = asyncReranker.startAsync({
 *     query,
 *     candidates: rrfResults,
 *     topK,
 *     onComplete: (reranked) => {
 *       // Push refined results via WebSocket
 *       wsServer.emit(sessionId, 'rerank-complete', {
 *         jobId,
 *         results: reranked,
 *       });
 *     },
 *     onError: (error) => {
 *       wsServer.emit(sessionId, 'rerank-error', {
 *         jobId,
 *         error: error.message,
 *       });
 *     },
 *   });
 *
 *   // Store cancel function if user leaves
 *   sessionCancelFunctions.set(sessionId, cancel);
 * }
 * ```
 */

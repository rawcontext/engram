import { createLogger } from "@engram/logger";
import { pipeline } from "@huggingface/transformers";
import { RERANK_CONFIG } from "../config";
import type { RerankerTier } from "../models/schema";
import { recordRerankMetrics } from "./reranker-metrics";

export interface DocumentCandidate {
	id: string | number;
	content: string;
	/** Original score from retrieval (RRF/dense/sparse) */
	score?: number;
}

export interface BatchedRerankResult {
	id: string | number;
	/** Cross-encoder relevance score (0-1) */
	score: number;
	/** Original position before reranking */
	originalIndex: number;
	/** Original retrieval score */
	originalScore?: number;
}

export interface BatchedRerankerOptions {
	/** Model identifier */
	model?: string;
	/** Maximum documents per batch */
	maxBatchSize?: number;
	/** Maximum concurrent batches */
	maxConcurrency?: number;
	/** Quantization level */
	quantization?: "fp16" | "q8";
	/** Enable query-document pair caching */
	cacheEnabled?: boolean;
	/** Idle timeout in milliseconds before unloading model (default: 5 minutes) */
	idleTimeoutMs?: number;
}

interface ClassifierOutput {
	label: string;
	score: number;
}

type ClassifierFn = (input: { text: string; text_pair: string }) => Promise<ClassifierOutput[]>;

/**
 * BatchedReranker processes documents in parallel batches for efficiency.
 *
 * Key optimizations:
 * - Dynamic batching based on document count
 * - Concurrent batch processing with p-limit pattern
 * - Singleton model instances per tier
 * - Score normalization to 0-1 range
 * - Lazy model loading with idle unload to prevent OOM
 */
export class BatchedReranker {
	private static instances: Map<string, ClassifierFn> = new Map();
	private static loadingPromises: Map<string, Promise<ClassifierFn>> = new Map();
	private static idleTimers: Map<string, NodeJS.Timeout> = new Map();
	private static lastAccessTimes: Map<string, number> = new Map();

	private model: string;
	private maxBatchSize: number;
	private maxConcurrency: number;
	private quantization: "fp16" | "q8";
	private cacheEnabled: boolean;
	private logger = createLogger({ component: "BatchedReranker" });
	private tier?: RerankerTier;
	private idleTimeoutMs: number;

	constructor(options: BatchedRerankerOptions = {}) {
		this.model = options.model ?? RERANK_CONFIG.tiers.fast.model;
		this.maxBatchSize = options.maxBatchSize ?? 16;
		this.maxConcurrency = options.maxConcurrency ?? 4;
		this.quantization = options.quantization ?? "q8";
		this.cacheEnabled = options.cacheEnabled ?? false;
		this.idleTimeoutMs = options.idleTimeoutMs ?? 5 * 60 * 1000; // Default 5 minutes
	}

	/**
	 * Get or create a singleton pipeline instance for the model.
	 * Implements lazy loading - model is only loaded on first use.
	 */
	private async getInstance(): Promise<ClassifierFn> {
		const key = `${this.model}:${this.quantization}`;

		// Update last access time
		BatchedReranker.lastAccessTimes.set(key, Date.now());

		// Reset idle timer on access
		this.resetIdleTimer(key);

		// Return existing instance
		if (BatchedReranker.instances.has(key)) {
			this.logger.debug({
				msg: "Using cached model instance",
				model: this.model,
				quantization: this.quantization,
			});
			const cached = BatchedReranker.instances.get(key);
			if (cached) return cached;
		}

		// Return existing loading promise to avoid duplicate loads
		if (BatchedReranker.loadingPromises.has(key)) {
			this.logger.debug({
				msg: "Waiting for model to load",
				model: this.model,
				quantization: this.quantization,
			});
			const loading = BatchedReranker.loadingPromises.get(key);
			if (loading) return loading;
		}

		// Create new loading promise (lazy loading)
		this.logger.info({
			msg: "Loading model (lazy initialization)",
			model: this.model,
			quantization: this.quantization,
		});

		const loadStartTime = Date.now();

		const loadingPromise = (async () => {
			const pipelineInstance = await pipeline("text-classification", this.model, {
				dtype: this.quantization === "q8" ? "q8" : "fp16",
			});

			// Wrap the pipeline as a classifier function
			const classifier: ClassifierFn = async (input) => {
				const result = await (pipelineInstance as unknown as ClassifierFn)(input);
				return result;
			};

			BatchedReranker.instances.set(key, classifier);
			BatchedReranker.loadingPromises.delete(key);

			const loadTime = Date.now() - loadStartTime;

			this.logger.info({
				msg: "Model loaded successfully",
				model: this.model,
				quantization: this.quantization,
				loadTimeMs: loadTime,
			});

			return classifier;
		})();

		BatchedReranker.loadingPromises.set(key, loadingPromise);
		return loadingPromise;
	}

	/**
	 * Rerank documents by relevance to the query.
	 *
	 * @param query - The search query
	 * @param documents - Candidate documents to rerank
	 * @param topK - Number of top results to return
	 * @returns Reranked results sorted by relevance score
	 */
	async rerank(
		query: string,
		documents: DocumentCandidate[],
		topK: number = 10,
	): Promise<BatchedRerankResult[]> {
		if (documents.length === 0) {
			return [];
		}

		const startTime = Date.now();
		const candidateCount = documents.length;
		const tierLabel = this.tier ?? "unknown";

		this.logger.info({
			msg: "Rerank started",
			tier: tierLabel,
			model: this.model,
			candidateCount,
			topK,
			queryLength: query.length,
		});

		try {
			const classifier = await this.getInstance();

			// Split into batches
			const batches = this.createBatches(documents);

			// Process batches with concurrency limit
			const batchResults = await this.processBatchesConcurrently(classifier, query, batches);

			// Flatten and merge results
			const allResults: BatchedRerankResult[] = [];
			let globalIndex = 0;

			for (const batchResult of batchResults) {
				for (const result of batchResult) {
					allResults.push({
						...result,
						originalIndex: globalIndex++,
					});
				}
			}

			// Sort by score descending and take top K
			allResults.sort((a, b) => b.score - a.score);
			const topResults = allResults.slice(0, topK);

			// Calculate score statistics
			const scores = topResults.map((r) => r.score);
			const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
			const maxScore = Math.max(...scores);
			const minScore = Math.min(...scores);

			// Calculate score improvement if original scores exist
			let scoreImprovement: number | undefined;
			const hasOriginalScores = topResults.every((r) => r.originalScore !== undefined);
			if (hasOriginalScores) {
				const originalAvg =
					topResults.reduce((sum, r) => sum + (r.originalScore ?? 0), 0) / topResults.length;
				scoreImprovement = avgScore - originalAvg;
			}

			const latencyMs = Date.now() - startTime;
			const latencySeconds = latencyMs / 1000;

			this.logger.info({
				msg: "Rerank completed",
				tier: tierLabel,
				model: this.model,
				candidateCount,
				topK,
				latencyMs,
				avgScore: avgScore.toFixed(3),
				maxScore: maxScore.toFixed(3),
				minScore: minScore.toFixed(3),
				scoreImprovement: scoreImprovement?.toFixed(3),
			});

			// Record metrics
			recordRerankMetrics({
				tier: tierLabel,
				model: this.model,
				latencySeconds,
				candidateCount,
				scoreImprovement,
				status: "success",
			});

			return topResults;
		} catch (error) {
			const latencyMs = Date.now() - startTime;
			const latencySeconds = latencyMs / 1000;

			this.logger.error({
				msg: "Rerank failed",
				tier: tierLabel,
				model: this.model,
				candidateCount,
				latencyMs,
				error: error instanceof Error ? error.message : String(error),
			});

			// Record failure metrics
			recordRerankMetrics({
				tier: tierLabel,
				model: this.model,
				latencySeconds,
				candidateCount,
				status: "failure",
			});

			throw error;
		}
	}

	/**
	 * Split documents into batches for parallel processing.
	 */
	private createBatches(documents: DocumentCandidate[]): DocumentCandidate[][] {
		const batches: DocumentCandidate[][] = [];

		for (let i = 0; i < documents.length; i += this.maxBatchSize) {
			batches.push(documents.slice(i, i + this.maxBatchSize));
		}

		return batches;
	}

	/**
	 * Process batches with concurrency limit using Promise pooling.
	 * Uses proper promise tracking with self-removal pattern.
	 */
	private async processBatchesConcurrently(
		classifier: ClassifierFn,
		query: string,
		batches: DocumentCandidate[][],
	): Promise<BatchedRerankResult[][]> {
		const results: BatchedRerankResult[][] = [];
		const executing = new Set<Promise<void>>();

		for (const batch of batches) {
			// Create promise that removes itself from executing set when done
			const promise = this.processBatch(classifier, query, batch)
				.then((result) => {
					results.push(result);
				})
				.finally(() => {
					executing.delete(promise);
				});

			executing.add(promise);

			// If we've hit max concurrency, wait for one to complete
			if (executing.size >= this.maxConcurrency) {
				await Promise.race(executing);
			}
		}

		// Wait for remaining batches
		if (executing.size > 0) {
			await Promise.all(executing);
		}

		return results;
	}

	/**
	 * Process a single batch of documents.
	 */
	private async processBatch(
		classifier: ClassifierFn,
		query: string,
		batch: DocumentCandidate[],
	): Promise<BatchedRerankResult[]> {
		const results: BatchedRerankResult[] = [];

		// Process each document in the batch
		// Note: Some models support batch inference, but text-classification
		// pipeline with pairs may need sequential processing
		for (let i = 0; i < batch.length; i++) {
			const doc = batch[i];

			try {
				const output = await classifier({
					text: query,
					text_pair: doc.content,
				});

				// Extract score from classifier output
				const score = this.extractScore(output);

				results.push({
					id: doc.id,
					score,
					originalIndex: i,
					originalScore: doc.score,
				});
			} catch (error) {
				// On error, assign minimum score to push to bottom
				console.warn(`[BatchedReranker] Failed to score document ${doc.id}:`, error);
				results.push({
					id: doc.id,
					score: 0,
					originalIndex: i,
					originalScore: doc.score,
				});
			}
		}

		return results;
	}

	/**
	 * Extract normalized score from classifier output.
	 * Cross-encoders may output logits or probabilities.
	 */
	private extractScore(output: ClassifierOutput[]): number {
		if (!output || output.length === 0) {
			return 0;
		}

		// BGE and similar rerankers output a single score
		// Some models output [{ label: 'LABEL_0', score: 0.99 }]
		// Others might output probabilities for positive class
		const score = output[0].score;

		// Normalize to 0-1 range if needed
		// Most cross-encoders output sigmoid scores already in 0-1
		return Math.max(0, Math.min(1, score));
	}

	/**
	 * Get the model name for this reranker.
	 */
	getModel(): string {
		return this.model;
	}

	/**
	 * Create a BatchedReranker for a specific tier.
	 */
	static forTier(tier: RerankerTier): BatchedReranker {
		const config = RERANK_CONFIG.tiers[tier];
		const reranker = new BatchedReranker({
			model: config.model,
			maxBatchSize: config.batchSize ?? 16,
			quantization: "q8",
		});
		reranker.tier = tier;
		return reranker;
	}

	/**
	 * Preload a model to avoid cold start latency.
	 */
	async warmup(): Promise<void> {
		await this.getInstance();
	}

	/**
	 * Unload model from memory.
	 */
	static unloadModel(model: string, quantization: "fp16" | "q8" = "q8"): void {
		const key = `${model}:${quantization}`;
		BatchedReranker.instances.delete(key);
	}

	/**
	 * Unload all models from memory.
	 */
	static unloadAll(): void {
		// Clear all idle timers
		for (const timer of BatchedReranker.idleTimers.values()) {
			clearTimeout(timer);
		}
		BatchedReranker.idleTimers.clear();
		BatchedReranker.lastAccessTimes.clear();
		BatchedReranker.instances.clear();
	}

	/**
	 * Reset idle timer for a model to prevent premature unloading.
	 * Called on each access to the model.
	 */
	private resetIdleTimer(key: string): void {
		// Clear existing timer
		const existingTimer = BatchedReranker.idleTimers.get(key);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Set new timer to unload after idle timeout
		const timer = setTimeout(() => {
			this.unloadIfIdle(key);
		}, this.idleTimeoutMs);

		BatchedReranker.idleTimers.set(key, timer);
	}

	/**
	 * Unload a model if it has been idle for the configured timeout.
	 * Logs model lifecycle events.
	 */
	private unloadIfIdle(key: string): void {
		const lastAccess = BatchedReranker.lastAccessTimes.get(key);
		const now = Date.now();

		if (!lastAccess) {
			// No access recorded, safe to unload
			this.performUnload(key);
			return;
		}

		const idleTime = now - lastAccess;

		if (idleTime >= this.idleTimeoutMs) {
			// Model has been idle long enough, unload it
			this.performUnload(key);
		} else {
			// Model was accessed recently, reschedule unload
			const remainingTime = this.idleTimeoutMs - idleTime;
			this.logger.debug({
				msg: "Model still in use, rescheduling unload",
				model: this.model,
				idleTimeMs: idleTime,
				remainingTimeMs: remainingTime,
			});

			const timer = setTimeout(() => {
				this.unloadIfIdle(key);
			}, remainingTime);

			BatchedReranker.idleTimers.set(key, timer);
		}
	}

	/**
	 * Perform the actual model unload and cleanup.
	 */
	private performUnload(key: string): void {
		const wasLoaded = BatchedReranker.instances.has(key);

		if (wasLoaded) {
			BatchedReranker.instances.delete(key);
			BatchedReranker.lastAccessTimes.delete(key);
			BatchedReranker.idleTimers.delete(key);

			this.logger.info({
				msg: "Model unloaded due to idle timeout",
				model: this.model,
				quantization: this.quantization,
				idleTimeoutMs: this.idleTimeoutMs,
			});
		}
	}

	/**
	 * Get model load status for monitoring.
	 */
	static getLoadedModels(): Array<{
		key: string;
		lastAccessTime: number | undefined;
		idleTimeMs: number;
	}> {
		const now = Date.now();
		const loaded: Array<{
			key: string;
			lastAccessTime: number | undefined;
			idleTimeMs: number;
		}> = [];

		for (const key of BatchedReranker.instances.keys()) {
			const lastAccess = BatchedReranker.lastAccessTimes.get(key);
			loaded.push({
				key,
				lastAccessTime: lastAccess,
				idleTimeMs: lastAccess ? now - lastAccess : 0,
			});
		}

		return loaded;
	}
}

/**
 * Evaluation cache for tuner optimization
 *
 * Caches benchmark evaluation results by parameter hash to avoid
 * re-computing results for identical configurations.
 *
 * Based on research showing 30-50% compute savings in typical optimization runs.
 *
 * @module @engram/tuner/executor
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TrialMetrics } from "./trial-runner.js";

/**
 * A cached evaluation entry
 */
export interface CacheEntry {
	/** Original parameters that were evaluated */
	params: Record<string, unknown>;
	/** Resulting metrics */
	metrics: TrialMetrics;
	/** When the entry was created */
	timestamp: string;
	/** Version of cache format */
	version: number;
}

/**
 * Cache statistics
 */
export interface CacheStats {
	/** Total number of cached entries */
	entries: number;
	/** Number of cache hits this session */
	hits: number;
	/** Number of cache misses this session */
	misses: number;
	/** Hit rate (hits / (hits + misses)) */
	hitRate: number;
}

/**
 * Current cache format version.
 * Increment this when the cache format changes to invalidate old entries.
 */
const CACHE_VERSION = 1;

/**
 * Evaluation cache for tuner optimization
 *
 * Uses MD5 hashes of parameter values as cache keys.
 * Cache entries are stored as JSON files in the specified directory.
 *
 * @example
 * ```ts
 * const cache = new EvaluationCache(".tuner-cache");
 *
 * // Check cache before running evaluation
 * const cached = await cache.get(params);
 * if (cached) {
 *   console.log("Cache hit!");
 *   return cached;
 * }
 *
 * // Run evaluation and cache result
 * const metrics = await runEvaluation(params);
 * await cache.set(params, metrics);
 * ```
 */
export class EvaluationCache {
	private cacheDir: string;
	private hits = 0;
	private misses = 0;

	/**
	 * Create a new evaluation cache
	 *
	 * @param cacheDir - Directory to store cache files (defaults to ".tuner-cache")
	 */
	constructor(cacheDir = ".tuner-cache") {
		this.cacheDir = cacheDir;
	}

	/**
	 * Generate a cache key from parameters
	 *
	 * Uses MD5 hash of sorted JSON representation for deterministic keys.
	 */
	private getKey(params: Record<string, unknown>): string {
		// Sort keys for deterministic hashing
		const sortedKeys = Object.keys(params).sort();
		const sorted: Record<string, unknown> = {};
		for (const key of sortedKeys) {
			sorted[key] = params[key];
		}

		const json = JSON.stringify(sorted);
		return createHash("md5").update(json).digest("hex");
	}

	/**
	 * Get the file path for a cache key
	 */
	private getPath(key: string): string {
		return join(this.cacheDir, `${key}.json`);
	}

	/**
	 * Get cached metrics for parameters, if available
	 *
	 * @param params - Parameters to look up
	 * @returns Cached metrics, or null if not found
	 */
	async get(params: Record<string, unknown>): Promise<TrialMetrics | null> {
		const key = this.getKey(params);
		const path = this.getPath(key);

		try {
			const data = await readFile(path, "utf-8");
			const entry: CacheEntry = JSON.parse(data);

			// Validate cache version
			if (entry.version !== CACHE_VERSION) {
				this.misses++;
				return null;
			}

			this.hits++;
			return entry.metrics;
		} catch {
			this.misses++;
			return null;
		}
	}

	/**
	 * Cache metrics for parameters
	 *
	 * @param params - Parameters that were evaluated
	 * @param metrics - Resulting metrics to cache
	 */
	async set(params: Record<string, unknown>, metrics: TrialMetrics): Promise<void> {
		// Ensure cache directory exists
		await mkdir(this.cacheDir, { recursive: true });

		const key = this.getKey(params);
		const entry: CacheEntry = {
			params,
			metrics,
			timestamp: new Date().toISOString(),
			version: CACHE_VERSION,
		};

		const path = this.getPath(key);
		await writeFile(path, JSON.stringify(entry, null, 2));
	}

	/**
	 * Check if parameters are cached without loading the full entry
	 */
	async has(params: Record<string, unknown>): Promise<boolean> {
		const key = this.getKey(params);
		const path = this.getPath(key);

		try {
			const data = await readFile(path, "utf-8");
			const entry: CacheEntry = JSON.parse(data);
			return entry.version === CACHE_VERSION;
		} catch {
			return false;
		}
	}

	/**
	 * Get cache statistics
	 */
	async getStats(): Promise<CacheStats> {
		let entries = 0;

		try {
			const files = await readdir(this.cacheDir);
			entries = files.filter((f) => f.endsWith(".json")).length;
		} catch {
			// Cache dir doesn't exist yet
		}

		const total = this.hits + this.misses;
		return {
			entries,
			hits: this.hits,
			misses: this.misses,
			hitRate: total > 0 ? this.hits / total : 0,
		};
	}

	/**
	 * Reset session statistics
	 */
	resetStats(): void {
		this.hits = 0;
		this.misses = 0;
	}

	/**
	 * Clear all cached entries
	 */
	async clear(): Promise<void> {
		try {
			const files = await readdir(this.cacheDir);
			const { unlink } = await import("node:fs/promises");

			await Promise.all(
				files.filter((f) => f.endsWith(".json")).map((f) => unlink(join(this.cacheDir, f))),
			);
		} catch {
			// Cache dir doesn't exist or is empty
		}

		this.resetStats();
	}
}

import { createHash } from "node:crypto";
import { createLogger } from "@engram/logger";
import { Counter, Gauge } from "prom-client";
import type { RerankerTier } from "../models/schema";

/**
 * A/B testing configuration for gradual reranker rollout.
 *
 * Features:
 * - Percentage-based rollout (0-100%)
 * - Consistent session assignment via hashing
 * - Tier override for forced variant selection
 * - Metrics tracking per variant
 */
export interface ABTestConfig {
	/** Feature flag: percentage of users with reranking enabled (0-100) */
	rerankEnabledPct: number;
	/** Tier override: force specific tier for testing */
	rerankTierOverride?: RerankerTier;
	/** Seed for consistent hashing */
	seed?: string;
}

/**
 * Variant assignment result
 */
export interface VariantAssignment {
	/** Variant ID (e.g., "control", "treatment") */
	variant: "control" | "treatment";
	/** Whether reranking is enabled for this variant */
	rerankEnabled: boolean;
	/** Reranker tier to use (if enabled) */
	rerankTier?: RerankerTier;
	/** Hash bucket (0-99) used for assignment */
	bucket: number;
}

/**
 * Prometheus metrics for A/B testing
 */
const variantAssignmentCounter = new Counter({
	name: "engram_ab_variant_assignments_total",
	help: "Total variant assignments by session",
	labelNames: ["variant", "rerank_enabled"],
});

const variantRequestCounter = new Counter({
	name: "engram_ab_variant_requests_total",
	help: "Total search requests by variant",
	labelNames: ["variant", "tier"],
});

const rolloutPercentageGauge = new Gauge({
	name: "engram_ab_rollout_percentage",
	help: "Current rollout percentage for reranking",
});

/**
 * ABTestingService manages feature flags and variant assignment for reranker rollout.
 *
 * Uses deterministic hashing to ensure:
 * - Same session always gets same variant
 * - Uniform distribution across sessions
 * - Easy percentage-based rollout control
 *
 * Example usage:
 * ```ts
 * const abTest = new ABTestingService({ rerankEnabledPct: 50 });
 * const assignment = abTest.assign(sessionId);
 * if (assignment.rerankEnabled) {
 *   // Use reranking
 * }
 * ```
 */
export class ABTestingService {
	private config: Required<Omit<ABTestConfig, "rerankTierOverride">> & {
		rerankTierOverride?: RerankerTier;
	};
	private logger = createLogger({ component: "ABTestingService" });

	constructor(config: ABTestConfig = ABTestingService.defaultConfig()) {
		this.config = {
			rerankEnabledPct: Math.max(0, Math.min(100, config.rerankEnabledPct)),
			rerankTierOverride: config.rerankTierOverride ?? undefined,
			seed: config.seed ?? "engram-rerank-rollout-v1",
		};

		// Update rollout gauge
		rolloutPercentageGauge.set(this.config.rerankEnabledPct);

		this.logger.info({
			msg: "A/B testing service initialized",
			rerankEnabledPct: this.config.rerankEnabledPct,
			rerankTierOverride: this.config.rerankTierOverride,
		});
	}

	/**
	 * Default configuration: 100% rollout (reranking enabled for all)
	 */
	static defaultConfig(): ABTestConfig {
		return {
			rerankEnabledPct: 100,
			seed: "engram-rerank-rollout-v1",
		};
	}

	/**
	 * Assign a variant to a session.
	 *
	 * Uses deterministic hashing to ensure consistent assignment.
	 * Hash is computed from session ID + seed, then mapped to 0-99 bucket.
	 *
	 * @param sessionId - Unique session identifier
	 * @returns Variant assignment with rerank configuration
	 */
	assign(sessionId: string): VariantAssignment {
		// Compute deterministic hash bucket (0-99)
		const bucket = this.computeBucket(sessionId);

		// Check if session falls into treatment group
		const rerankEnabled = bucket < this.config.rerankEnabledPct;
		const variant = rerankEnabled ? "treatment" : "control";

		// Apply tier override if configured
		const assignment: VariantAssignment = {
			variant,
			rerankEnabled,
			...(this.config.rerankTierOverride && { rerankTier: this.config.rerankTierOverride }),
			bucket,
		};

		// Record assignment
		variantAssignmentCounter.inc({
			variant,
			rerank_enabled: String(rerankEnabled),
		});

		this.logger.debug({
			msg: "Variant assigned",
			sessionId,
			variant,
			rerankEnabled,
			rerankTier: assignment.rerankTier,
			bucket,
		});

		return assignment;
	}

	/**
	 * Record a search request for metrics tracking.
	 *
	 * @param sessionId - Session identifier
	 * @param tier - Reranker tier used (if any)
	 */
	recordRequest(sessionId: string, tier?: RerankerTier): void {
		const assignment = this.assign(sessionId);
		variantRequestCounter.inc({
			variant: assignment.variant,
			tier: tier ?? "none",
		});
	}

	/**
	 * Update rollout percentage (hot reload).
	 *
	 * @param percentage - New percentage (0-100)
	 */
	setRolloutPercentage(percentage: number): void {
		const newPct = Math.max(0, Math.min(100, percentage));
		const oldPct = this.config.rerankEnabledPct;

		this.config.rerankEnabledPct = newPct;
		rolloutPercentageGauge.set(newPct);

		this.logger.info({
			msg: "Rollout percentage updated",
			oldPct,
			newPct,
		});
	}

	/**
	 * Update tier override (hot reload).
	 *
	 * @param tier - Tier to force, or undefined to use routing
	 */
	setTierOverride(tier?: RerankerTier): void {
		const oldTier = this.config.rerankTierOverride;
		this.config.rerankTierOverride = tier;

		this.logger.info({
			msg: "Tier override updated",
			oldTier,
			newTier: tier,
		});
	}

	/**
	 * Get current configuration.
	 */
	getConfig(): Readonly<
		Required<Omit<ABTestConfig, "rerankTierOverride">> & { rerankTierOverride?: RerankerTier }
	> {
		return { ...this.config };
	}

	/**
	 * Compute deterministic hash bucket (0-99) for a session.
	 *
	 * Uses MD5 hash of session ID + seed, then maps to 0-99 range.
	 */
	private computeBucket(sessionId: string): number {
		const hash = createHash("md5").update(`${this.config.seed}:${sessionId}`).digest();

		// Use first 4 bytes as uint32, then map to 0-99
		const value = hash.readUInt32BE(0);
		return value % 100;
	}

	/**
	 * Check if a session is in the treatment group (reranking enabled).
	 *
	 * @param sessionId - Session identifier
	 * @returns True if reranking should be enabled
	 */
	isInTreatment(sessionId: string): boolean {
		return this.assign(sessionId).rerankEnabled;
	}

	/**
	 * Check if a session is in the control group (reranking disabled).
	 *
	 * @param sessionId - Session identifier
	 * @returns True if reranking should be disabled
	 */
	isInControl(sessionId: string): boolean {
		return !this.assign(sessionId).rerankEnabled;
	}

	/**
	 * Get bucket distribution for analysis (debugging utility).
	 *
	 * @param sessionIds - List of session IDs to analyze
	 * @returns Distribution of buckets
	 */
	analyzeBucketDistribution(sessionIds: string[]): {
		treatment: number;
		control: number;
		bucketCounts: Record<number, number>;
	} {
		const bucketCounts: Record<number, number> = {};
		let treatment = 0;
		let control = 0;

		for (const sessionId of sessionIds) {
			const assignment = this.assign(sessionId);
			bucketCounts[assignment.bucket] = (bucketCounts[assignment.bucket] ?? 0) + 1;

			if (assignment.rerankEnabled) {
				treatment++;
			} else {
				control++;
			}
		}

		return { treatment, control, bucketCounts };
	}
}

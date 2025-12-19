import { createLogger } from "@engram/logger";
import { Counter, Gauge } from "prom-client";

/**
 * Rate limiter configuration for LLM reranker tier.
 *
 * Implements sliding window rate limiting to prevent excessive LLM API costs.
 * Default: 100 requests per hour per user.
 */
export interface RateLimiterConfig {
	/** Maximum requests per window */
	maxRequests: number;
	/** Window duration in milliseconds */
	windowMs: number;
	/** Enable cost attribution tracking */
	trackCosts?: boolean;
	/** Cost per request (in cents) */
	costPerRequest?: number;
	/** Budget limit in cents */
	budgetLimit?: number;
}

interface RequestRecord {
	timestamp: number;
	cost?: number;
}

interface UserLimitState {
	requests: RequestRecord[];
	totalCost: number;
	budgetExceeded: boolean;
}

/**
 * Prometheus metrics for rate limiting
 */
const rateLimitHitsCounter = new Counter({
	name: "engram_rate_limit_hits_total",
	help: "Total rate limit hits by user",
	labelNames: ["user_id", "tier"],
});

const rateLimitRemainingGauge = new Gauge({
	name: "engram_rate_limit_remaining",
	help: "Remaining requests in current window",
	labelNames: ["user_id", "tier"],
});

const costAttributionCounter = new Counter({
	name: "engram_rerank_cost_total_cents",
	help: "Total reranking cost in cents",
	labelNames: ["user_id", "tier"],
});

const budgetExceededCounter = new Counter({
	name: "engram_budget_exceeded_total",
	help: "Total budget exceeded events",
	labelNames: ["user_id", "tier"],
});

/**
 * RateLimiter implements sliding window rate limiting for the LLM reranker tier.
 *
 * Features:
 * - Sliding window algorithm for accurate rate limiting
 * - Per-user/session tracking
 * - Cost attribution and budget alerting
 * - Prometheus metrics for monitoring
 * - Automatic cleanup of expired records
 */
export class RateLimiter {
	private limits: Map<string, UserLimitState> = new Map();
	private logger = createLogger({ component: "RateLimiter" });
	private config: Required<RateLimiterConfig>;
	private cleanupInterval: NodeJS.Timeout | null = null;

	constructor(config: RateLimiterConfig = RateLimiter.defaultConfig()) {
		this.config = {
			maxRequests: config.maxRequests,
			windowMs: config.windowMs,
			trackCosts: config.trackCosts ?? true,
			costPerRequest: config.costPerRequest ?? 5, // Default 5 cents per LLM rerank
			budgetLimit: config.budgetLimit ?? 1000, // Default $10 budget
		};

		// Start cleanup interval to remove expired records
		this.startCleanup();
	}

	/**
	 * Default configuration: 100 requests per hour
	 */
	static defaultConfig(): RateLimiterConfig {
		return {
			maxRequests: 100,
			windowMs: 60 * 60 * 1000, // 1 hour
			trackCosts: true,
			costPerRequest: 5, // 5 cents
			budgetLimit: 1000, // $10
		};
	}

	/**
	 * Check if a request is allowed for the given user.
	 *
	 * @param userId - User or session identifier
	 * @param tier - Reranker tier (for metrics)
	 * @returns Object indicating if request is allowed and remaining quota
	 */
	checkLimit(
		userId: string,
		tier: string = "llm",
	): { allowed: boolean; remaining: number; resetAt: Date; reason?: string } {
		const now = Date.now();
		const state = this.getUserState(userId);

		// Remove expired requests from sliding window
		this.pruneExpiredRequests(state, now);

		// Check budget first if cost tracking is enabled
		if (this.config.trackCosts && state.budgetExceeded) {
			this.logger.warn({
				msg: "Budget exceeded for user",
				userId,
				totalCost: state.totalCost,
				budgetLimit: this.config.budgetLimit,
			});

			budgetExceededCounter.inc({ user_id: userId, tier });

			return {
				allowed: false,
				remaining: 0,
				resetAt: this.getResetTime(state, now),
				reason: `Budget limit exceeded: $${(state.totalCost / 100).toFixed(2)} / $${(this.config.budgetLimit / 100).toFixed(2)}`,
			};
		}

		// Check rate limit
		const requestCount = state.requests.length;
		const remaining = Math.max(0, this.config.maxRequests - requestCount);

		if (requestCount >= this.config.maxRequests) {
			this.logger.warn({
				msg: "Rate limit exceeded",
				userId,
				tier,
				requestCount,
				maxRequests: this.config.maxRequests,
				windowMs: this.config.windowMs,
			});

			rateLimitHitsCounter.inc({ user_id: userId, tier });
			rateLimitRemainingGauge.set({ user_id: userId, tier }, 0);

			return {
				allowed: false,
				remaining: 0,
				resetAt: this.getResetTime(state, now),
				reason: `Rate limit exceeded: ${requestCount}/${this.config.maxRequests} requests in ${this.config.windowMs / 1000}s window`,
			};
		}

		// Update gauge
		rateLimitRemainingGauge.set({ user_id: userId, tier }, remaining);

		return {
			allowed: true,
			remaining,
			resetAt: this.getResetTime(state, now),
		};
	}

	/**
	 * Record a request for the given user.
	 *
	 * @param userId - User or session identifier
	 * @param tier - Reranker tier (for metrics)
	 * @param cost - Optional custom cost (overrides default)
	 */
	recordRequest(userId: string, tier: string = "llm", cost?: number): void {
		const now = Date.now();
		const state = this.getUserState(userId);
		const requestCost = cost ?? this.config.costPerRequest;

		// Add new request record
		state.requests.push({
			timestamp: now,
			cost: this.config.trackCosts ? requestCost : undefined,
		});

		// Update total cost
		if (this.config.trackCosts && requestCost) {
			state.totalCost += requestCost;
			costAttributionCounter.inc({ user_id: userId, tier }, requestCost);

			// Check if budget exceeded
			if (state.totalCost >= this.config.budgetLimit && !state.budgetExceeded) {
				state.budgetExceeded = true;

				this.logger.error({
					msg: "User budget exceeded",
					userId,
					totalCost: state.totalCost,
					budgetLimit: this.config.budgetLimit,
					requestCount: state.requests.length,
				});

				budgetExceededCounter.inc({ user_id: userId, tier });
			}
		}

		this.logger.debug({
			msg: "Request recorded",
			userId,
			tier,
			cost: requestCost,
			totalCost: state.totalCost,
			requestCount: state.requests.length,
		});
	}

	/**
	 * Get current usage statistics for a user.
	 */
	getUsage(userId: string): {
		requestCount: number;
		totalCost: number;
		budgetExceeded: boolean;
		oldestRequest: Date | null;
	} {
		const state = this.getUserState(userId);
		this.pruneExpiredRequests(state, Date.now());

		return {
			requestCount: state.requests.length,
			totalCost: state.totalCost,
			budgetExceeded: state.budgetExceeded,
			oldestRequest: state.requests[0]?.timestamp ? new Date(state.requests[0].timestamp) : null,
		};
	}

	/**
	 * Reset limits for a user (admin function).
	 */
	resetUser(userId: string): void {
		this.limits.delete(userId);
		this.logger.info({
			msg: "User limits reset",
			userId,
		});
	}

	/**
	 * Reset all limits (admin function).
	 */
	resetAll(): void {
		this.limits.clear();
		this.logger.info({
			msg: "All limits reset",
		});
	}

	/**
	 * Get or create user limit state.
	 */
	private getUserState(userId: string): UserLimitState {
		if (!this.limits.has(userId)) {
			this.limits.set(userId, {
				requests: [],
				totalCost: 0,
				budgetExceeded: false,
			});
		}
		const state = this.limits.get(userId);
		if (!state) throw new Error("Failed to create user limit state");
		return state;
	}

	/**
	 * Remove requests outside the sliding window.
	 * Also subtracts the cost of expired requests from totalCost.
	 */
	private pruneExpiredRequests(state: UserLimitState, now: number): void {
		const cutoff = now - this.config.windowMs;
		const expiredRequests = state.requests.filter((req) => req.timestamp <= cutoff);
		const activeRequests = state.requests.filter((req) => req.timestamp > cutoff);

		// Subtract cost of expired requests from totalCost
		if (this.config.trackCosts && expiredRequests.length > 0) {
			const expiredCost = expiredRequests.reduce((sum, req) => sum + (req.cost || 0), 0);
			state.totalCost = Math.max(0, state.totalCost - expiredCost);

			// Reset budget exceeded flag if cost drops below limit
			if (state.budgetExceeded && state.totalCost < this.config.budgetLimit) {
				state.budgetExceeded = false;
				this.logger.info({
					msg: "User budget reset after cost expiration",
					userId: "unknown", // We don't have userId here, but log the reset
					newTotalCost: state.totalCost,
					budgetLimit: this.config.budgetLimit,
				});
			}
		}

		state.requests = activeRequests;
	}

	/**
	 * Calculate when the rate limit will reset for a user.
	 */
	private getResetTime(state: UserLimitState, now: number): Date {
		if (state.requests.length === 0) {
			return new Date(now + this.config.windowMs);
		}
		// Reset time is when the oldest request expires
		const oldestTimestamp = state.requests[0].timestamp;
		return new Date(oldestTimestamp + this.config.windowMs);
	}

	/**
	 * Start periodic cleanup of expired records.
	 */
	private startCleanup(): void {
		// Run cleanup every 5 minutes
		this.cleanupInterval = setInterval(
			() => {
				const now = Date.now();
				let cleanedUsers = 0;

				for (const [userId, state] of this.limits.entries()) {
					this.pruneExpiredRequests(state, now);

					// Remove user entry if no active requests
					if (state.requests.length === 0 && !state.budgetExceeded) {
						this.limits.delete(userId);
						cleanedUsers++;
					}
				}

				if (cleanedUsers > 0) {
					this.logger.debug({
						msg: "Rate limiter cleanup completed",
						cleanedUsers,
						remainingUsers: this.limits.size,
					});
				}
			},
			5 * 60 * 1000,
		); // 5 minutes
	}

	/**
	 * Stop cleanup interval (for testing/shutdown).
	 */
	destroy(): void {
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
	}
}

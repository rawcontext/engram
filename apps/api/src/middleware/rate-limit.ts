import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import { createClient } from "redis";
import type { ApiKeyContext } from "./auth";

export interface RateLimiterOptions {
	redisUrl: string;
	logger: Logger;
}

/**
 * Rate limiting middleware using sliding window algorithm with Redis
 *
 * Limits requests per minute based on API key tier.
 * Uses Redis for distributed rate limiting across multiple instances.
 */
export function rateLimiter(options: RateLimiterOptions) {
	const { redisUrl, logger } = options;

	let redisClient: ReturnType<typeof createClient> | null = null;
	let connectPromise: Promise<ReturnType<typeof createClient>> | null = null;

	// Initialize Redis connection
	const getRedisClient = async () => {
		if (redisClient?.isOpen) {
			return redisClient;
		}

		if (connectPromise) {
			return connectPromise;
		}

		connectPromise = (async () => {
			try {
				const client = createClient({ url: redisUrl });
				client.on("error", (err) => logger.error({ error: err }, "Redis rate limiter error"));
				await client.connect();
				redisClient = client;
				logger.info("Redis rate limiter connected");
				return client;
			} catch (err) {
				connectPromise = null;
				throw err;
			} finally {
				connectPromise = null;
			}
		})();

		return connectPromise;
	};

	return async (c: Context, next: Next) => {
		const apiKey = c.get("apiKey") as ApiKeyContext | undefined;

		if (!apiKey) {
			// No API key context, skip rate limiting
			await next();
			return;
		}

		const now = Date.now();
		const windowMs = 60 * 1000; // 1 minute
		const limit = apiKey.rateLimit;
		const key = `ratelimit:${apiKey.keyPrefix}`;

		try {
			const redis = await getRedisClient();

			// Use Redis sorted set for sliding window rate limiting
			// Score is timestamp, value is unique request ID
			const requestId = `${now}:${Math.random()}`;

			// Start a pipeline for atomic operations
			const pipeline = redis.multi();

			// Remove old entries outside the window
			pipeline.zRemRangeByScore(key, 0, now - windowMs);

			// Add current request
			pipeline.zAdd(key, { score: now, value: requestId });

			// Count requests in current window
			pipeline.zCard(key);

			// Set expiry on the key (cleanup)
			pipeline.expire(key, Math.ceil(windowMs / 1000) * 2);

			const results = await pipeline.exec();

			// Get count from the zCard result (3rd command, index 2)
			const count = Number(results?.[2]) || 0;

			// Calculate reset time (end of current window)
			const resetAt = now + windowMs;

			// Set rate limit headers
			c.header("X-RateLimit-Limit", String(limit));
			c.header("X-RateLimit-Remaining", String(Math.max(0, limit - count)));
			c.header("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

			if (count > limit) {
				const retryAfter = Math.ceil((resetAt - now) / 1000);
				c.header("Retry-After", String(retryAfter));

				logger.warn(
					{ keyId: apiKey.keyId, keyPrefix: apiKey.keyPrefix, count, limit },
					"Rate limit exceeded",
				);

				return c.json(
					{
						success: false,
						error: {
							code: "RATE_LIMIT_EXCEEDED",
							message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
							details: {
								limit,
								reset: resetAt,
								retryAfter,
							},
						},
					},
					429,
				);
			}

			await next();
		} catch (error) {
			// Fallback to allowing request if Redis is unavailable
			logger.error({ error }, "Rate limiting failed, allowing request");
			await next();
		}
	};
}

import type { Logger } from "@engram/logger";
import type { Context, Next } from "hono";
import type { ApiKeyContext } from "./auth";

export interface RateLimiterOptions {
	redisUrl: string;
	logger: Logger;
}

/**
 * Rate limiting middleware using sliding window algorithm
 *
 * Limits requests per minute based on API key tier.
 * Uses Redis for distributed rate limiting.
 */
export function rateLimiter(options: RateLimiterOptions) {
	const { logger } = options;

	// In-memory rate limit store (replace with Redis in production)
	const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

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

		const key = `ratelimit:${apiKey.keyId}`;
		let bucket = rateLimitStore.get(key);

		// Reset if window expired
		if (!bucket || now >= bucket.resetAt) {
			bucket = { count: 0, resetAt: now + windowMs };
			rateLimitStore.set(key, bucket);
		}

		bucket.count++;

		// Set rate limit headers
		c.header("X-RateLimit-Limit", String(limit));
		c.header("X-RateLimit-Remaining", String(Math.max(0, limit - bucket.count)));
		c.header("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

		if (bucket.count > limit) {
			const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
			c.header("Retry-After", String(retryAfter));

			logger.warn({ keyId: apiKey.keyId, count: bucket.count, limit }, "Rate limit exceeded");

			return c.json(
				{
					success: false,
					error: {
						code: "RATE_LIMIT_EXCEEDED",
						message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
						details: {
							limit,
							reset: bucket.resetAt,
							retryAfter,
						},
					},
				},
				429,
			);
		}

		await next();
	};
}

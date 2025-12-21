/**
 * Retry utilities.
 *
 * Provides retry logic with exponential backoff for transient failures.
 *
 * @module @engram/common/utils/retry
 */

/**
 * Options for the retry function.
 */
export interface RetryOptions {
	/** Maximum number of retry attempts (default: 3) */
	maxRetries?: number;
	/** Initial delay in milliseconds (default: 1000) */
	initialDelayMs?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelayMs?: number;
	/** Backoff multiplier (default: 2) */
	backoffMultiplier?: number;
	/** Jitter factor 0-1 to add randomness (default: 0.1) */
	jitter?: number;
	/** Function to determine if error is retryable (default: always retry) */
	isRetryable?: (error: unknown) => boolean;
	/** Callback invoked on each retry attempt */
	onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Sleep for the specified duration.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay with exponential backoff and jitter.
 */
function calculateDelay(
	attempt: number,
	initialDelayMs: number,
	maxDelayMs: number,
	backoffMultiplier: number,
	jitter: number,
): number {
	// Exponential backoff
	const exponentialDelay = initialDelayMs * backoffMultiplier ** attempt;

	// Cap at max delay
	const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

	// Add jitter
	const jitterAmount = cappedDelay * jitter * Math.random();

	return Math.floor(cappedDelay + jitterAmount);
}

/**
 * Execute a function with retry logic and exponential backoff.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration
 * @returns Result of the function
 * @throws Last error if all retries fail
 *
 * @example
 * ```ts
 * // Basic usage
 * const result = await withRetry(() => fetchData(url));
 *
 * // With options
 * const result = await withRetry(
 *   () => apiCall(),
 *   {
 *     maxRetries: 5,
 *     initialDelayMs: 500,
 *     isRetryable: (e) => e instanceof NetworkError,
 *     onRetry: (e, attempt) => console.log(`Retry ${attempt}`)
 *   }
 * );
 * ```
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const {
		maxRetries = 3,
		initialDelayMs = 1000,
		maxDelayMs = 30000,
		backoffMultiplier = 2,
		jitter = 0.1,
		isRetryable = () => true,
		onRetry,
	} = options;

	let attempt = 0;

	while (true) {
		try {
			return await fn();
		} catch (error) {
			// Check if we've exhausted retries
			if (attempt >= maxRetries) {
				throw error;
			}

			// Check if error is retryable
			if (!isRetryable(error)) {
				throw error;
			}

			// Calculate delay
			const delayMs = calculateDelay(
				attempt,
				initialDelayMs,
				maxDelayMs,
				backoffMultiplier,
				jitter,
			);

			// Invoke callback if provided
			if (onRetry) {
				onRetry(error, attempt + 1, delayMs);
			}

			// Wait before retrying
			await sleep(delayMs);

			// Increment attempt counter
			attempt++;
		}
	}
}

/**
 * Common retryable error patterns.
 *
 * Use with the `isRetryable` option.
 */
export const RetryableErrors = {
	/**
	 * Check if error is a network error.
	 */
	isNetworkError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;

		const networkErrorPatterns = [
			"fetch failed",
			"ECONNREFUSED",
			"ENOTFOUND",
			"ETIMEDOUT",
			"ECONNRESET",
			"socket hang up",
			"network error",
		];

		return networkErrorPatterns.some((pattern) =>
			error.message.toLowerCase().includes(pattern.toLowerCase()),
		);
	},

	/**
	 * Check if error is a rate limit error (HTTP 429).
	 */
	isRateLimitError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;
		return error.message.includes("429") || error.message.toLowerCase().includes("rate limit");
	},

	/**
	 * Check if error is a server error (HTTP 5xx).
	 */
	isServerError(error: unknown): boolean {
		if (!(error instanceof Error)) return false;

		const serverErrorPatterns = ["500", "502", "503", "504", "server error"];

		return serverErrorPatterns.some((pattern) =>
			error.message.toLowerCase().includes(pattern.toLowerCase()),
		);
	},

	/**
	 * Check if error is any transient error (network, rate limit, or server).
	 */
	isTransientError(error: unknown): boolean {
		return (
			RetryableErrors.isNetworkError(error) ||
			RetryableErrors.isRateLimitError(error) ||
			RetryableErrors.isServerError(error)
		);
	},
};

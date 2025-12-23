/**
 * Tests for @engram/common/utils/retry
 *
 * These tests use real timers with very short delays to avoid timer mocking.
 */

import { describe, expect, it, mock } from "bun:test";
import { RetryableErrors, withRetry } from "./retry";

describe("withRetry", () => {
	it("should return result on success", async () => {
		// Arrange
		const fn = mock().mockResolvedValue("success");

		// Act
		const result = await withRetry(fn, { initialDelayMs: 1, jitter: 0 });

		// Assert
		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("should retry on failure and eventually succeed", async () => {
		// Arrange
		const fn = mock()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		// Act
		const result = await withRetry(fn, { initialDelayMs: 1, jitter: 0 });

		// Assert
		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("should throw error after max retries", async () => {
		// Arrange
		const fn = mock().mockRejectedValue(new Error("persistent failure"));

		// Act & Assert
		await expect(withRetry(fn, { maxRetries: 3, initialDelayMs: 1, jitter: 0 })).rejects.toThrow(
			"persistent failure",
		);
		expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
	});

	it("should use exponential backoff", async () => {
		// Arrange
		const fn = mock()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		const delays: number[] = [];
		const onRetry = mock((_err: unknown, _attempt: number, delayMs: number) =>
			delays.push(delayMs),
		);

		// Act
		await withRetry(fn, {
			initialDelayMs: 10,
			backoffMultiplier: 2,
			jitter: 0,
			onRetry,
		});

		// Assert
		expect(delays[0]).toBe(10); // First retry: 10ms
		expect(delays[1]).toBe(20); // Second retry: 20ms
	});

	it("should respect max delay", async () => {
		// Arrange
		const fn = mock()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		const delays: number[] = [];
		const onRetry = mock((_err: unknown, _attempt: number, delayMs: number) =>
			delays.push(delayMs),
		);

		// Act
		await withRetry(fn, {
			initialDelayMs: 10,
			maxDelayMs: 15,
			backoffMultiplier: 4,
			jitter: 0,
			onRetry,
		});

		// Assert
		expect(delays[0]).toBe(10); // First retry: 10ms
		expect(delays[1]).toBe(15); // Second retry: capped at 15ms (would be 40ms)
	});

	it("should add jitter to delays", async () => {
		// Arrange
		const fn = mock().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

		const delays: number[] = [];
		const onRetry = mock((_err: unknown, _attempt: number, delayMs: number) =>
			delays.push(delayMs),
		);

		// Act
		await withRetry(fn, {
			initialDelayMs: 100,
			jitter: 0.1,
			onRetry,
		});

		// Assert
		expect(delays[0]).toBeGreaterThanOrEqual(100);
		expect(delays[0]).toBeLessThanOrEqual(110); // 100 + (100 * 0.1)
	});

	it("should respect isRetryable function", async () => {
		// Arrange
		const fn = mock().mockRejectedValue(new Error("non-retryable"));

		const isRetryable = (error: unknown) => {
			return (error as Error).message === "retryable";
		};

		// Act & Assert
		await expect(withRetry(fn, { isRetryable, initialDelayMs: 1 })).rejects.toThrow(
			"non-retryable",
		);
		expect(fn).toHaveBeenCalledTimes(1); // No retries
	});

	it("should call onRetry callback", async () => {
		// Arrange
		const error = new Error("fail");
		const fn = mock().mockRejectedValueOnce(error).mockResolvedValue("success");

		const onRetry = mock();

		// Act
		await withRetry(fn, { onRetry, initialDelayMs: 1, jitter: 0 });

		// Assert
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(error, 1, expect.any(Number));
	});

	it("should use default options", async () => {
		// Arrange - use real timer test since defaults may have longer delays
		const fn = mock().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

		// Act - override delay to make test fast
		const result = await withRetry(fn, { initialDelayMs: 1, jitter: 0 });

		// Assert
		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("should throw last error if all retries exhausted", async () => {
		// Arrange
		const fn = mock()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockRejectedValue(new Error("final fail"));

		// Act & Assert
		await expect(withRetry(fn, { maxRetries: 2, initialDelayMs: 1, jitter: 0 })).rejects.toThrow(
			"final fail",
		);
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it("should handle zero retries", async () => {
		// Arrange
		const fn = mock().mockRejectedValue(new Error("immediate failure"));

		// Act & Assert
		await expect(withRetry(fn, { maxRetries: 0 })).rejects.toThrow("immediate failure");
		expect(fn).toHaveBeenCalledTimes(1); // only initial attempt
	});
});

describe("withRetry - real timers", () => {
	it("should actually wait with real timers", async () => {
		// Arrange
		const start = Date.now();
		const fn = mock().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

		// Act
		const result = await withRetry(fn, {
			initialDelayMs: 50,
			jitter: 0,
		});

		// Assert
		const elapsed = Date.now() - start;
		expect(result).toBe("success");
		expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small variance
		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe("RetryableErrors", () => {
	describe("isNetworkError", () => {
		it("should return true for network errors", () => {
			expect(RetryableErrors.isNetworkError(new Error("fetch failed"))).toBe(true);
			expect(RetryableErrors.isNetworkError(new Error("ECONNREFUSED"))).toBe(true);
			expect(RetryableErrors.isNetworkError(new Error("ENOTFOUND"))).toBe(true);
			expect(RetryableErrors.isNetworkError(new Error("ETIMEDOUT"))).toBe(true);
			expect(RetryableErrors.isNetworkError(new Error("ECONNRESET"))).toBe(true);
			expect(RetryableErrors.isNetworkError(new Error("socket hang up"))).toBe(true);
			expect(RetryableErrors.isNetworkError(new Error("Network Error"))).toBe(true);
		});

		it("should return false for non-network errors", () => {
			expect(RetryableErrors.isNetworkError(new Error("validation failed"))).toBe(false);
			expect(RetryableErrors.isNetworkError(new Error("not authorized"))).toBe(false);
		});

		it("should return false for non-Error objects", () => {
			expect(RetryableErrors.isNetworkError("string error")).toBe(false);
			expect(RetryableErrors.isNetworkError(null)).toBe(false);
			expect(RetryableErrors.isNetworkError(undefined)).toBe(false);
			expect(RetryableErrors.isNetworkError({ message: "ECONNREFUSED" })).toBe(false);
		});
	});

	describe("isRateLimitError", () => {
		it("should return true for rate limit errors", () => {
			expect(RetryableErrors.isRateLimitError(new Error("HTTP 429"))).toBe(true);
			expect(RetryableErrors.isRateLimitError(new Error("Rate limit exceeded"))).toBe(true);
			expect(RetryableErrors.isRateLimitError(new Error("rate limit"))).toBe(true);
		});

		it("should return false for non-rate-limit errors", () => {
			expect(RetryableErrors.isRateLimitError(new Error("HTTP 404"))).toBe(false);
			expect(RetryableErrors.isRateLimitError(new Error("invalid request"))).toBe(false);
		});

		it("should return false for non-Error objects", () => {
			expect(RetryableErrors.isRateLimitError("429")).toBe(false);
			expect(RetryableErrors.isRateLimitError(null)).toBe(false);
		});
	});

	describe("isServerError", () => {
		it("should return true for server errors", () => {
			expect(RetryableErrors.isServerError(new Error("HTTP 500"))).toBe(true);
			expect(RetryableErrors.isServerError(new Error("502 Bad Gateway"))).toBe(true);
			expect(RetryableErrors.isServerError(new Error("Service unavailable 503"))).toBe(true);
			expect(RetryableErrors.isServerError(new Error("504 Gateway Timeout"))).toBe(true);
			expect(RetryableErrors.isServerError(new Error("Server Error"))).toBe(true);
		});

		it("should return false for non-server errors", () => {
			expect(RetryableErrors.isServerError(new Error("HTTP 404"))).toBe(false);
			expect(RetryableErrors.isServerError(new Error("401 Unauthorized"))).toBe(false);
		});

		it("should return false for non-Error objects", () => {
			expect(RetryableErrors.isServerError("500")).toBe(false);
			expect(RetryableErrors.isServerError(null)).toBe(false);
		});
	});

	describe("isTransientError", () => {
		it("should return true for network errors", () => {
			expect(RetryableErrors.isTransientError(new Error("ECONNREFUSED"))).toBe(true);
		});

		it("should return true for rate limit errors", () => {
			expect(RetryableErrors.isTransientError(new Error("429"))).toBe(true);
		});

		it("should return true for server errors", () => {
			expect(RetryableErrors.isTransientError(new Error("500"))).toBe(true);
		});

		it("should return false for non-transient errors", () => {
			expect(RetryableErrors.isTransientError(new Error("404 Not Found"))).toBe(false);
			expect(RetryableErrors.isTransientError(new Error("Validation failed"))).toBe(false);
		});
	});
});

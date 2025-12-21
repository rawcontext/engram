/**
 * Tests for @engram/common/utils/retry
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableErrors, withRetry } from "./retry";

describe("withRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	it("should return result on success", async () => {
		// Arrange
		const fn = vi.fn().mockResolvedValue("success");

		// Act
		const promise = withRetry(fn);
		await vi.runAllTimersAsync();
		const result = await promise;

		// Assert
		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("should retry on failure and eventually succeed", async () => {
		// Arrange
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		// Act
		const promise = withRetry(fn);
		await vi.runAllTimersAsync();
		const result = await promise;

		// Assert
		expect(result).toBe("success");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it("should throw error after max retries", async () => {
		// Arrange
		const error = new Error("persistent failure");
		const fn = vi.fn().mockRejectedValue(error);

		// Act
		const promise = withRetry(fn, { maxRetries: 3 });
		const timerPromise = vi.runAllTimersAsync();

		// Assert
		await expect(promise).rejects.toThrow("persistent failure");
		await timerPromise;
		expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
	});

	it("should use exponential backoff", async () => {
		// Arrange
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		const delays: number[] = [];
		const onRetry = vi.fn((_, __, delayMs) => delays.push(delayMs));

		// Act
		const promise = withRetry(fn, {
			initialDelayMs: 100,
			backoffMultiplier: 2,
			jitter: 0,
			onRetry,
		});
		await vi.runAllTimersAsync();
		await promise;

		// Assert
		expect(delays[0]).toBe(100); // First retry: 100ms
		expect(delays[1]).toBe(200); // Second retry: 200ms
	});

	it("should respect max delay", async () => {
		// Arrange
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail 1"))
			.mockRejectedValueOnce(new Error("fail 2"))
			.mockResolvedValue("success");

		const delays: number[] = [];
		const onRetry = vi.fn((_, __, delayMs) => delays.push(delayMs));

		// Act
		const promise = withRetry(fn, {
			initialDelayMs: 1000,
			maxDelayMs: 1500,
			backoffMultiplier: 4,
			jitter: 0,
			onRetry,
		});
		await vi.runAllTimersAsync();
		await promise;

		// Assert
		expect(delays[0]).toBe(1000); // First retry: 1000ms
		expect(delays[1]).toBe(1500); // Second retry: capped at 1500ms (would be 4000ms)
	});

	it("should add jitter to delays", async () => {
		// Arrange
		const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

		const delays: number[] = [];
		const onRetry = vi.fn((_, __, delayMs) => delays.push(delayMs));

		// Act
		const promise = withRetry(fn, {
			initialDelayMs: 1000,
			jitter: 0.1,
			onRetry,
		});
		await vi.runAllTimersAsync();
		await promise;

		// Assert
		expect(delays[0]).toBeGreaterThanOrEqual(1000);
		expect(delays[0]).toBeLessThanOrEqual(1100); // 1000 + (1000 * 0.1)
	});

	it("should respect isRetryable function", async () => {
		// Arrange
		const retryableError = new Error("retryable");
		const nonRetryableError = new Error("non-retryable");
		const fn = vi.fn().mockRejectedValue(nonRetryableError);

		const isRetryable = (error: unknown) => {
			return (error as Error).message === "retryable";
		};

		// Act
		const promise = withRetry(fn, { isRetryable });
		const timerPromise = vi.runAllTimersAsync();

		// Assert
		await expect(promise).rejects.toThrow("non-retryable");
		await timerPromise;
		expect(fn).toHaveBeenCalledTimes(1); // No retries
	});

	it("should call onRetry callback", async () => {
		// Arrange
		const error = new Error("fail");
		const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue("success");

		const onRetry = vi.fn();

		// Act
		const promise = withRetry(fn, { onRetry });
		await vi.runAllTimersAsync();
		await promise;

		// Assert
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(error, 1, expect.any(Number));
	});

	it("should use default options", async () => {
		// Arrange
		const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValue("success");

		// Act
		const promise = withRetry(fn);
		await vi.runAllTimersAsync();
		const result = await promise;

		// Assert
		expect(result).toBe("success");
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

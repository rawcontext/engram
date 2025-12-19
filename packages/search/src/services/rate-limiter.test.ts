import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./rate-limiter";

describe("RateLimiter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe("Rate Limiting", () => {
		it("should allow requests within limit", () => {
			const limiter = new RateLimiter({
				maxRequests: 3,
				windowMs: 60000, // 1 minute
			});

			const user = "user1";

			// First request
			let check = limiter.checkLimit(user);
			expect(check.allowed).toBe(true);
			expect(check.remaining).toBe(3);
			limiter.recordRequest(user);

			// Second request
			check = limiter.checkLimit(user);
			expect(check.allowed).toBe(true);
			expect(check.remaining).toBe(2);
			limiter.recordRequest(user);

			// Third request
			check = limiter.checkLimit(user);
			expect(check.allowed).toBe(true);
			expect(check.remaining).toBe(1);
			limiter.recordRequest(user);
		});

		it("should block requests exceeding limit", () => {
			const limiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 60000,
			});

			const user = "user1";

			// Use up the quota
			limiter.recordRequest(user);
			limiter.recordRequest(user);

			// Next request should be blocked
			const check = limiter.checkLimit(user);
			expect(check.allowed).toBe(false);
			expect(check.remaining).toBe(0);
			expect(check.reason).toContain("Rate limit exceeded");
		});

		it("should implement sliding window correctly", () => {
			const limiter = new RateLimiter({
				maxRequests: 3,
				windowMs: 60000, // 1 minute
			});

			const user = "user1";

			// Make request at T=0
			limiter.recordRequest(user);

			// Advance 30 seconds and make another request
			vi.advanceTimersByTime(30000);
			limiter.recordRequest(user);

			// Make third request at T=30s
			limiter.recordRequest(user);

			// Should be blocked now (3 requests in window)
			let check = limiter.checkLimit(user);
			expect(check.allowed).toBe(false);

			// Advance time by 31 seconds (T=61s, first request at T=0 expired)
			vi.advanceTimersByTime(31000);
			check = limiter.checkLimit(user);
			expect(check.allowed).toBe(true); // Should be allowed now
			expect(check.remaining).toBe(1); // Two requests still in window (at T=30s)
		});

		it("should track users independently", () => {
			const limiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 60000,
			});

			// User 1 uses quota
			limiter.recordRequest("user1");
			limiter.recordRequest("user1");

			// User 1 blocked
			let check = limiter.checkLimit("user1");
			expect(check.allowed).toBe(false);

			// User 2 still has quota
			check = limiter.checkLimit("user2");
			expect(check.allowed).toBe(true);
			expect(check.remaining).toBe(2);
		});
	});

	describe("Cost Attribution", () => {
		it("should track cost per request", () => {
			const limiter = new RateLimiter({
				maxRequests: 100,
				windowMs: 3600000, // 1 hour
				trackCosts: true,
				costPerRequest: 5, // 5 cents
				budgetLimit: 100, // $1 budget
			});

			const user = "user1";

			// Make 10 requests
			for (let i = 0; i < 10; i++) {
				limiter.recordRequest(user);
			}

			// Check usage
			const usage = limiter.getUsage(user);
			expect(usage.requestCount).toBe(10);
			expect(usage.totalCost).toBe(50); // 10 * 5 cents
			expect(usage.budgetExceeded).toBe(false);
		});

		it("should block requests when budget exceeded", () => {
			const limiter = new RateLimiter({
				maxRequests: 100,
				windowMs: 3600000,
				trackCosts: true,
				costPerRequest: 10, // 10 cents
				budgetLimit: 50, // 50 cents budget
			});

			const user = "user1";

			// Make 5 requests (50 cents total)
			for (let i = 0; i < 5; i++) {
				limiter.recordRequest(user);
			}

			// Budget should be exceeded
			const check = limiter.checkLimit(user);
			expect(check.allowed).toBe(false);
			expect(check.reason).toContain("Budget limit exceeded");

			const usage = limiter.getUsage(user);
			expect(usage.budgetExceeded).toBe(true);
			expect(usage.totalCost).toBe(50);
		});

		it("should allow custom cost per request", () => {
			const limiter = new RateLimiter({
				maxRequests: 100,
				windowMs: 3600000,
				trackCosts: true,
				costPerRequest: 5, // Default 5 cents
				budgetLimit: 1000,
			});

			const user = "user1";

			// Record request with custom cost
			limiter.recordRequest(user, "llm", 25); // 25 cents

			const usage = limiter.getUsage(user);
			expect(usage.totalCost).toBe(25);
		});

		it("should not track costs if disabled", () => {
			const limiter = new RateLimiter({
				maxRequests: 10,
				windowMs: 60000,
				trackCosts: false,
			});

			const user = "user1";

			limiter.recordRequest(user);
			limiter.recordRequest(user);

			const usage = limiter.getUsage(user);
			expect(usage.totalCost).toBe(0);
			expect(usage.budgetExceeded).toBe(false);
		});
	});

	describe("Usage Statistics", () => {
		it("should provide accurate usage statistics", () => {
			const limiter = new RateLimiter({
				maxRequests: 10,
				windowMs: 60000,
				trackCosts: true,
				costPerRequest: 5,
				budgetLimit: 1000,
			});

			const user = "user1";

			// Make some requests
			limiter.recordRequest(user);
			limiter.recordRequest(user);
			limiter.recordRequest(user);

			const usage = limiter.getUsage(user);
			expect(usage.requestCount).toBe(3);
			expect(usage.totalCost).toBe(15);
			expect(usage.budgetExceeded).toBe(false);
			expect(usage.oldestRequest).toBeInstanceOf(Date);
		});

		it("should clean up expired requests in usage stats", () => {
			const limiter = new RateLimiter({
				maxRequests: 10,
				windowMs: 60000,
			});

			const user = "user1";

			// Make 3 requests at T=0
			limiter.recordRequest(user);
			limiter.recordRequest(user);
			limiter.recordRequest(user);

			// Check usage at T=0
			let usage = limiter.getUsage(user);
			expect(usage.requestCount).toBe(3);

			// Advance time past window
			vi.advanceTimersByTime(61000);

			// Check usage again - should be 0
			usage = limiter.getUsage(user);
			expect(usage.requestCount).toBe(0);
			expect(usage.oldestRequest).toBeNull();
		});
	});

	describe("Admin Functions", () => {
		it("should reset user limits", () => {
			const limiter = new RateLimiter({
				maxRequests: 2,
				windowMs: 60000,
			});

			const user = "user1";

			// Use up quota
			limiter.recordRequest(user);
			limiter.recordRequest(user);

			// Blocked
			let check = limiter.checkLimit(user);
			expect(check.allowed).toBe(false);

			// Reset user
			limiter.resetUser(user);

			// Should be allowed now
			check = limiter.checkLimit(user);
			expect(check.allowed).toBe(true);
			expect(check.remaining).toBe(2);
		});

		it("should reset all limits", () => {
			const limiter = new RateLimiter({
				maxRequests: 1,
				windowMs: 60000,
			});

			// Multiple users use quota
			limiter.recordRequest("user1");
			limiter.recordRequest("user2");
			limiter.recordRequest("user3");

			// All blocked
			expect(limiter.checkLimit("user1").allowed).toBe(false);
			expect(limiter.checkLimit("user2").allowed).toBe(false);
			expect(limiter.checkLimit("user3").allowed).toBe(false);

			// Reset all
			limiter.resetAll();

			// All should be allowed now
			expect(limiter.checkLimit("user1").allowed).toBe(true);
			expect(limiter.checkLimit("user2").allowed).toBe(true);
			expect(limiter.checkLimit("user3").allowed).toBe(true);
		});
	});

	describe("Cleanup", () => {
		it("should clean up expired records periodically", () => {
			const limiter = new RateLimiter({
				maxRequests: 10,
				windowMs: 60000,
			});

			const user = "user1";

			// Make a request
			limiter.recordRequest(user);

			// Advance time past window
			vi.advanceTimersByTime(61000);

			// Trigger cleanup (runs every 5 minutes)
			vi.advanceTimersByTime(5 * 60 * 1000);

			// Usage should be clean
			const usage = limiter.getUsage(user);
			expect(usage.requestCount).toBe(0);

			// Cleanup
			limiter.destroy();
		});

		it("should stop cleanup interval on destroy", () => {
			const limiter = new RateLimiter({
				maxRequests: 10,
				windowMs: 60000,
			});

			// Destroy should not throw
			expect(() => limiter.destroy()).not.toThrow();

			// Second destroy should also not throw
			expect(() => limiter.destroy()).not.toThrow();
		});
	});

	describe("Default Configuration", () => {
		it("should use default config for LLM tier", () => {
			const limiter = new RateLimiter();
			const config = limiter.config;

			expect(config.maxRequests).toBe(100);
			expect(config.windowMs).toBe(60 * 60 * 1000); // 1 hour
			expect(config.trackCosts).toBe(true);
			expect(config.costPerRequest).toBe(5);
			expect(config.budgetLimit).toBe(1000);
		});
	});
});

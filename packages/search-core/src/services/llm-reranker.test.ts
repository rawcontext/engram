import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentCandidate } from "./batched-reranker";

// Mock XAIClient - must be defined before vi.mock for hoisting
const mockXAIClient = {
	chatJSON: vi.fn(),
	getTotalCost: vi.fn().mockReturnValue(5.0),
	getTotalTokens: vi.fn().mockReturnValue(1000),
	resetCounters: vi.fn(),
};

// Mock rate limiter
vi.mock("./rate-limiter", () => ({
	RateLimiter: vi.fn().mockImplementation(() => ({
		checkLimit: vi.fn().mockReturnValue({
			allowed: true,
			remaining: 95,
			resetAt: new Date(Date.now() + 3600000),
		}),
		recordRequest: vi.fn(),
	})),
}));

// Mock logger
vi.mock("@engram/logger", () => ({
	createLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}),
}));

// Mock metrics
vi.mock("./reranker-metrics", () => ({
	recordRerankMetrics: vi.fn(),
}));

// Mock XAI Client - create an actual fake module file
vi.mock("../clients/xai-client", () => {
	return {
		XAIClient: vi.fn().mockImplementation(() => mockXAIClient),
	};
});

// Import after mocking
const { LLMListwiseReranker } = await import("./llm-reranker");

describe("LLMListwiseReranker", () => {
	let reranker: LLMListwiseReranker;
	let mockClient: any;

	const mockCandidates: DocumentCandidate[] = [
		{ id: "1", content: "First document about OAuth2 authentication flow" },
		{ id: "2", content: "Second document about API security best practices" },
		{ id: "3", content: "Third document about implementing JWT tokens" },
		{ id: "4", content: "Fourth document about OAuth2 implementation guide" },
		{ id: "5", content: "Fifth document about REST API design" },
	];

	beforeEach(() => {
		vi.clearAllMocks();

		reranker = new LLMListwiseReranker({
			apiKey: "test-key",
			model: "grok-4-1-fast-reasoning",
			maxCandidates: 10,
		});

		// Get mock client instance
		const { XAIClient } = require("../clients/xai-client");
		mockClient = XAIClient.mock.results[XAIClient.mock.results.length - 1].value;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should use default options when none provided", () => {
			const defaultReranker = new LLMListwiseReranker();
			expect(defaultReranker).toBeDefined();
		});

		it("should use provided options", () => {
			const customReranker = new LLMListwiseReranker({
				model: "grok-2",
				maxCandidates: 5,
				systemPrompt: "Custom prompt",
			});
			expect(customReranker).toBeDefined();
		});

		it("should create default rate limiter if not provided", () => {
			const reranker = new LLMListwiseReranker({
				enableRateLimiting: true,
			});
			expect(reranker).toBeDefined();
		});

		it("should skip rate limiter if disabled", () => {
			const reranker = new LLMListwiseReranker({
				enableRateLimiting: false,
			});
			expect(reranker).toBeDefined();
		});
	});

	describe("rerank()", () => {
		it("should return empty array for empty documents", async () => {
			const results = await reranker.rerank("test query", [], 5);
			expect(results).toEqual([]);
		});

		it("should successfully rerank documents", async () => {
			// Mock LLM response with ranking
			mockClient.chatJSON.mockResolvedValueOnce([3, 0, 2, 1, 4]);

			const results = await reranker.rerank("How to implement OAuth2?", mockCandidates, 5);

			expect(results).toHaveLength(5);
			expect(results[0].id).toBe("4"); // Index 3 -> doc 4
			expect(results[1].id).toBe("1"); // Index 0 -> doc 1
			expect(results[2].id).toBe("3"); // Index 2 -> doc 3

			// Scores should decrease with rank
			expect(results[0].score).toBeGreaterThan(results[1].score);
			expect(results[1].score).toBeGreaterThan(results[2].score);
		});

		it("should limit candidates to maxCandidates", async () => {
			const manyCandidates: DocumentCandidate[] = Array.from({ length: 20 }, (_, i) => ({
				id: `doc-${i}`,
				content: `Document ${i} content`,
			}));

			// Mock LLM response
			mockClient.chatJSON.mockResolvedValueOnce([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

			await reranker.rerank("test query", manyCandidates, 5);

			// Should only send maxCandidates (10) to LLM
			expect(mockClient.chatJSON).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({ role: "system" }),
					expect.objectContaining({
						role: "user",
						content: expect.stringContaining("[9]"), // Last index should be 9
					}),
				]),
				expect.anything(),
			);

			// Should NOT contain [10] or higher
			const callArgs = mockClient.chatJSON.mock.calls[0][0];
			const userMessage = callArgs.find((msg: any) => msg.role === "user");
			expect(userMessage.content).not.toContain("[10]");
		});

		it("should respect topK parameter", async () => {
			mockClient.chatJSON.mockResolvedValueOnce([3, 0, 2, 1, 4]);

			const results = await reranker.rerank(
				"test query",
				mockCandidates,
				2, // Only top 2
			);

			expect(results).toHaveLength(2);
			expect(results[0].id).toBe("4");
			expect(results[1].id).toBe("1");
		});

		it("should preserve original scores", async () => {
			const candidatesWithScores: DocumentCandidate[] = [
				{ id: "1", content: "First", score: 0.95 },
				{ id: "2", content: "Second", score: 0.85 },
				{ id: "3", content: "Third", score: 0.75 },
			];

			mockClient.chatJSON.mockResolvedValueOnce([2, 0, 1]);

			const results = await reranker.rerank("test", candidatesWithScores, 3);

			expect(results[0].originalScore).toBe(0.75); // Doc 3
			expect(results[1].originalScore).toBe(0.95); // Doc 1
			expect(results[2].originalScore).toBe(0.85); // Doc 2
		});

		it("should assign scores based on rank position", async () => {
			mockClient.chatJSON.mockResolvedValueOnce([3, 0, 2, 1, 4]);

			const results = await reranker.rerank("test", mockCandidates, 5);

			// First result should have highest score (1.0)
			expect(results[0].score).toBe(1.0);

			// Scores should decrease linearly
			for (let i = 1; i < results.length; i++) {
				expect(results[i].score).toBeLessThan(results[i - 1].score);
			}

			// Last result should have lowest score
			expect(results[results.length - 1].score).toBeGreaterThan(0);
		});

		it("should check rate limits", async () => {
			mockClient.chatJSON.mockResolvedValueOnce([0, 1, 2]);

			await reranker.rerank("test", mockCandidates, 3, "user-123");

			const { RateLimiter } = require("./rate-limiter");
			const mockRateLimiter = RateLimiter.mock.results[RateLimiter.mock.results.length - 1].value;

			expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith("user-123", "llm");
		});

		it("should record request after successful rerank", async () => {
			mockClient.chatJSON.mockResolvedValueOnce([0, 1, 2]);

			await reranker.rerank("test", mockCandidates, 3, "user-123");

			const { RateLimiter } = require("./rate-limiter");
			const mockRateLimiter = RateLimiter.mock.results[RateLimiter.mock.results.length - 1].value;

			expect(mockRateLimiter.recordRequest).toHaveBeenCalledWith(
				"user-123",
				"llm",
				5.0, // Mock cost
			);
		});

		it("should fail if rate limit exceeded", async () => {
			const { RateLimiter } = require("./rate-limiter");
			const mockRateLimiter = RateLimiter.mock.results[RateLimiter.mock.results.length - 1].value;

			mockRateLimiter.checkLimit.mockReturnValueOnce({
				allowed: false,
				remaining: 0,
				resetAt: new Date(Date.now() + 3600000),
				reason: "Rate limit exceeded: 100/100 requests",
			});

			await expect(reranker.rerank("test", mockCandidates, 3, "user-123")).rejects.toThrow(
				"Rate limit exceeded",
			);
		});

		it("should validate ranking indices", async () => {
			// Return invalid index
			mockClient.chatJSON.mockResolvedValueOnce([0, 99, 1]);

			await expect(reranker.rerank("test", mockCandidates, 3)).rejects.toThrow(
				"Invalid ranking index",
			);
		});

		it("should handle LLM errors gracefully", async () => {
			mockClient.chatJSON.mockRejectedValueOnce(new Error("LLM API error"));

			await expect(reranker.rerank("test", mockCandidates, 3)).rejects.toThrow("LLM API error");
		});
	});

	describe("getUsage()", () => {
		it("should return usage statistics", () => {
			const usage = reranker.getUsage();

			expect(usage).toEqual({
				totalCostCents: 5.0,
				totalTokens: 1000,
			});
		});
	});

	describe("resetUsage()", () => {
		it("should reset usage counters", () => {
			reranker.resetUsage();

			expect(mockClient.resetCounters).toHaveBeenCalled();
		});
	});

	describe("prompt generation", () => {
		it("should include query in prompt", async () => {
			mockClient.chatJSON.mockResolvedValueOnce([0, 1]);

			const query = "How to implement OAuth2?";
			await reranker.rerank(query, mockCandidates.slice(0, 2), 2);

			const callArgs = mockClient.chatJSON.mock.calls[0][0];
			const userMessage = callArgs.find((msg: any) => msg.role === "user");

			expect(userMessage.content).toContain(query);
		});

		it("should include candidates in prompt", async () => {
			mockClient.chatJSON.mockResolvedValueOnce([0, 1]);

			await reranker.rerank("test", mockCandidates.slice(0, 2), 2);

			const callArgs = mockClient.chatJSON.mock.calls[0][0];
			const userMessage = callArgs.find((msg: any) => msg.role === "user");

			expect(userMessage.content).toContain("[0]");
			expect(userMessage.content).toContain("[1]");
			expect(userMessage.content).toContain("OAuth2");
			expect(userMessage.content).toContain("API security");
		});

		it("should truncate long document content", async () => {
			const longDoc: DocumentCandidate = {
				id: "long",
				content: "a".repeat(1000),
			};

			mockClient.chatJSON.mockResolvedValueOnce([0]);

			await reranker.rerank("test", [longDoc], 1);

			const callArgs = mockClient.chatJSON.mock.calls[0][0];
			const userMessage = callArgs.find((msg: any) => msg.role === "user");

			// Should be truncated to ~500 chars
			expect(userMessage.content.length).toBeLessThan(1000);
			expect(userMessage.content).toContain("...");
		});
	});
});

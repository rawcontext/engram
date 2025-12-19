import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentCandidate } from "./batched-reranker";

// Mock generateObject from ai - must be defined before vi.mock for hoisting
const mockGenerateObject = vi.fn();

// Mock rate limiter - defined before vi.mock for hoisting
const mockRateLimiter = {
	checkLimit: vi.fn(),
	recordRequest: vi.fn(),
};

// Mock RateLimiter constructor
const MockRateLimiterClass = vi.fn(() => mockRateLimiter);

// Mock rate limiter module
vi.mock("./rate-limiter", () => ({
	RateLimiter: MockRateLimiterClass,
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

// Mock AI SDK
vi.mock("ai", () => ({
	generateObject: mockGenerateObject,
}));

// Mock Google provider
vi.mock("@ai-sdk/google", () => ({
	createGoogleGenerativeAI: vi.fn(() => vi.fn((model: string) => ({ modelId: model }))),
}));

// Import after mocking
const { LLMListwiseReranker } = await import("./llm-reranker");

describe("LLMListwiseReranker", () => {
	let reranker: InstanceType<typeof LLMListwiseReranker>;

	const mockCandidates: DocumentCandidate[] = [
		{ id: "1", content: "First document about OAuth2 authentication flow" },
		{ id: "2", content: "Second document about API security best practices" },
		{ id: "3", content: "Third document about implementing JWT tokens" },
		{ id: "4", content: "Fourth document about OAuth2 implementation guide" },
		{ id: "5", content: "Fifth document about REST API design" },
	];

	beforeEach(() => {
		vi.clearAllMocks();

		// Reset mock constructor implementations
		MockRateLimiterClass.mockImplementation(() => mockRateLimiter);

		// Reset mock return values after clearing
		mockRateLimiter.checkLimit.mockReturnValue({
			allowed: true,
			remaining: 95,
			resetAt: new Date(Date.now() + 3600000),
		});

		// Default mock for generateObject
		mockGenerateObject.mockResolvedValue({
			object: { ranking: [3, 0, 2, 1, 4] },
			usage: {
				inputTokens: 500,
				outputTokens: 50,
				totalTokens: 550,
			},
		});

		reranker = new LLMListwiseReranker({
			apiKey: "test-key",
			model: "gemini-3-flash",
			maxCandidates: 10,
		});
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
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [3, 0, 2, 1, 4] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

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
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test query", manyCandidates, 5);

			// Should call generateObject with prompt containing indices 0-9
			expect(mockGenerateObject).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining("[9]"),
				}),
			);

			// Should NOT contain [10] or higher
			const callArgs = mockGenerateObject.mock.calls[0][0];
			expect(callArgs.prompt).not.toContain("[10]");
		});

		it("should respect topK parameter", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [3, 0, 2, 1, 4] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

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

			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [2, 0, 1] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			const results = await reranker.rerank("test", candidatesWithScores, 3);

			expect(results[0].originalScore).toBe(0.75); // Doc 3
			expect(results[1].originalScore).toBe(0.95); // Doc 1
			expect(results[2].originalScore).toBe(0.85); // Doc 2
		});

		it("should assign scores based on rank position", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [3, 0, 2, 1, 4] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

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
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1, 2] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test", mockCandidates, 3, "user-123");

			expect(mockRateLimiter.checkLimit).toHaveBeenCalledWith("user-123", "llm");
		});

		it("should record request after successful rerank", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1, 2] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test", mockCandidates, 3, "user-123");

			expect(mockRateLimiter.recordRequest).toHaveBeenCalledWith(
				"user-123",
				"llm",
				expect.any(Number),
			);
		});

		it("should fail if rate limit exceeded", async () => {
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
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 99, 1] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await expect(reranker.rerank("test", mockCandidates, 3)).rejects.toThrow(
				"Invalid ranking index",
			);
		});

		it("should handle LLM errors gracefully", async () => {
			mockGenerateObject.mockRejectedValueOnce(new Error("LLM API error"));

			await expect(reranker.rerank("test", mockCandidates, 3)).rejects.toThrow("LLM API error");
		});
	});

	describe("getUsage()", () => {
		it("should return usage statistics", async () => {
			// Make a rerank call to accumulate usage
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1, 2] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test", mockCandidates.slice(0, 3), 3);

			const usage = reranker.getUsage();

			expect(usage.totalTokens).toBe(550);
			expect(usage.totalCostCents).toBeGreaterThan(0);
		});
	});

	describe("resetUsage()", () => {
		it("should reset usage counters", async () => {
			// Make a rerank call to accumulate usage
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1, 2] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test", mockCandidates.slice(0, 3), 3);

			reranker.resetUsage();

			const usage = reranker.getUsage();
			expect(usage.totalTokens).toBe(0);
			expect(usage.totalCostCents).toBe(0);
		});
	});

	describe("prompt generation", () => {
		it("should include query in prompt", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			const query = "How to implement OAuth2?";
			await reranker.rerank(query, mockCandidates.slice(0, 2), 2);

			expect(mockGenerateObject).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining(query),
				}),
			);
		});

		it("should include candidates in prompt", async () => {
			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0, 1] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test", mockCandidates.slice(0, 2), 2);

			const callArgs = mockGenerateObject.mock.calls[0][0];

			expect(callArgs.prompt).toContain("[0]");
			expect(callArgs.prompt).toContain("[1]");
			expect(callArgs.prompt).toContain("OAuth2");
			expect(callArgs.prompt).toContain("API security");
		});

		it("should truncate long document content", async () => {
			const longDoc: DocumentCandidate = {
				id: "long",
				content: "a".repeat(1000),
			};

			mockGenerateObject.mockResolvedValueOnce({
				object: { ranking: [0] },
				usage: { inputTokens: 500, outputTokens: 50, totalTokens: 550 },
			});

			await reranker.rerank("test", [longDoc], 1);

			const callArgs = mockGenerateObject.mock.calls[0][0];

			// Should be truncated to ~500 chars
			expect(callArgs.prompt.length).toBeLessThan(1000);
			expect(callArgs.prompt).toContain("...");
		});
	});
});

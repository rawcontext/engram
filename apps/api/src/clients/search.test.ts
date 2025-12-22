import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchClient } from "./search";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("SearchClient", () => {
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should strip trailing slash from baseUrl", () => {
			const client = new SearchClient("http://localhost:5002/", mockLogger);
			// We can verify this by checking the URL used in a search call
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ results: [], total: 0, took_ms: 10 }),
			});

			client.search({ text: "test" });
			expect(mockFetch).toHaveBeenCalledWith("http://localhost:5002/v1/search", expect.any(Object));
		});
	});

	describe("search", () => {
		it("should make POST request with correct body", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							id: "result-1",
							score: 0.95,
							rrf_score: null,
							reranker_score: null,
							rerank_tier: null,
							payload: { content: "test" },
							degraded: false,
						},
					],
					total: 1,
					took_ms: 15,
				}),
			});

			const client = new SearchClient("http://localhost:5002", mockLogger);
			const response = await client.search({ text: "my query" });

			expect(mockFetch).toHaveBeenCalledWith("http://localhost:5002/v1/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					text: "my query",
					limit: 10,
					threshold: 0.5,
					filters: {},
					strategy: "hybrid",
					rerank: false,
					rerank_tier: undefined,
					rerank_depth: undefined,
				}),
			});

			expect(response.results).toHaveLength(1);
			expect(response.total).toBe(1);
			expect(response.took_ms).toBe(15);
		});

		it("should use custom options", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ results: [], total: 0, took_ms: 5 }),
			});

			const client = new SearchClient("http://localhost:5002", mockLogger);
			await client.search({
				text: "query",
				limit: 20,
				threshold: 0.8,
				strategy: "vector",
				rerank: true,
				rerank_tier: "accurate",
				rerank_depth: 50,
				filters: { session_id: "session-123" },
			});

			expect(mockFetch).toHaveBeenCalledWith(
				"http://localhost:5002/v1/search",
				expect.objectContaining({
					body: JSON.stringify({
						text: "query",
						limit: 20,
						threshold: 0.8,
						filters: { session_id: "session-123" },
						strategy: "vector",
						rerank: true,
						rerank_tier: "accurate",
						rerank_depth: 50,
					}),
				}),
			);
		});

		it("should throw error on non-ok response", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 500,
				text: async () => "Internal Server Error",
			});

			const client = new SearchClient("http://localhost:5002", mockLogger);

			await expect(client.search({ text: "test" })).rejects.toThrow(
				"Search request failed with status 500: Internal Server Error",
			);
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should throw error on network failure", async () => {
			mockFetch.mockRejectedValue(new Error("Network error"));

			const client = new SearchClient("http://localhost:5002", mockLogger);

			await expect(client.search({ text: "test" })).rejects.toThrow("Network error");
			expect(mockLogger.error).toHaveBeenCalled();
		});

		it("should log debug info on success", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ results: [], total: 5, took_ms: 25 }),
			});

			const client = new SearchClient("http://localhost:5002", mockLogger);
			await client.search({ text: "test" });

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ total: 5, took_ms: 25 }),
				"Search request completed",
			);
		});
	});

	describe("health", () => {
		it("should return healthy status on ok response", async () => {
			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ status: "healthy", qdrant_connected: true }),
			});

			const client = new SearchClient("http://localhost:5002", mockLogger);
			const health = await client.health();

			expect(health.status).toBe("healthy");
			expect(health.qdrant_connected).toBe(true);
			expect(mockFetch).toHaveBeenCalledWith("http://localhost:5002/v1/health");
		});

		it("should return unhealthy on non-ok response", async () => {
			mockFetch.mockResolvedValue({
				ok: false,
				status: 503,
			});

			const client = new SearchClient("http://localhost:5002", mockLogger);
			const health = await client.health();

			expect(health.status).toBe("unhealthy");
			expect(health.qdrant_connected).toBe(false);
		});

		it("should return unreachable on network error", async () => {
			mockFetch.mockRejectedValue(new Error("Connection refused"));

			const client = new SearchClient("http://localhost:5002", mockLogger);
			const health = await client.health();

			expect(health.status).toBe("unreachable");
			expect(health.qdrant_connected).toBe(false);
		});
	});
});

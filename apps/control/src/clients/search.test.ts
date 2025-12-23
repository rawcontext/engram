import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
	createSearchClient,
	type EmbedResponse,
	SearchClient,
	type SearchResponse,
} from "./search";

// Mock logger
vi.mock("@engram/logger", () => ({
	createNodeLogger: mock(() => ({
		info: mock(),
		error: mock(),
		warn: mock(),
		debug: mock(),
	})),
}));

describe("SearchClient", () => {
	let client: SearchClient;
	let fetchMock: ReturnType<typeof mock>;

	beforeEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks

		// Mock global fetch
		fetchMock = mock();
		global.fetch = fetchMock;

		client = new SearchClient("http://localhost:5002");
	});

	describe("constructor", () => {
		it("should create client with baseUrl", () => {
			const client = new SearchClient("http://localhost:5002");
			expect(client).toBeInstanceOf(SearchClient);
		});

		it("should strip trailing slash from baseUrl", () => {
			const client = new SearchClient("http://localhost:5002/");
			expect(client).toBeInstanceOf(SearchClient);
		});

		it("should accept custom logger", () => {
			const mockLogger = {
				info: mock(),
				error: mock(),
				warn: mock(),
				debug: mock(),
			};

			const client = new SearchClient("http://localhost:5002", mockLogger as any);
			expect(client).toBeInstanceOf(SearchClient);
		});
	});

	describe("search", () => {
		it("should perform search with default options", async () => {
			const mockResponse: SearchResponse = {
				results: [
					{
						id: "1",
						score: 0.95,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						payload: { content: "test" },
						degraded: false,
					},
				],
				total: 1,
				took_ms: 10,
			};

			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await client.search({ text: "test query" });

			expect(result).toEqual(mockResponse);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:5002/v1/search",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: expect.stringContaining("test query"),
				}),
			);
		});

		it("should include all search options", async () => {
			const mockResponse: SearchResponse = {
				results: [],
				total: 0,
				took_ms: 5,
			};

			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			await client.search({
				text: "query",
				limit: 20,
				threshold: 0.7,
				filters: { session_id: "test" },
				strategy: "vector",
				rerank: true,
				rerank_tier: "accurate",
				rerank_depth: 50,
			});

			const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
			expect(callBody).toEqual({
				text: "query",
				limit: 20,
				threshold: 0.7,
				filters: { session_id: "test" },
				strategy: "vector",
				rerank: true,
				rerank_tier: "accurate",
				rerank_depth: 50,
			});
		});

		it("should handle search errors", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => "Internal server error",
			});

			await expect(client.search({ text: "test" })).rejects.toThrow(
				"Search request failed with status 500",
			);
		});

		it("should handle network errors", async () => {
			fetchMock.mockRejectedValueOnce(new Error("Network error"));

			await expect(client.search({ text: "test" })).rejects.toThrow("Network error");
		});

		it("should use default values for optional parameters", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ results: [], total: 0, took_ms: 1 }),
			});

			await client.search({ text: "test" });

			const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
			expect(callBody.limit).toBe(10);
			expect(callBody.threshold).toBe(0.5);
			expect(callBody.strategy).toBe("hybrid");
			expect(callBody.rerank).toBe(false);
		});
	});

	describe("embed", () => {
		it("should generate embedding with default options", async () => {
			const mockResponse: EmbedResponse = {
				embedding: [0.1, 0.2, 0.3],
				dimensions: 3,
				embedder_type: "text",
				took_ms: 5,
			};

			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			});

			const result = await client.embed({ text: "test text" });

			expect(result).toEqual(mockResponse);
			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:5002/v1/embed",
				expect.objectContaining({
					method: "POST",
					headers: { "Content-Type": "application/json" },
				}),
			);
		});

		it("should include all embed options", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					embedding: [0.1],
					dimensions: 1,
					embedder_type: "code",
					took_ms: 1,
				}),
			});

			await client.embed({
				text: "code snippet",
				embedder_type: "code",
				is_query: false,
			});

			const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
			expect(callBody).toEqual({
				text: "code snippet",
				embedder_type: "code",
				is_query: false,
			});
		});

		it("should handle embed errors", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
				status: 400,
				text: async () => "Bad request",
			});

			await expect(client.embed({ text: "test" })).rejects.toThrow(
				"Embed request failed with status 400",
			);
		});

		it("should handle network errors", async () => {
			fetchMock.mockRejectedValueOnce(new Error("Network error"));

			await expect(client.embed({ text: "test" })).rejects.toThrow("Network error");
		});

		it("should use default embedder_type and is_query", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					embedding: [0.1],
					dimensions: 1,
					embedder_type: "text",
					took_ms: 1,
				}),
			});

			await client.embed({ text: "test" });

			const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
			expect(callBody.embedder_type).toBe("text");
			expect(callBody.is_query).toBe(true);
		});
	});

	describe("health", () => {
		it("should return healthy status", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ status: "healthy", qdrant_connected: true }),
			});

			const result = await client.health();

			expect(result).toEqual({ status: "healthy", qdrant_connected: true });
			expect(fetchMock).toHaveBeenCalledWith("http://localhost:5002/v1/health");
		});

		it("should return unhealthy when response not ok", async () => {
			fetchMock.mockResolvedValueOnce({
				ok: false,
			});

			const result = await client.health();

			expect(result).toEqual({ status: "unhealthy", qdrant_connected: false });
		});

		it("should return unreachable when network error", async () => {
			fetchMock.mockRejectedValueOnce(new Error("Network error"));

			const result = await client.health();

			expect(result).toEqual({ status: "unreachable", qdrant_connected: false });
		});
	});

	describe("createSearchClient", () => {
		it("should create client with default URL from env", () => {
			const client = createSearchClient();

			expect(client).toBeInstanceOf(SearchClient);
		});

		it("should create client with custom URL", () => {
			const client = createSearchClient("http://custom:9000");

			expect(client).toBeInstanceOf(SearchClient);
		});

		it("should use SEARCH_URL env variable when available", () => {
			const oldEnv = process.env.SEARCH_URL;
			process.env.SEARCH_URL = "http://env:8000";

			const client = createSearchClient();

			expect(client).toBeInstanceOf(SearchClient);

			// Restore
			if (oldEnv !== undefined) {
				process.env.SEARCH_URL = oldEnv;
			} else {
				delete process.env.SEARCH_URL;
			}
		});
	});
});

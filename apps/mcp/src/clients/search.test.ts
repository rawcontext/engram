import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchClient } from "./search";

// Mock fetch globally
global.fetch = vi.fn();

describe("SearchClient", () => {
	let client: SearchClient;
	const baseUrl = "http://localhost:5002";

	beforeEach(() => {
		vi.clearAllMocks();
		client = new SearchClient(baseUrl);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("search", () => {
		it("should make a POST request to /search endpoint", async () => {
			const mockResponse = {
				results: [
					{
						id: "test-1",
						score: 0.9,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						degraded: false,
						payload: {
							node_id: "test-1",
							content: "Test result",
							type: "thought",
						},
					},
				],
				total: 1,
				took_ms: 50,
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			} as Response);

			const result = await client.search({
				text: "test query",
				limit: 10,
			});

			expect(fetch).toHaveBeenCalledWith(
				"http://localhost:5002/search",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: expect.any(String),
				}),
			);

			const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
			expect(requestBody).toEqual({
				text: "test query",
				limit: 10,
				threshold: 0.5,
				filters: {},
				strategy: "hybrid",
				rerank: false,
				rerank_tier: undefined,
				rerank_depth: undefined,
			});

			expect(result).toEqual(mockResponse);
		});

		it("should handle custom search options", async () => {
			const mockResponse = {
				results: [],
				total: 0,
				took_ms: 10,
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			} as Response);

			await client.search({
				text: "test query",
				limit: 20,
				threshold: 0.7,
				filters: {
					session_id: "session-123",
					type: "code",
				},
				strategy: "vector",
				rerank: true,
				rerank_tier: "accurate",
				rerank_depth: 30,
			});

			const requestBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
			expect(requestBody).toEqual({
				text: "test query",
				limit: 20,
				threshold: 0.7,
				filters: {
					session_id: "session-123",
					type: "code",
				},
				strategy: "vector",
				rerank: true,
				rerank_tier: "accurate",
				rerank_depth: 30,
			});
		});

		it("should handle trailing slash in base URL", async () => {
			const clientWithSlash = new SearchClient("http://localhost:5002/");
			const mockResponse = {
				results: [],
				total: 0,
				took_ms: 10,
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
			} as Response);

			await clientWithSlash.search({ text: "test" });

			expect(fetch).toHaveBeenCalledWith("http://localhost:5002/search", expect.any(Object));
		});

		it("should throw error on failed request", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				status: 500,
				text: async () => "Internal Server Error",
			} as Response);

			await expect(
				client.search({
					text: "test query",
				}),
			).rejects.toThrow("Search-py request failed with status 500: Internal Server Error");
		});

		it("should handle network errors", async () => {
			vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

			await expect(
				client.search({
					text: "test query",
				}),
			).rejects.toThrow("Network error");
		});

		it("should handle timeout", async () => {
			// Mock fetch to reject with an abort error (simulating timeout)
			const abortError = new DOMException("The operation was aborted", "AbortError");
			vi.mocked(fetch).mockRejectedValueOnce(abortError);

			await expect(
				client.search({
					text: "test query",
				}),
			).rejects.toThrow("The operation was aborted");
		});

		it("should clear timeout on successful response", async () => {
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: async () => ({ results: [], total: 0, took_ms: 10 }),
			} as Response);

			await client.search({ text: "test" });

			expect(clearTimeoutSpy).toHaveBeenCalled();
		});

		it("should clear timeout on error", async () => {
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
			vi.mocked(fetch).mockRejectedValueOnce(new Error("Test error"));

			await expect(client.search({ text: "test" })).rejects.toThrow();

			expect(clearTimeoutSpy).toHaveBeenCalled();
		});
	});
});

import { afterEach, beforeEach, describe, expect, it, mock, type Mock } from "bun:test";
import { SearchPyError, search } from "./search-client";

// Save original fetch to restore after tests
const originalFetch = global.fetch;

describe("search-client", () => {
	const originalAuthToken = process.env.ENGRAM_AUTH_TOKEN;

	beforeEach(() => {
		// Mock fetch for each test
		global.fetch = mock() as Mock<typeof fetch>;
		// Clear auth token for tests that check exact headers
		delete process.env.ENGRAM_AUTH_TOKEN;
	});

	afterEach(() => {
		// Restore original fetch to prevent test pollution
		global.fetch = originalFetch;
		// Restore original auth token value
		if (originalAuthToken) {
			process.env.ENGRAM_AUTH_TOKEN = originalAuthToken;
		}
	});

	describe("search", () => {
		it("should make successful search request", async () => {
			const mockResponse = {
				results: [
					{
						id: "1",
						score: 0.95,
						rrf_score: null,
						reranker_score: null,
						rerank_tier: null,
						payload: { text: "test" },
						degraded: false,
					},
				],
				total: 1,
				took_ms: 50,
			};

			(fetch as Mock).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			const result = await search({ text: "test query" });

			expect(result).toEqual(mockResponse);
			expect(fetch).toHaveBeenCalledWith(
				"http://localhost:6176/v1/search/query",
				expect.objectContaining({
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ text: "test query" }),
				}),
			);
		});

		it("should use custom base URL when provided", async () => {
			const mockResponse = { results: [], total: 0, took_ms: 10 };

			(fetch as Mock).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			await search({ text: "test" }, "http://custom:8080");

			expect(fetch).toHaveBeenCalledWith("http://custom:8080/v1/search/query", expect.any(Object));
		});

		it("should use SEARCH_URL env var when available", async () => {
			const originalEnv = process.env.SEARCH_URL;
			process.env.SEARCH_URL = "http://env-url:9090";

			const mockResponse = { results: [], total: 0, took_ms: 10 };

			(fetch as Mock).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			await search({ text: "test" });

			expect(fetch).toHaveBeenCalledWith("http://env-url:9090/v1/search/query", expect.any(Object));

			process.env.SEARCH_URL = originalEnv;
		});

		it("should include Authorization header when ENGRAM_AUTH_TOKEN is set", async () => {
			process.env.ENGRAM_AUTH_TOKEN = "test_auth_token";
			const mockResponse = { results: [], total: 0, took_ms: 10 };

			(fetch as Mock).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			await search({ text: "test" });

			expect(fetch).toHaveBeenCalledWith(
				"http://localhost:6176/v1/search/query",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer test_auth_token",
					}),
				}),
			);

			delete process.env.ENGRAM_AUTH_TOKEN;
		});

		it("should include all request parameters", async () => {
			const originalEnv = process.env.SEARCH_URL;
			delete process.env.SEARCH_URL;

			const mockResponse = { results: [], total: 0, took_ms: 10 };

			(fetch as Mock).mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			const request = {
				text: "test",
				limit: 10,
				threshold: 0.5,
				filters: {
					session_id: "sess_123",
					type: "code" as const,
					time_range: { start: 100, end: 200 },
				},
				strategy: "hybrid" as const,
				rerank: true,
				rerank_tier: "accurate" as const,
				rerank_depth: 50,
			};

			await search(request);

			expect(fetch).toHaveBeenCalledWith("http://localhost:6176/v1/search/query", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(request),
			});

			if (originalEnv) process.env.SEARCH_URL = originalEnv;
		});

		it("should throw SearchPyError when response is not ok with JSON error", async () => {
			(fetch as Mock).mockResolvedValue({
				ok: false,
				status: 400,
				json: () => Promise.resolve({ message: "Invalid request", code: "BAD_REQUEST" }),
			} as Response);

			await expect(search({ text: "test" })).rejects.toThrow(SearchPyError);
			await expect(search({ text: "test" })).rejects.toThrow("Invalid request");

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.statusCode).toBe(400);
				expect(error.details).toEqual({ message: "Invalid request", code: "BAD_REQUEST" });
			}
		});

		it("should throw SearchPyError when response is not ok with error field", async () => {
			(fetch as Mock).mockResolvedValue({
				ok: false,
				status: 500,
				json: () => Promise.resolve({ error: "Internal server error" }),
			} as Response);

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.message).toBe("Internal server error");
				expect(error.statusCode).toBe(500);
			}
		});

		it("should throw SearchPyError with status text when JSON parsing fails", async () => {
			(fetch as Mock).mockResolvedValue({
				ok: false,
				status: 503,
				statusText: "Service Unavailable",
				json: () => Promise.reject(new Error("Not JSON")),
			} as Response);

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.message).toBe("Service Unavailable");
				expect(error.statusCode).toBe(503);
			}
		});

		it("should use default error message when statusText is empty", async () => {
			(fetch as Mock).mockResolvedValue({
				ok: false,
				status: 500,
				statusText: "",
				json: () => Promise.reject(new Error("Not JSON")),
			} as Response);

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.message).toBe("Search-py request failed with status 500");
				expect(error.statusCode).toBe(500);
			}
		});

		it("should use default error message when error body has no message or error field", async () => {
			(fetch as Mock).mockResolvedValue({
				ok: false,
				status: 400,
				json: () => Promise.resolve({ someOtherField: "value" }),
			} as Response);

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.message).toBe("Search-py request failed with status 400");
			}
		});

		it("should throw SearchPyError when fetch throws network error", async () => {
			(fetch as Mock).mockRejectedValue(new Error("Network error"));

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.message).toBe("Failed to connect to search service: Network error");
				expect(error.statusCode).toBeUndefined();
				expect(error.details).toBeInstanceOf(Error);
			}
		});

		it("should throw SearchPyError for unknown errors", async () => {
			(fetch as Mock).mockRejectedValue("Unknown error string");

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBeInstanceOf(SearchPyError);
				const error = e as SearchPyError;
				expect(error.message).toBe("Unknown error occurred while calling search service");
			}
		});

		it("should rethrow SearchPyError without wrapping", async () => {
			const originalError = new SearchPyError("Original error", 404, { custom: "data" });
			(fetch as Mock).mockRejectedValue(originalError);

			try {
				await search({ text: "test" });
			} catch (e) {
				expect(e).toBe(originalError);
			}
		});
	});

	describe("SearchPyError", () => {
		it("should create error with message only", () => {
			const error = new SearchPyError("Test error");
			expect(error.message).toBe("Test error");
			expect(error.name).toBe("SearchPyError");
			expect(error.statusCode).toBeUndefined();
			expect(error.details).toBeUndefined();
		});

		it("should create error with status code", () => {
			const error = new SearchPyError("Test error", 500);
			expect(error.statusCode).toBe(500);
		});

		it("should create error with details", () => {
			const details = { foo: "bar" };
			const error = new SearchPyError("Test error", 400, details);
			expect(error.details).toEqual(details);
		});
	});
});

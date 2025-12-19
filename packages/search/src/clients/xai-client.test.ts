import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { XAIClient } from "./xai-client";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("XAIClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("constructor", () => {
		it("should use default options when none provided", () => {
			const client = new XAIClient();
			expect(client).toBeDefined();
		});

		it("should use provided options", () => {
			const client = new XAIClient({
				apiKey: "test-key",
				model: "grok-2",
				timeout: 5000,
			});
			expect(client).toBeDefined();
		});

		it("should use environment variable for API key", () => {
			process.env.XAI_API_KEY = "env-key";
			const client = new XAIClient();
			expect(client).toBeDefined();
			delete process.env.XAI_API_KEY;
		});
	});

	describe("chat()", () => {
		it("should successfully make chat request", async () => {
			const mockResponse = {
				id: "chat-123",
				object: "chat.completion",
				created: Date.now(),
				model: "grok-4-1-fast-reasoning",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: "Hello, world!",
						},
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
				},
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			const result = await client.chat([{ role: "user", content: "Hello" }]);

			expect(result).toBe("Hello, world!");
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining("/chat/completions"),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json",
						Authorization: "Bearer test-key",
					}),
				}),
			);
		});

		it("should handle rate limiting with retry", async () => {
			const rateLimitResponse = {
				ok: false,
				status: 429,
				json: async () => ({
					error: {
						message: "Rate limit exceeded",
						type: "rate_limit_error",
					},
				}),
				headers: new Map([["Retry-After", "1"]]),
			};

			const successResponse = {
				ok: true,
				json: async () => ({
					id: "chat-123",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "Success" },
							finish_reason: "stop",
						},
					],
				}),
				headers: new Map(),
			};

			mockFetch.mockResolvedValueOnce(rateLimitResponse).mockResolvedValueOnce(successResponse);

			const client = new XAIClient({ apiKey: "test-key" });

			// Mock sleep to avoid actual delay
			vi.spyOn(client as any, "sleep").mockResolvedValue(undefined);

			const result = await client.chat([{ role: "user", content: "Test" }]);

			expect(result).toBe("Success");
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it("should handle server errors with exponential backoff", async () => {
			const serverErrorResponse = {
				ok: false,
				status: 500,
				json: async () => ({
					error: {
						message: "Internal server error",
						type: "server_error",
					},
				}),
				headers: new Map(),
			};

			const successResponse = {
				ok: true,
				json: async () => ({
					id: "chat-123",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: "Success" },
							finish_reason: "stop",
						},
					],
				}),
				headers: new Map(),
			};

			mockFetch.mockResolvedValueOnce(serverErrorResponse).mockResolvedValueOnce(successResponse);

			const client = new XAIClient({ apiKey: "test-key" });

			// Mock sleep to avoid actual delay
			vi.spyOn(client as any, "sleep").mockResolvedValue(undefined);

			const result = await client.chat([{ role: "user", content: "Test" }]);

			expect(result).toBe("Success");
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it("should fail after max retries", async () => {
			const errorResponse = {
				ok: false,
				status: 500,
				json: async () => ({
					error: {
						message: "Internal server error",
						type: "server_error",
					},
				}),
				headers: new Map(),
			};

			mockFetch.mockResolvedValue(errorResponse);

			const client = new XAIClient({ apiKey: "test-key", maxRetries: 2 });

			// Mock sleep to avoid actual delay
			vi.spyOn(client as any, "sleep").mockResolvedValue(undefined);

			await expect(client.chat([{ role: "user", content: "Test" }])).rejects.toThrow(
				"xAI API error",
			);

			expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
		});

		it("should track usage and cost", async () => {
			const mockResponse = {
				id: "chat-123",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Test" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			await client.chat([{ role: "user", content: "Test" }]);

			expect(client.getTotalTokens()).toBe(150);
			expect(client.getTotalCost()).toBeGreaterThan(0);
		});
	});

	describe("chatJSON()", () => {
		it("should parse and validate JSON response", async () => {
			const mockResponse = {
				id: "chat-123",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: JSON.stringify({ result: [1, 2, 3] }),
						},
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			const schema = z.object({ result: z.array(z.number()) });

			const result = await client.chatJSON([{ role: "user", content: "Test" }], schema);

			expect(result).toEqual({ result: [1, 2, 3] });
		});

		it("should extract JSON from markdown code blocks", async () => {
			const mockResponse = {
				id: "chat-123",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: '```json\n{"result": [1, 2, 3]}\n```',
						},
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			const schema = z.object({ result: z.array(z.number()) });

			const result = await client.chatJSON([{ role: "user", content: "Test" }], schema);

			expect(result).toEqual({ result: [1, 2, 3] });
		});

		it("should fail on invalid JSON", async () => {
			const mockResponse = {
				id: "chat-123",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: "not valid json",
						},
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			const schema = z.object({ result: z.array(z.number()) });

			await expect(client.chatJSON([{ role: "user", content: "Test" }], schema)).rejects.toThrow(
				"Failed to parse JSON response",
			);
		});

		it("should fail on schema validation error", async () => {
			const mockResponse = {
				id: "chat-123",
				choices: [
					{
						index: 0,
						message: {
							role: "assistant",
							content: JSON.stringify({ wrong: "field" }),
						},
						finish_reason: "stop",
					},
				],
			};

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			const schema = z.object({ result: z.array(z.number()) });

			await expect(client.chatJSON([{ role: "user", content: "Test" }], schema)).rejects.toThrow(
				"Failed to parse JSON response",
			);
		});
	});

	describe("cost tracking", () => {
		it("should reset counters", async () => {
			const mockResponse = {
				id: "chat-123",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: "Test" },
						finish_reason: "stop",
					},
				],
				usage: {
					prompt_tokens: 100,
					completion_tokens: 50,
					total_tokens: 150,
				},
			};

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => mockResponse,
				headers: new Map(),
			});

			const client = new XAIClient({ apiKey: "test-key" });
			await client.chat([{ role: "user", content: "Test" }]);

			expect(client.getTotalTokens()).toBeGreaterThan(0);
			expect(client.getTotalCost()).toBeGreaterThan(0);

			client.resetCounters();

			expect(client.getTotalTokens()).toBe(0);
			expect(client.getTotalCost()).toBe(0);
		});
	});
});

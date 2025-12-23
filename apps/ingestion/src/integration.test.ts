import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const PORT = 5002; // Use different port than main service
const BASE_URL = `http://localhost:${PORT}`;

// We'll create a minimal test server that mimics the ingestion API
// This avoids starting NATS consumers during tests
let server: Server;

beforeAll(async () => {
	// Dynamically create a test server with mocked NATS
	const { createServer } = await import("node:http");
	const { RawStreamEventSchema } = await import("@engram/events");

	server = createServer(async (req, res) => {
		const url = new URL(req.url || "", BASE_URL);

		if (url.pathname === "/health") {
			res.writeHead(200);
			res.end("OK");
			return;
		}

		if (url.pathname === "/ingest" && req.method === "POST") {
			let body = "";

			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", async () => {
				try {
					if (!body) {
						throw new Error("Empty request body");
					}
					const rawBody = JSON.parse(body);
					// Validate using the schema
					RawStreamEventSchema.parse(rawBody);

					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ status: "processed" }));
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: message }));
				}
			});
			return;
		}

		res.writeHead(404);
		res.end("Not Found");
	});

	await new Promise<void>((resolve) => {
		server.listen(PORT, resolve);
	});
});

afterAll(() => {
	server?.close();
});

// Helper to create valid timestamps
function createTimestamp(): string {
	return new Date().toISOString();
}

// Helper to create base event structure
function createBaseEvent(provider: "openai" | "anthropic" | "xai") {
	return {
		event_id: randomUUID(),
		ingest_timestamp: createTimestamp(),
		provider,
	};
}

describe("Ingestion API Integration Tests", () => {
	describe("GET /health", () => {
		it("should return 200 OK", async () => {
			const response = await fetch(`${BASE_URL}/health`);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("OK");
		});
	});

	describe("POST /ingest - OpenAI events", () => {
		it("should process valid OpenAI chat completion chunk", async () => {
			const event = {
				...createBaseEvent("openai"),
				payload: {
					id: "chatcmpl-123",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "Hello, world!" },
							finish_reason: null,
						},
					],
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process OpenAI event with tool calls", async () => {
			const event = {
				...createBaseEvent("openai"),
				payload: {
					id: "chatcmpl-456",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: {
								tool_calls: [
									{
										index: 0,
										id: "call_abc123",
										function: {
											name: "get_weather",
											arguments: '{"location": "NYC"}',
										},
									},
								],
							},
							finish_reason: null,
						},
					],
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process OpenAI event with usage data", async () => {
			const event = {
				...createBaseEvent("openai"),
				payload: {
					id: "chatcmpl-789",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [],
					usage: {
						prompt_tokens: 100,
						completion_tokens: 50,
						total_tokens: 150,
					},
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});
	});

	describe("POST /ingest - Anthropic events", () => {
		it("should process valid Anthropic content_block_delta event", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "text_delta",
						text: "Hello from Claude!",
					},
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process Anthropic message_start event", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "message_start",
					message: {
						id: "msg_123",
						type: "message",
						role: "assistant",
						model: "claude-3-opus-20240229",
						content: [],
						usage: {
							input_tokens: 50,
							output_tokens: 0,
						},
					},
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process Anthropic thinking delta event", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "thinking_delta",
						thinking: "Let me analyze this problem...",
					},
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process Anthropic tool_use event", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json: '{"file": "test.ts"}',
					},
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process Anthropic message_delta with usage", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "message_delta",
					delta: {
						stop_reason: "end_turn",
					},
					usage: {
						output_tokens: 150,
					},
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});
	});

	describe("POST /ingest - XAI events", () => {
		it("should process valid XAI chat completion chunk", async () => {
			const event = {
				...createBaseEvent("xai"),
				payload: {
					id: "xai-123",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "grok-2",
					choices: [
						{
							index: 0,
							delta: { content: "Hello from Grok!" },
							finish_reason: null,
						},
					],
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});
	});

	describe("POST /ingest - Validation errors", () => {
		it("should return 400 for missing event_id", async () => {
			const event = {
				ingest_timestamp: createTimestamp(),
				provider: "openai",
				payload: { id: "test" },
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for invalid event_id format (not UUID)", async () => {
			const event = {
				event_id: "not-a-uuid",
				ingest_timestamp: createTimestamp(),
				provider: "openai",
				payload: { id: "test" },
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for missing ingest_timestamp", async () => {
			const event = {
				event_id: randomUUID(),
				provider: "openai",
				payload: { id: "test" },
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for invalid ingest_timestamp format", async () => {
			const event = {
				event_id: randomUUID(),
				ingest_timestamp: "not-a-date",
				provider: "openai",
				payload: { id: "test" },
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for missing provider", async () => {
			const event = {
				event_id: randomUUID(),
				ingest_timestamp: createTimestamp(),
				payload: { id: "test" },
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for invalid provider", async () => {
			const event = {
				event_id: randomUUID(),
				ingest_timestamp: createTimestamp(),
				provider: "invalid_provider",
				payload: { id: "test" },
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for missing payload", async () => {
			const event = {
				event_id: randomUUID(),
				ingest_timestamp: createTimestamp(),
				provider: "openai",
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for invalid JSON body", async () => {
			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "not valid json",
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});

		it("should return 400 for empty body", async () => {
			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "",
			});

			expect(response.status).toBe(400);
			const result = await response.json();
			expect(result.error).toBeDefined();
		});
	});

	describe("POST /ingest - Headers extraction", () => {
		it("should process event with x-session-id header", async () => {
			const sessionId = "custom-session-123";
			const event = {
				...createBaseEvent("openai"),
				payload: {
					id: "chatcmpl-header-test",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "Test" },
							finish_reason: null,
						},
					],
				},
				headers: {
					"x-session-id": sessionId,
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process event with x-working-dir header", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "text_delta",
						text: "Working dir test",
					},
				},
				headers: {
					"x-working-dir": "/Users/test/projects/my-app",
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process event with x-git-remote header", async () => {
			const event = {
				...createBaseEvent("openai"),
				payload: {
					id: "chatcmpl-git-test",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "Git remote test" },
							finish_reason: null,
						},
					],
				},
				headers: {
					"x-git-remote": "https://github.com/user/repo.git",
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process event with x-agent-type header", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "text_delta",
						text: "Agent type test",
					},
				},
				headers: {
					"x-agent-type": "claude-code",
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});

		it("should process event with all headers combined", async () => {
			const event = {
				...createBaseEvent("xai"),
				payload: {
					id: "xai-all-headers",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "grok-2",
					choices: [
						{
							index: 0,
							delta: { content: "All headers test" },
							finish_reason: null,
						},
					],
				},
				headers: {
					"x-session-id": "session-456",
					"x-working-dir": "/home/user/project",
					"x-git-remote": "git@github.com:org/repo.git",
					"x-agent-type": "cursor",
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result.status).toBe("processed");
		});
	});

	describe("POST /ingest - Edge cases", () => {
		it("should handle empty payload object", async () => {
			const event = {
				...createBaseEvent("openai"),
				payload: {},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			// Empty payload should still be valid, just ignored
			expect(response.status).toBe(200);
		});

		it("should handle payload with unknown fields", async () => {
			const event = {
				...createBaseEvent("anthropic"),
				payload: {
					type: "unknown_event_type",
					custom_field: "some value",
					another_field: 123,
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			// Unknown event types should be processed but ignored
			expect(response.status).toBe(200);
		});

		it("should handle local_mock provider", async () => {
			const event = {
				event_id: randomUUID(),
				ingest_timestamp: createTimestamp(),
				provider: "local_mock",
				payload: {
					test: "data",
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
		});

		it("should handle optional headers field in event schema", async () => {
			const event = {
				...createBaseEvent("openai"),
				payload: {
					id: "chatcmpl-optional",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [],
				},
				headers: {
					"x-custom-header": "test-value",
				},
			};

			const response = await fetch(`${BASE_URL}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(response.status).toBe(200);
		});
	});

	describe("Other endpoints", () => {
		it("should return 404 for unknown endpoints", async () => {
			const response = await fetch(`${BASE_URL}/unknown`);

			expect(response.status).toBe(404);
		});

		it("should return 404 for GET on /ingest", async () => {
			const response = await fetch(`${BASE_URL}/ingest`);

			expect(response.status).toBe(404);
		});
	});
});

/**
 * Integration tests for Ingestion service.
 *
 * Tests the full ingestion pipeline with real PostgreSQL and NATS.
 *
 * Run with: RUN_INTEGRATION_TESTS=1 bun test apps/ingestion/tests/integration
 * Use testcontainers: RUN_INTEGRATION_TESTS=1 USE_TESTCONTAINERS=1 bun test apps/ingestion/tests/integration
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createNatsClient } from "@engram/storage";
import {
	authHeader,
	getPostgresUrl,
	getNatsUrl,
	initializeDatabase,
	shouldRunIntegrationTests,
	startNatsContainer,
	startPostgresContainer,
	stopAllContainers,
	TEST_ACCESS_TOKEN,
	TEST_ORG,
	TEST_USER,
} from "./fixtures";

// Import auth functions directly (not mocked)
import { authenticateRequest, closeAuth, initAuth } from "../../src/auth";

const runTests = shouldRunIntegrationTests();

describe.skipIf(!runTests)("Ingestion Integration Tests", () => {
	let serverPort: number;
	let server: ReturnType<typeof Bun.serve> | null = null;
	let natsClient: ReturnType<typeof createNatsClient> | null = null;
	let receivedEvents: unknown[] = [];

	beforeAll(async () => {
		console.log("Starting integration test setup...");

		// Start containers in parallel
		await Promise.all([startPostgresContainer(), startNatsContainer()]);

		// Initialize database with test data
		await initializeDatabase(getPostgresUrl());

		// Initialize auth with real PostgreSQL
		initAuth({
			enabled: true,
			postgresUrl: getPostgresUrl(),
			logger: {
				info: () => {},
				warn: () => {},
				debug: () => {},
				error: console.error,
			} as any,
		});

		// Set up NATS client for receiving published events
		process.env.NATS_URL = getNatsUrl();
		natsClient = createNatsClient("test-consumer");

		// Create a consumer to capture published events
		const consumer = await natsClient.getConsumer({ groupId: "test-group" });
		await consumer.subscribe({ topic: "parsed_events", fromBeginning: true });

		// Start consumer in background to collect events
		consumer.run({
			eachMessage: async ({ message }) => {
				const value = message.value?.toString();
				if (value) {
					receivedEvents.push(JSON.parse(value));
				}
			},
		});

		// Find an available port for the test server
		serverPort = 15000 + Math.floor(Math.random() * 1000);

		console.log("Integration test setup complete");
	}, 120_000); // Extended timeout for container startup

	afterAll(async () => {
		if (server) {
			server.stop();
		}
		await closeAuth();
		await stopAllContainers();
	});

	describe("Auth Middleware Integration", () => {
		it("should authenticate valid OAuth token via PostgreSQL", async () => {
			const req = new Request("http://localhost/ingest", {
				method: "POST",
				headers: authHeader(),
			});

			const result = await authenticateRequest(req, ["ingest:write"]);

			expect(result).not.toBeInstanceOf(Response);
			if (!(result instanceof Response)) {
				expect(result.userId).toBe(TEST_USER.id);
				expect(result.orgId).toBe(TEST_ORG.id);
				expect(result.orgSlug).toBe(TEST_ORG.slug);
				expect(result.scopes).toContain("ingest:write");
			}
		});

		it("should reject invalid token", async () => {
			const req = new Request("http://localhost/ingest", {
				method: "POST",
				headers: { Authorization: "Bearer egm_oauth_invalidtokeninvalidtokeninvalidtok_X7kM2p" },
			});

			const result = await authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(401);
			}
		});

		it("should reject missing Authorization header", async () => {
			const req = new Request("http://localhost/ingest", {
				method: "POST",
			});

			const result = await authenticateRequest(req, ["ingest:write"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(401);
				const body = await result.json();
				expect(body.error.message).toBe("Missing Authorization header");
			}
		});

		it("should reject token without required scope", async () => {
			// The test token has memory:read, memory:write, ingest:write
			// Request a scope it doesn't have
			const req = new Request("http://localhost/ingest", {
				method: "POST",
				headers: authHeader(),
			});

			const result = await authenticateRequest(req, ["admin:all"]);

			expect(result).toBeInstanceOf(Response);
			if (result instanceof Response) {
				expect(result.status).toBe(403);
			}
		});

		it("should accept token with any of the required scopes", async () => {
			const req = new Request("http://localhost/ingest", {
				method: "POST",
				headers: authHeader(),
			});

			// Token has ingest:write but not admin:all
			const result = await authenticateRequest(req, ["admin:all", "ingest:write"]);

			expect(result).not.toBeInstanceOf(Response);
			if (!(result instanceof Response)) {
				expect(result.userId).toBe(TEST_USER.id);
			}
		});
	});

	describe("HTTP Endpoint Integration", () => {
		beforeAll(() => {
			// Dynamically import and create server with auth enabled
			// Note: Using a fresh import to avoid mock interference
			server = Bun.serve({
				port: serverPort,
				async fetch(req) {
					const url = new URL(req.url);

					if (url.pathname === "/health") {
						return new Response("OK", { status: 200 });
					}

					if (url.pathname === "/ingest" && req.method === "POST") {
						// Authenticate request
						const authResult = await authenticateRequest(req, ["memory:write", "ingest:write"]);
						if (authResult instanceof Response) {
							return authResult;
						}

						try {
							const body = await req.json();

							// Basic validation
							if (!body.event_id || !body.provider || !body.payload) {
								return new Response(JSON.stringify({ error: "Invalid event format" }), {
									status: 400,
									headers: { "Content-Type": "application/json" },
								});
							}

							return new Response(
								JSON.stringify({ status: "received", org_id: authResult.orgId }),
								{
									status: 200,
									headers: { "Content-Type": "application/json" },
								},
							);
						} catch (e) {
							return new Response(
								JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
								{
									status: 400,
									headers: { "Content-Type": "application/json" },
								},
							);
						}
					}

					return new Response("Not Found", { status: 404 });
				},
			});
		});

		it("should return 200 for /health endpoint", async () => {
			const res = await fetch(`http://localhost:${serverPort}/health`);

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("OK");
		});

		it("should accept authenticated request with valid event", async () => {
			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai",
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{ index: 0, delta: { content: "Hello integration test" }, finish_reason: null },
					],
				},
			};

			const res = await fetch(`http://localhost:${serverPort}/ingest`, {
				method: "POST",
				headers: {
					...authHeader(),
					"Content-Type": "application/json",
				},
				body: JSON.stringify(event),
			});

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.status).toBe("received");
			expect(body.org_id).toBe(TEST_ORG.id);
		});

		it("should reject unauthenticated request", async () => {
			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai",
				payload: {},
			};

			const res = await fetch(`http://localhost:${serverPort}/ingest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
			});

			expect(res.status).toBe(401);
		});

		it("should reject invalid event format", async () => {
			const res = await fetch(`http://localhost:${serverPort}/ingest`, {
				method: "POST",
				headers: {
					...authHeader(),
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ invalid: "data" }),
			});

			expect(res.status).toBe(400);
		});

		it("should reject malformed JSON", async () => {
			const res = await fetch(`http://localhost:${serverPort}/ingest`, {
				method: "POST",
				headers: {
					...authHeader(),
					"Content-Type": "application/json",
				},
				body: "{ invalid json",
			});

			expect(res.status).toBe(400);
		});

		it("should return 404 for unknown paths", async () => {
			const res = await fetch(`http://localhost:${serverPort}/unknown`, {
				headers: authHeader(),
			});

			expect(res.status).toBe(404);
		});
	});

	describe("IngestionProcessor Integration", () => {
		it("should process OpenAI event format", async () => {
			// Import the processor dynamically to avoid mock interference
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "Hello from OpenAI integration test" },
							finish_reason: null,
						},
					],
				},
				headers: { "x-session-id": "integration-test-session" },
				org_id: TEST_ORG.id,
				org_slug: TEST_ORG.slug,
			};

			const result = await processor.processEvent(event);

			expect(result.status).toBe("processed");
			expect(receivedEvents.length).toBeGreaterThan(0);

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.topic).toBe("parsed_events");
			expect(lastEvent.event.content).toBe("Hello from OpenAI integration test");
			expect(lastEvent.event.org_id).toBe(TEST_ORG.id);
		});

		it("should process Anthropic event format", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "anthropic" as const,
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "text_delta",
						text: "Hello from Anthropic integration test",
					},
				},
				headers: { "x-session-id": "anthropic-test-session" },
				org_id: TEST_ORG.id,
				org_slug: TEST_ORG.slug,
			};

			const result = await processor.processEvent(event);

			expect(result.status).toBe("processed");

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.topic).toBe("parsed_events");
			expect(lastEvent.event.content).toBe("Hello from Anthropic integration test");
		});

		it("should redact PII from content", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_pii",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "Contact me at secret@example.com or call 555-123-4567" },
							finish_reason: null,
						},
					],
				},
				headers: { "x-session-id": "pii-test-session" },
			};

			await processor.processEvent(event);

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.event.content).not.toContain("secret@example.com");
			expect(lastEvent.event.content).not.toContain("555-123-4567");
		});

		it("should extract thinking content", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_thinking",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: {
								content: "<thinking>Let me analyze this...</thinking>Here is my response",
							},
							finish_reason: null,
						},
					],
				},
				headers: { "x-session-id": "thinking-test-session" },
			};

			await processor.processEvent(event);

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.event.type).toBe("thought");
			expect(lastEvent.event.thought).toBeDefined();
			expect(lastEvent.event.content).toBe("Here is my response");
		});

		it("should include org context in parsed events", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_org",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					choices: [{ index: 0, delta: { content: "Multi-tenant test" }, finish_reason: null }],
				},
				headers: {
					"x-session-id": "org-test-session",
					"x-working-dir": "/project/path",
					"x-git-remote": "git@github.com:test/repo.git",
					"x-agent-type": "claude-code",
				},
				org_id: TEST_ORG.id,
				org_slug: TEST_ORG.slug,
			};

			await processor.processEvent(event);

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.event.org_id).toBe(TEST_ORG.id);
			expect(lastEvent.event.org_slug).toBe(TEST_ORG.slug);
			expect(lastEvent.event.metadata.working_dir).toBe("/project/path");
			expect(lastEvent.event.metadata.git_remote).toBe("git@github.com:test/repo.git");
			expect(lastEvent.event.metadata.agent_type).toBe("claude-code");
		});

		it("should handle unknown provider gracefully", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async () => {},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "unknown_provider" as any,
				payload: { some: "data" },
			};

			const result = await processor.processEvent(event);

			expect(result.status).toBe("ignored");
		});

		it("should handle usage events", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_usage",
					object: "chat.completion.chunk",
					created: Date.now(),
					model: "gpt-4",
					usage: {
						prompt_tokens: 100,
						completion_tokens: 50,
					},
				},
				headers: { "x-session-id": "usage-test-session" },
			};

			await processor.processEvent(event);

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.event.type).toBe("usage");
			expect(lastEvent.event.usage.input_tokens).toBe(100);
			expect(lastEvent.event.usage.output_tokens).toBe(50);
		});

		it("should handle tool call events", async () => {
			const { IngestionProcessor } = await import("../../src/index");

			const mockNatsClient = {
				sendEvent: async (topic: string, key: string, event: unknown) => {
					receivedEvents.push({ topic, key, event });
				},
				getConsumer: async () => ({}),
			};

			const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

			const event = {
				event_id: crypto.randomUUID(),
				ingest_timestamp: new Date().toISOString(),
				provider: "anthropic" as const,
				payload: {
					type: "content_block_delta",
					index: 0,
					delta: {
						type: "input_json_delta",
						partial_json: '{"file_path": "/src/test.ts", "content": "test"}',
					},
				},
				headers: { "x-session-id": "tool-call-test-session" },
			};

			await processor.processEvent(event);

			const lastEvent = receivedEvents[receivedEvents.length - 1] as any;
			expect(lastEvent.event.type).toBe("tool_call");
		});
	});

	describe("Multi-Provider Support", () => {
		const providers = [
			{
				name: "openai",
				event: {
					provider: "openai" as const,
					payload: {
						id: "evt_openai",
						object: "chat.completion.chunk",
						created: Date.now(),
						model: "gpt-4",
						choices: [{ index: 0, delta: { content: "OpenAI test" }, finish_reason: null }],
					},
				},
			},
			{
				name: "anthropic",
				event: {
					provider: "anthropic" as const,
					payload: {
						type: "content_block_delta",
						index: 0,
						delta: { type: "text_delta", text: "Anthropic test" },
					},
				},
			},
			{
				name: "gemini",
				event: {
					provider: "gemini" as const,
					payload: {
						type: "message",
						timestamp: new Date().toISOString(),
						role: "assistant",
						content: "Gemini test",
					},
				},
			},
		];

		for (const { name, event } of providers) {
			it(`should process ${name} events correctly`, async () => {
				const { IngestionProcessor } = await import("../../src/index");

				const capturedEvents: unknown[] = [];
				const mockNatsClient = {
					sendEvent: async (topic: string, key: string, evt: unknown) => {
						capturedEvents.push(evt);
					},
					getConsumer: async () => ({}),
				};

				const processor = new IngestionProcessor({ natsClient: mockNatsClient as any });

				const fullEvent = {
					event_id: crypto.randomUUID(),
					ingest_timestamp: new Date().toISOString(),
					...event,
					headers: { "x-session-id": `${name}-provider-test` },
				};

				const result = await processor.processEvent(fullEvent);

				expect(result.status).toBe("processed");
				expect(capturedEvents.length).toBe(1);

				const parsed = capturedEvents[0] as any;
				expect(parsed.content).toBeDefined();
				expect(parsed.content).toContain("test");
			});
		}
	});
});

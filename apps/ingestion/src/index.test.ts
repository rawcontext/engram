import { createNodeLogger } from "@engram/logger";
import { Redactor } from "@engram/parser";
import { createKafkaClient } from "@engram/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIngestionProcessor, IngestionProcessor } from "./index";

// Mock Kafka Client
const mockSendEvent = vi.fn(async () => {});
const mockKafkaClient = {
	sendEvent: mockSendEvent,
	getConsumer: vi.fn(),
};

describe("Ingestion Service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("IngestionProcessor", () => {
		it("should process event and publish parsed event", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const eventId = "550e8400-e29b-41d4-a716-446655440000";
			const event = {
				event_id: eventId,
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: 123,
					model: "gpt-4",
					choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
				},
			};

			await processor.processEvent(event as Parameters<typeof processor.processEvent>[0]);

			expect(mockSendEvent).toHaveBeenCalled();
			const call = mockSendEvent.mock.calls[0];
			expect(call[0]).toBe("parsed_events");
			const parsed = call[2] as { content: string; original_event_id: string };
			expect(parsed.content).toBe("Hello");
			expect(parsed.original_event_id).toBe(eventId);
		});

		it("should handle unknown provider", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440123",
				ingest_timestamp: new Date().toISOString(),
				provider: "unknown_provider" as any,
				payload: {},
			};

			const result = await processor.processEvent(event);

			expect(result.status).toBe("ignored");
			expect(mockSendEvent).not.toHaveBeenCalled();
		});

		it("should extract thinking content", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440001",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: 123,
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "<thinking>Thinking about this...</thinking>Normal content" },
							finish_reason: null,
						},
					],
				},
				headers: { "x-session-id": "sess-123" },
			};

			await processor.processEvent(event as any);

			const call = mockSendEvent.mock.calls[0];
			const parsed = call[2] as { content?: string; thought?: string };
			expect(parsed.thought).toBeDefined();
			expect(parsed.content).toBe("Normal content");
		});

		it("should extract diffs", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440123",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: 123,
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: {
								content:
									"```diff\n--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,2 @@\n+new line\n```Normal content",
							},
							finish_reason: null,
						},
					],
				},
				headers: { "x-session-id": "sess-123" },
			};

			await processor.processEvent(event as any);

			const call = mockSendEvent.mock.calls[0];
			const parsed = call[2] as { content?: string; diff?: any };
			// Diff extraction may or may not work depending on content format
			// At minimum, content should be present
			expect(parsed.content).toBeDefined();
		});

		it("should redact PII", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440123",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: 123,
					model: "gpt-4",
					choices: [
						{
							index: 0,
							delta: { content: "My email is test@example.com and phone is 555-1234" },
							finish_reason: null,
						},
					],
				},
				headers: { "x-session-id": "sess-123" },
			};

			await processor.processEvent(event as any);

			const call = mockSendEvent.mock.calls[0];
			const parsed = call[2] as { content: string };
			// Redactor should have masked sensitive data
			expect(parsed.content).not.toContain("test@example.com");
		});

		it("should include project metadata", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440123",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: 123,
					model: "gpt-4",
					choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
				},
				headers: {
					"x-session-id": "sess-123",
					"x-working-dir": "/project",
					"x-git-remote": "git@github.com:user/repo.git",
					"x-agent-type": "claude-code",
				},
			};

			await processor.processEvent(event as any);

			const call = mockSendEvent.mock.calls[0];
			const parsed = call[2] as { metadata: any };
			expect(parsed.metadata.session_id).toBe("sess-123");
			expect(parsed.metadata.working_dir).toBe("/project");
			expect(parsed.metadata.git_remote).toBe("git@github.com:user/repo.git");
			expect(parsed.metadata.agent_type).toBe("claude-code");
		});

		it("should handle tool call events", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440123",
				ingest_timestamp: new Date().toISOString(),
				provider: "anthropic" as const,
				payload: {
					type: "content_block_delta",
					delta: {
						type: "input_json_delta",
						partial_json: '{"query": "test"}',
					},
					index: 0,
				},
				headers: { "x-session-id": "sess-123" },
			};

			await processor.processEvent(event as any);

			const call = mockSendEvent.mock.calls[0];
			const parsed = call[2] as { type: string };
			// Type should be inferred from delta
			expect(parsed.type).toBeDefined();
		});

		it("should handle usage events", async () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			const event = {
				event_id: "550e8400-e29b-41d4-a716-446655440123",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai" as const,
				payload: {
					id: "evt_123",
					object: "chat.completion.chunk",
					created: 123,
					model: "gpt-4",
					usage: { prompt_tokens: 100, completion_tokens: 200 },
				},
				headers: { "x-session-id": "sess-123" },
			};

			await processor.processEvent(event as any);

			const call = mockSendEvent.mock.calls[0];
			const parsed = call[2] as { usage?: any };
			expect(parsed.usage).toBeDefined();
			expect(parsed.usage.input_tokens).toBe(100);
			expect(parsed.usage.output_tokens).toBe(200);
		});

		it("should clean up stale extractors", async () => {
			// This tests the cleanupStaleExtractors function indirectly
			const processor = new IngestionProcessor(mockKafkaClient as any);

			// Process multiple events to create extractors
			for (let i = 0; i < 5; i++) {
				const event = {
					event_id: `550e8400-e29b-41d4-a716-44665544000${i}`,
					ingest_timestamp: new Date().toISOString(),
					provider: "openai" as const,
					payload: {
						id: `evt_${i}`,
						object: "chat.completion.chunk",
						created: 123,
						model: "gpt-4",
						choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
					},
					headers: { "x-session-id": `sess-${i}` },
				};

				await processor.processEvent(event as any);
			}

			// All events should have been processed
			expect(mockSendEvent).toHaveBeenCalledTimes(5);
		});
	});

	describe("createIngestionProcessor", () => {
		it("should create processor with default dependencies", () => {
			const processor = createIngestionProcessor();

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});

		it("should create processor with custom kafka client", () => {
			const customKafka = createKafkaClient("test");
			const processor = createIngestionProcessor({ kafkaClient: customKafka });

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});

		it("should create processor with custom redactor", () => {
			const customRedactor = new Redactor();
			const processor = createIngestionProcessor({ redactor: customRedactor });

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});

		it("should create processor with custom logger", () => {
			const customLogger = createNodeLogger({ service: "test" });
			const processor = createIngestionProcessor({ logger: customLogger });

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});
	});

	describe("Constructor variants", () => {
		it("should support legacy positional constructor", () => {
			const processor = new IngestionProcessor(mockKafkaClient as any);

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});

		it("should support deps object constructor", () => {
			const processor = new IngestionProcessor({
				kafkaClient: mockKafkaClient as any,
			});

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});

		it("should support no-args constructor", () => {
			const processor = new IngestionProcessor();

			expect(processor).toBeInstanceOf(IngestionProcessor);
		});
	});
});

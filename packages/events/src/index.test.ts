import { describe, expect, it } from "bun:test";
import {
	generateEventId,
	ParsedStreamEventSchema,
	ProviderEnum,
	RawStreamEventSchema,
} from "./index";

describe("Event Schemas", () => {
	describe("generateEventId", () => {
		it("should generate valid UUID v4", () => {
			const eventId = generateEventId();
			expect(eventId).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
			);
		});

		it("should generate unique IDs", () => {
			const id1 = generateEventId();
			const id2 = generateEventId();
			expect(id1).not.toBe(id2);
		});
	});

	describe("ProviderEnum", () => {
		it("should accept valid providers", () => {
			expect(ProviderEnum.parse("openai")).toBe("openai");
			expect(ProviderEnum.parse("anthropic")).toBe("anthropic");
			expect(ProviderEnum.parse("local_mock")).toBe("local_mock");
			expect(ProviderEnum.parse("xai")).toBe("xai");
			expect(ProviderEnum.parse("claude_code")).toBe("claude_code");
			expect(ProviderEnum.parse("codex")).toBe("codex");
			expect(ProviderEnum.parse("gemini")).toBe("gemini");
			expect(ProviderEnum.parse("opencode")).toBe("opencode");
			expect(ProviderEnum.parse("cline")).toBe("cline");
		});

		it("should reject invalid providers", () => {
			expect(() => ProviderEnum.parse("invalid")).toThrow();
		});
	});

	describe("RawStreamEventSchema", () => {
		it("should parse a valid raw event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai",
				payload: { some: "data" },
			};
			const parsed = RawStreamEventSchema.parse(validEvent);
			// Use toMatchObject to allow additional bitemporal fields
			expect(parsed).toMatchObject(validEvent);
		});

		it("should parse a valid raw event with optional fields", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: new Date().toISOString(),
				provider: "anthropic",
				payload: { some: "data" },
				headers: { "x-test": "true" },
			};
			const parsed = RawStreamEventSchema.parse(validEvent);
			// Use toMatchObject to allow additional bitemporal fields
			expect(parsed).toMatchObject(validEvent);
		});

		it("should reject invalid uuid", () => {
			const invalidEvent = {
				event_id: "not-a-uuid",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai",
				payload: {},
			};
			expect(() => RawStreamEventSchema.parse(invalidEvent)).toThrow();
		});

		it("should reject invalid timestamp", () => {
			const invalidEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: "not-a-date",
				provider: "openai",
				payload: {},
			};
			expect(() => RawStreamEventSchema.parse(invalidEvent)).toThrow();
		});

		it("should apply default bitemporal fields", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai",
				payload: { some: "data" },
			};
			const parsed = RawStreamEventSchema.parse(validEvent);
			expect(parsed.vt_start).toBeTypeOf("number");
			expect(parsed.vt_end).toBe(253402300799000);
			expect(parsed.tt_start).toBeTypeOf("number");
			expect(parsed.tt_end).toBe(253402300799000);
		});

		it("should accept custom bitemporal fields", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: new Date().toISOString(),
				provider: "openai",
				payload: { some: "data" },
				vt_start: 1000000,
				vt_end: 2000000,
				tt_start: 1000000,
				tt_end: 2000000,
			};
			const parsed = RawStreamEventSchema.parse(validEvent);
			expect(parsed.vt_start).toBe(1000000);
			expect(parsed.vt_end).toBe(2000000);
			expect(parsed.tt_start).toBe(1000000);
			expect(parsed.tt_end).toBe(2000000);
		});

		it("should reject invalid provider in event", () => {
			const invalidEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: new Date().toISOString(),
				provider: "invalid_provider",
				payload: {},
			};
			expect(() => RawStreamEventSchema.parse(invalidEvent)).toThrow();
		});

		it("should accept headers with multiple keys", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				ingest_timestamp: new Date().toISOString(),
				provider: "anthropic",
				payload: { some: "data" },
				headers: {
					"x-test": "true",
					"x-api-version": "v1",
					"content-type": "application/json",
				},
			};
			const parsed = RawStreamEventSchema.parse(validEvent);
			expect(parsed.headers).toEqual({
				"x-test": "true",
				"x-api-version": "v1",
				"content-type": "application/json",
			});
		});
	});

	describe("ParsedStreamEventSchema", () => {
		it("should parse a valid parsed event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "content",
				role: "user",
				content: "Hello world",
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			// Use toMatchObject to allow additional bitemporal fields
			expect(parsed).toMatchObject(validEvent);
		});

		it("should parse a tool call event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "tool_call",
				tool_call: {
					id: "call_123",
					name: "test_tool",
					arguments_delta: "{}",
					index: 0,
				},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			// Use toMatchObject to allow additional bitemporal fields
			expect(parsed).toMatchObject(validEvent);
		});

		it("should parse a diff event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "diff",
				diff: {
					file: "test.ts",
					hunk: "@@ -1,1 +1,1 @@",
				},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			// Use toMatchObject to allow additional bitemporal fields
			expect(parsed).toMatchObject(validEvent);
		});

		it("should parse usage event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "usage",
				usage: {
					input_tokens: 10,
					output_tokens: 20,
				},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			// Use toMatchObject to allow additional bitemporal fields
			expect(parsed).toMatchObject(validEvent);
		});

		it("should reject invalid event type", () => {
			const invalidEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "invalid_type",
			};
			expect(() => ParsedStreamEventSchema.parse(invalidEvent)).toThrow();
		});

		it("should reject missing required fields", () => {
			const invalidEvent = {
				// Missing event_id
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "content",
			};
			expect(() => ParsedStreamEventSchema.parse(invalidEvent)).toThrow();
		});

		it("should apply default values for usage tokens", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "usage",
				usage: {}, // Empty object, should trigger defaults
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.usage).toEqual({
				input_tokens: 0,
				output_tokens: 0,
			});
		});

		it("should apply default values for tool_call index", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "tool_call",
				tool_call: {
					id: "call_123",
					name: "test_tool",
					arguments_delta: "{}",
					// index missing, should default to 0
				},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.tool_call?.index).toBe(0);
		});

		it("should parse thought event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "thought",
				thought: "thinking about the problem...",
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed).toMatchObject(validEvent);
		});

		it("should parse control event", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "control",
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed).toMatchObject(validEvent);
		});

		it("should reject invalid role", () => {
			const invalidEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "content",
				role: "invalid_role",
			};
			expect(() => ParsedStreamEventSchema.parse(invalidEvent)).toThrow();
		});

		it("should parse event with all role types", () => {
			const roles = ["user", "assistant", "system"] as const;
			for (const role of roles) {
				const validEvent = {
					event_id: "123e4567-e89b-12d3-a456-426614174000",
					original_event_id: "123e4567-e89b-12d3-a456-426614174001",
					timestamp: new Date().toISOString(),
					type: "content",
					role,
					content: "test",
				};
				const parsed = ParsedStreamEventSchema.parse(validEvent);
				expect(parsed.role).toBe(role);
			}
		});

		it("should parse diff event without file field", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "diff",
				diff: {
					hunk: "@@ -1,1 +1,1 @@",
				},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.diff?.hunk).toBe("@@ -1,1 +1,1 @@");
			expect(parsed.diff?.file).toBeUndefined();
		});

		it("should parse tool_call with minimal fields", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "tool_call",
				tool_call: {},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.tool_call?.index).toBe(0);
			expect(parsed.tool_call?.id).toBeUndefined();
			expect(parsed.tool_call?.name).toBeUndefined();
			expect(parsed.tool_call?.arguments_delta).toBeUndefined();
		});

		it("should parse event with metadata", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "content",
				metadata: {
					model: "gpt-4",
					temperature: 0.7,
					custom_field: { nested: "value" },
				},
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.metadata).toEqual({
				model: "gpt-4",
				temperature: 0.7,
				custom_field: { nested: "value" },
			});
		});

		it("should apply default bitemporal fields", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "content",
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.vt_start).toBeTypeOf("number");
			expect(parsed.vt_end).toBe(253402300799000);
			expect(parsed.tt_start).toBeTypeOf("number");
			expect(parsed.tt_end).toBe(253402300799000);
		});

		it("should accept custom bitemporal fields", () => {
			const validEvent = {
				event_id: "123e4567-e89b-12d3-a456-426614174000",
				original_event_id: "123e4567-e89b-12d3-a456-426614174001",
				timestamp: new Date().toISOString(),
				type: "content",
				vt_start: 1000000,
				vt_end: 2000000,
				tt_start: 1000000,
				tt_end: 2000000,
			};
			const parsed = ParsedStreamEventSchema.parse(validEvent);
			expect(parsed.vt_start).toBe(1000000);
			expect(parsed.vt_end).toBe(2000000);
			expect(parsed.tt_start).toBe(1000000);
			expect(parsed.tt_end).toBe(2000000);
		});
	});
});

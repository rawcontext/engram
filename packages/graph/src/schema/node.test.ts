/**
 * Tests for node definition DSL and type inference.
 */

import { describe, expect, test } from "bun:test";
import { field } from "./field";
import { type InferInsertModel, type InferSelectModel, node } from "./node";

describe("node()", () => {
	test("should create a node definition with fields", () => {
		const TestNode = node({
			name: field.string(),
			age: field.int(),
		});

		expect(TestNode.fields).toBeDefined();
		expect(TestNode.fields.name).toBeDefined();
		expect(TestNode.fields.age).toBeDefined();
		expect(TestNode.config.bitemporal).toBe(true);
	});

	test("should inject bitemporal fields by default", () => {
		const TestNode = node({
			name: field.string(),
		});

		expect(TestNode.config.bitemporal).toBe(true);
	});

	test("should allow disabling bitemporal fields", () => {
		const TestNode = node(
			{
				key: field.string(),
				value: field.string(),
			},
			{ bitemporal: false },
		);

		expect(TestNode.config.bitemporal).toBe(false);
	});

	test("should support custom label", () => {
		const TestNode = node(
			{
				name: field.string(),
			},
			{ label: "CustomLabel" },
		);

		expect(TestNode.config.label).toBe("CustomLabel");
	});

	test("should have default empty label", () => {
		const TestNode = node({
			name: field.string(),
		});

		expect(TestNode.config.label).toBe("");
	});
});

describe("Type Inference", () => {
	test("should infer basic field types", () => {
		const TestNode = node({
			name: field.string(),
			age: field.int(),
			active: field.boolean(),
			score: field.float(),
		});

		type TestType = typeof TestNode.$inferSelect;

		// Type assertion tests (compile-time checks)
		const testData: TestType = {
			name: "test",
			age: 25,
			active: true,
			score: 99.5,
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.name).toBe("test");
	});

	test("should infer optional fields", () => {
		const TestNode = node({
			required: field.string(),
			optional: field.string().optional(),
		});

		type TestType = typeof TestNode.$inferSelect;

		// Should allow omitting optional field
		const testData: TestType = {
			required: "value",
			// optional: undefined, // Can be omitted
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.required).toBe("value");
	});

	test("should infer enum types", () => {
		const TestNode = node({
			type: field.enum(["decision", "context", "insight"] as const),
		});

		type TestType = typeof TestNode.$inferSelect;

		const testData: TestType = {
			type: "decision",
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.type).toBe("decision");
	});

	test("should infer array types", () => {
		const TestNode = node({
			tags: field.array(field.string()),
			counts: field.array(field.int()),
		});

		type TestType = typeof TestNode.$inferSelect;

		const testData: TestType = {
			tags: ["tag1", "tag2"],
			counts: [1, 2, 3],
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.tags).toEqual(["tag1", "tag2"]);
	});

	test("should infer vector types", () => {
		const TestNode = node({
			embedding: field.vector(1024).optional(),
		});

		type TestType = typeof TestNode.$inferSelect;

		const testData: TestType = {
			embedding: new Array(1024).fill(0.5),
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.embedding).toHaveLength(1024);
	});

	test("should not include bitemporal fields when disabled", () => {
		const TestNode = node(
			{
				key: field.string(),
			},
			{ bitemporal: false },
		);

		type TestType = typeof TestNode.$inferSelect;

		const testData: TestType = {
			key: "value",
			// Should NOT require bitemporal fields
		};

		expect(testData.key).toBe("value");
	});

	test("InferSelectModel utility type should work", () => {
		const TestNode = node({
			name: field.string(),
		});

		type TestType = InferSelectModel<typeof TestNode>;

		const testData: TestType = {
			name: "test",
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.name).toBe("test");
	});

	test("InferInsertModel utility type should work", () => {
		const TestNode = node({
			name: field.string(),
		});

		type TestType = InferInsertModel<typeof TestNode>;

		const testData: TestType = {
			name: "test",
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(testData.name).toBe("test");
	});
});

describe("Complex Node Definition", () => {
	test("should handle Memory node definition", () => {
		const MemoryNode = node({
			content: field.string(),
			content_hash: field.string(),
			type: field.enum(["decision", "context", "insight", "preference", "fact", "turn"] as const),
			tags: field.array(field.string()),
			project: field.string().optional(),
			embedding: field.vector(1024).optional(),
		});

		type Memory = typeof MemoryNode.$inferSelect;

		const memory: Memory = {
			content: "Use TypeScript for type safety",
			content_hash: "abc123",
			type: "decision",
			tags: ["typescript", "best-practice"],
			project: "engram",
			embedding: new Array(1024).fill(0.1),
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(memory.type).toBe("decision");
		expect(memory.tags).toContain("typescript");
	});

	test("should handle Session node definition", () => {
		const SessionNode = node({
			id: field.string(),
			agent_type: field.string(),
			working_dir: field.string(),
			summary: field.string().optional(),
			start_time: field.timestamp(),
			end_time: field.timestamp().optional(),
		});

		type Session = typeof SessionNode.$inferSelect;

		const session: Session = {
			id: "session-123",
			agent_type: "claude-code",
			working_dir: "/home/user/project",
			summary: "Implemented feature X",
			start_time: Date.now(),
			end_time: Date.now(),
			vt_start: Date.now(),
			vt_end: Date.now(),
			tt_start: Date.now(),
			tt_end: Date.now(),
		};

		expect(session.agent_type).toBe("claude-code");
	});
});

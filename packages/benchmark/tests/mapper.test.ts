import { describe, expect, it } from "vitest";
import {
	DEFAULT_MAPPER_CONFIG,
	formatDocumentsForContext,
	groupBySession,
	mapInstance,
} from "../src/longmemeval/mapper.js";
import type { ParsedInstance } from "../src/longmemeval/types.js";

const createMockInstance = (overrides?: Partial<ParsedInstance>): ParsedInstance => ({
	questionId: "test_001",
	questionType: "single-session-user",
	memoryAbility: "IE",
	question: "What is the user's favorite color?",
	answer: "blue",
	questionDate: new Date("2024-03-15T10:00:00Z"),
	sessions: [
		{
			sessionId: "session_1",
			timestamp: new Date("2024-03-01T09:00:00Z"),
			turns: [
				{ role: "user", content: "My favorite color is blue.", hasAnswer: true, sequenceIndex: 0 },
				{ role: "assistant", content: "That's nice!", hasAnswer: false, sequenceIndex: 1 },
			],
		},
		{
			sessionId: "session_2",
			timestamp: new Date("2024-03-10T14:00:00Z"),
			turns: [
				{ role: "user", content: "Going to the store.", hasAnswer: false, sequenceIndex: 0 },
				{ role: "assistant", content: "What for?", hasAnswer: false, sequenceIndex: 1 },
			],
		},
	],
	answerSessionIds: ["session_1"],
	isAbstention: false,
	...overrides,
});

describe("LongMemEval Mapper", () => {
	describe("mapInstance", () => {
		it("should map instance to documents with turn granularity", () => {
			const instance = createMockInstance();
			const result = mapInstance(instance, { ...DEFAULT_MAPPER_CONFIG, granularity: "turn" });

			// With includeAssistant=true, should have 4 turns total
			expect(result.documents).toHaveLength(4);
			expect(result.instance).toBe(instance);
		});

		it("should map instance to documents with session granularity", () => {
			const instance = createMockInstance();
			const result = mapInstance(instance, { granularity: "session", includeAssistant: true });

			// Should have 2 sessions
			expect(result.documents).toHaveLength(2);
		});

		it("should filter out assistant turns when includeAssistant is false", () => {
			const instance = createMockInstance();
			const result = mapInstance(instance, { granularity: "turn", includeAssistant: false });

			// Should only have user turns (2 total)
			expect(result.documents).toHaveLength(2);
			expect(result.documents.every((d) => d.metadata.role === "user")).toBe(true);
		});

		it("should correctly identify evidence documents", () => {
			const instance = createMockInstance();
			const result = mapInstance(instance);

			expect(result.evidenceDocIds.length).toBeGreaterThan(0);

			// Find the evidence document
			const evidenceDoc = result.documents.find((d) => d.metadata.hasAnswer);
			expect(evidenceDoc).toBeDefined();
			expect(evidenceDoc?.content).toContain("blue");
		});

		it("should set valid time correctly", () => {
			const instance = createMockInstance();
			const result = mapInstance(instance);

			const doc = result.documents[0];
			expect(doc.validTime).toEqual(instance.sessions[0].timestamp);
		});
	});

	describe("formatDocumentsForContext", () => {
		it("should format documents as JSON", () => {
			const instance = createMockInstance();
			const { documents } = mapInstance(instance);

			const formatted = formatDocumentsForContext(documents.slice(0, 2));
			const parsed = JSON.parse(formatted);

			expect(Array.isArray(parsed)).toBe(true);
			expect(parsed[0]).toHaveProperty("index");
			expect(parsed[0]).toHaveProperty("content");
			expect(parsed[0]).toHaveProperty("date");
		});

		it("should respect maxLength option", () => {
			const instance = createMockInstance();
			const { documents } = mapInstance(instance);

			const formatted = formatDocumentsForContext(documents, { maxLength: 50 });
			expect(formatted.length).toBeLessThanOrEqual(70); // 50 + truncation message
			expect(formatted).toContain("truncated");
		});
	});

	describe("groupBySession", () => {
		it("should group documents by session ID", () => {
			const instance = createMockInstance();
			const { documents } = mapInstance(instance);

			const groups = groupBySession(documents);

			expect(groups.size).toBe(2);
			expect(groups.get("session_1")).toBeDefined();
			expect(groups.get("session_2")).toBeDefined();
		});
	});
});

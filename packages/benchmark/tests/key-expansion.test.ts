import { describe, it, expect } from "vitest";
import { KeyExpander, expandDocuments } from "../src/longmemeval/key-expansion.js";
import type { EngramDocument } from "../src/longmemeval/mapper.js";

const createMockDocument = (content: string, id = "test-1"): EngramDocument => ({
	id,
	instanceId: "instance-1",
	sessionId: "session-1",
	content,
	validTime: new Date("2024-03-15T10:00:00Z"),
	metadata: {
		questionId: "q1",
		role: "user",
		hasAnswer: false,
		sessionIndex: 0,
	},
});

describe("Key Expansion", () => {
	describe("KeyExpander", () => {
		const expander = new KeyExpander({ types: ["keyphrase", "userfact"] });

		it("should expand a document", async () => {
			const doc = createMockDocument(
				"My favorite color is blue and I work as a software engineer.",
			);
			const expanded = await expander.expand(doc);

			expect(expanded.originalContent).toBe(doc.content);
			expect(expanded.expandedContent).toContain(doc.content);
			expect(expanded.expansion).toBeDefined();
		});

		it("should extract keyphrases", async () => {
			const doc = createMockDocument(
				"I went to the doctor yesterday for my annual checkup. The appointment went well.",
			);
			const expanded = await expander.expand(doc);

			expect(expanded.expansion.keyphrases).toBeDefined();
			expect(expanded.expansion.keyphrases!.length).toBeGreaterThan(0);
		});

		it("should extract user facts", async () => {
			const doc = createMockDocument("My favorite color is blue. I am a software engineer.");
			const expanded = await expander.expand(doc);

			expect(expanded.expansion.userFacts).toBeDefined();
			// Should extract facts about color and occupation
			const facts = expanded.expansion.userFacts!.join(" ").toLowerCase();
			expect(facts).toMatch(/favorite|color|blue|engineer/);
		});

		it("should include expansion in content", async () => {
			const doc = createMockDocument("I love programming in TypeScript.");
			const expanded = await expander.expand(doc);

			expect(expanded.expandedContent).toContain("[Keywords:");
		});
	});

	describe("KeyExpander with summary", () => {
		const expander = new KeyExpander({ types: ["summary"] });

		it("should extract summary", async () => {
			const doc = createMockDocument(
				"Yesterday I went to the grocery store and bought some vegetables. " +
					"I was looking for organic produce but they were out of most items. " +
					"Finally found some carrots and spinach.",
			);
			const expanded = await expander.expand(doc);

			expect(expanded.expansion.summary).toBeDefined();
			expect(expanded.expansion.summary!.length).toBeLessThan(doc.content.length);
		});
	});

	describe("KeyExpander with events", () => {
		const expander = new KeyExpander({ types: ["event"] });

		it("should extract events", async () => {
			const doc = createMockDocument(
				"I visited the doctor on Monday. Then I went shopping yesterday.",
			);
			const expanded = await expander.expand(doc);

			expect(expanded.expansion.events).toBeDefined();
		});
	});

	describe("expandDocuments helper", () => {
		it("should expand batch of documents", async () => {
			const docs = [
				createMockDocument("My favorite food is pizza.", "doc-1"),
				createMockDocument("I work at a tech company.", "doc-2"),
			];

			const expanded = await expandDocuments(docs, { types: ["keyphrase"] });

			expect(expanded).toHaveLength(2);
			expect(expanded[0].id).toBe("doc-1");
			expect(expanded[1].id).toBe("doc-2");
		});
	});
});

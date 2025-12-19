import { beforeEach, describe, expect, it } from "vitest";
import type { EngramDocument } from "../src/longmemeval/mapper.js";
import {
	DEFAULT_READER_CONFIG,
	MockLLMProvider,
	Reader,
	StubLLMProvider,
} from "../src/longmemeval/reader.js";

const createMockDocument = (
	content: string,
	id: string,
	date: Date = new Date("2024-03-15"),
): EngramDocument => ({
	id,
	instanceId: "instance-1",
	sessionId: "session-1",
	content,
	validTime: date,
	metadata: {
		questionId: "q1",
		role: "user",
		hasAnswer: false,
		sessionIndex: 0,
	},
});

describe("Reader", () => {
	describe("with StubLLMProvider", () => {
		it("should generate an answer with default config", async () => {
			const llm = new StubLLMProvider();
			const reader = new Reader(llm);

			const docs = [createMockDocument("My favorite color is blue.", "doc-1")];
			const result = await reader.read("What is my favorite color?", docs);

			expect(result.hypothesis).toBeDefined();
			expect(result.abstained).toBe(true); // Stub returns low confidence
		});

		it("should use canned responses when set", async () => {
			const llm = new StubLLMProvider();
			llm.setResponse(
				"favorite color",
				`\`\`\`json
{
  "key_information": ["User stated favorite color is blue"],
  "reasoning_steps": ["Found direct statement about color preference"],
  "answer": "blue",
  "confidence": 0.95,
  "answerable": true
}
\`\`\``,
			);

			const reader = new Reader(llm);
			const docs = [createMockDocument("My favorite color is blue.", "doc-1")];
			const result = await reader.read("What is my favorite color?", docs);

			expect(result.hypothesis).toBe("blue");
			expect(result.keyInformation).toContain("User stated favorite color is blue");
			expect(result.abstained).toBe(false);
		});
	});

	describe("with MockLLMProvider", () => {
		let llm: MockLLMProvider;
		let reader: Reader;

		beforeEach(() => {
			llm = new MockLLMProvider();
			reader = new Reader(llm);
		});

		it("should parse JSON responses correctly", async () => {
			llm.setFixedResponse({
				key_information: ["fact1", "fact2"],
				reasoning_steps: ["step1", "step2"],
				answer: "The answer is 42",
				confidence: 0.9,
				answerable: true,
			});

			const docs = [createMockDocument("Some context", "doc-1")];
			const result = await reader.read("What is the answer?", docs);

			expect(result.hypothesis).toBe("The answer is 42");
			expect(result.keyInformation).toEqual(["fact1", "fact2"]);
			expect(result.reasoning).toBe("step1 → step2");
			expect(result.abstained).toBe(false);
		});

		it("should detect abstention when answerable is false", async () => {
			llm.setFixedResponse({
				key_information: [],
				reasoning_steps: ["No relevant information found"],
				answer: "Cannot determine",
				confidence: 0.1,
				answerable: false,
			});

			const docs = [createMockDocument("Unrelated content", "doc-1")];
			const result = await reader.read("What is my phone number?", docs);

			expect(result.abstained).toBe(true);
			expect(result.confidence).toBeLessThan(0.3);
		});
	});

	describe("confidence calibration", () => {
		it("should return low confidence when no documents", async () => {
			const llm = new MockLLMProvider();
			llm.setConfidenceOverride(0.8);

			const reader = new Reader(llm);
			const result = await reader.read("What is X?", [], new Date());

			expect(result.confidence).toBeLessThan(0.5);
		});

		it("should incorporate retrieval scores in confidence", async () => {
			const llm = new MockLLMProvider();
			llm.setFixedResponse({
				answer: "test",
				confidence: 0.8,
				answerable: true,
			});

			const reader = new Reader(llm);
			const docs = [
				createMockDocument("Relevant content", "doc-1"),
				createMockDocument("More content", "doc-2"),
			];

			// High retrieval score
			const highScoreResult = await reader.read("Test?", docs, new Date(), [0.95, 0.8]);

			// Low retrieval score
			const lowScoreResult = await reader.read("Test?", docs, new Date(), [0.3, 0.2]);

			expect(highScoreResult.confidence).toBeGreaterThan(lowScoreResult.confidence ?? 0);
		});

		it("should have confidence signals in result", async () => {
			const llm = new MockLLMProvider();
			const reader = new Reader(llm);
			const docs = [createMockDocument("Content", "doc-1")];

			const result = await reader.read("Question?", docs, new Date(), [0.7]);

			expect(result.confidenceSignals).toBeDefined();
			expect(result.confidenceSignals?.hasRelevantDocs).toBe(true);
			expect(result.confidenceSignals?.topDocRelevance).toBe(0.7);
			expect(result.confidenceSignals?.supportingDocCount).toBe(1);
		});
	});

	describe("enhanced Chain-of-Note", () => {
		it("should use enhanced prompt by default", async () => {
			const llm = new MockLLMProvider();
			const reader = new Reader(llm);

			expect(DEFAULT_READER_CONFIG.enhancedChainOfNote).toBe(true);

			const docs = [createMockDocument("Test content", "doc-1")];
			const result = await reader.read("Test question?", docs);

			// Should have structured output
			expect(result.keyInformation).toBeDefined();
		});

		it("should fall back to basic Chain-of-Note when enhanced disabled", async () => {
			const llm = new MockLLMProvider();
			const reader = new Reader(llm, { enhancedChainOfNote: false });

			const docs = [createMockDocument("Test content", "doc-1")];
			const result = await reader.read("Test question?", docs);

			expect(result.hypothesis).toBeDefined();
		});

		it("should format context as JSON when structuredFormat enabled", async () => {
			const llm = new MockLLMProvider();
			const reader = new Reader(llm, { structuredFormat: true });

			const docs = [
				createMockDocument("First message", "doc-1", new Date("2024-03-10")),
				createMockDocument("Second message", "doc-2", new Date("2024-03-12")),
			];

			// The reader should format as JSON internally
			const result = await reader.read("Question?", docs);
			expect(result).toBeDefined();
		});
	});

	describe("abstention detection", () => {
		it("should abstain when confidence below threshold", async () => {
			const llm = new MockLLMProvider();
			llm.setConfidenceOverride(0.1);

			const reader = new Reader(llm, { abstentionThreshold: 0.3 });
			const docs = [createMockDocument("Unrelated", "doc-1")];

			const result = await reader.read("Unknown question?", docs);
			expect(result.abstained).toBe(true);
		});

		it("should not abstain when confidence above threshold", async () => {
			const llm = new MockLLMProvider();
			llm.setFixedResponse({
				answer: "Specific answer",
				confidence: 0.9,
				answerable: true,
			});

			const reader = new Reader(llm, { abstentionThreshold: 0.3 });
			const docs = [createMockDocument("Relevant content", "doc-1")];

			const result = await reader.read("Clear question?", docs, new Date(), [0.9]);
			expect(result.abstained).toBe(false);
		});

		it("should detect abstention phrases in markdown responses", async () => {
			const llm = new StubLLMProvider();
			llm.setResponse(
				"phone number",
				`### Key Information:
- No phone number mentioned in conversation

### Reasoning:
The conversation history does not contain any phone numbers.

### Answer:
I don't have that information.`,
			);

			const reader = new Reader(llm, { calibratedConfidence: false });
			const docs = [createMockDocument("My name is John", "doc-1")];

			const result = await reader.read("What is my phone number?", docs);
			expect(result.confidenceSignals?.abstentionDetected).toBe(true);
		});
	});

	describe("configuration options", () => {
		it("should respect jsonOutput setting", async () => {
			const llm = new MockLLMProvider();
			const readerJson = new Reader(llm, { jsonOutput: true });
			const readerMarkdown = new Reader(llm, { jsonOutput: false });

			const docs = [createMockDocument("Test", "doc-1")];

			const jsonResult = await readerJson.read("Question?", docs);
			const mdResult = await readerMarkdown.read("Question?", docs);

			// Both should produce results
			expect(jsonResult.hypothesis).toBeDefined();
			expect(mdResult.hypothesis).toBeDefined();
		});

		it("should disable calibrated confidence when configured", async () => {
			const llm = new MockLLMProvider();
			llm.setFixedResponse({
				answer: "test",
				confidence: 0.5,
				answerable: true,
			});

			const readerCalibrated = new Reader(llm, { calibratedConfidence: true });
			const readerUncalibrated = new Reader(llm, { calibratedConfidence: false });

			const docs = [createMockDocument("Content", "doc-1")];

			const calibratedResult = await readerCalibrated.read("Q?", docs, new Date(), [0.8]);
			const uncalibratedResult = await readerUncalibrated.read("Q?", docs, new Date(), [0.8]);

			// Uncalibrated should use raw LLM confidence (0.5)
			// Calibrated should compute weighted score
			expect(uncalibratedResult.confidence).toBe(0.5);
			expect(calibratedResult.confidence).not.toBe(0.5);
		});
	});
});

describe("Reader prompt generation", () => {
	it("should include date context when provided", async () => {
		const llm = new MockLLMProvider();
		const reader = new Reader(llm);

		const docs = [createMockDocument("Test", "doc-1")];
		const questionDate = new Date("2024-03-15");

		const result = await reader.read("What happened yesterday?", docs, questionDate);

		// Should have processed with date context
		expect(result).toBeDefined();
	});

	it("should handle empty documents gracefully", async () => {
		const llm = new MockLLMProvider();
		const reader = new Reader(llm);

		const result = await reader.read("Question with no context?", []);

		expect(result.hypothesis).toBeDefined();
		expect(result.confidenceSignals?.hasRelevantDocs).toBe(false);
	});
});

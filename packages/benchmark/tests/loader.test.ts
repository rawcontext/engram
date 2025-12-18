import { describe, it, expect, beforeAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadDataset, validateDataset } from "../src/longmemeval/loader.js";
import type { LongMemEvalInstance } from "../src/longmemeval/types.js";

const TEST_DIR = join(import.meta.dirname, ".test-data");

// Sample test instance matching LongMemEval schema
const sampleInstance: LongMemEvalInstance = {
	question_id: "test_001",
	question_type: "single-session-user",
	question: "What is the user's favorite color?",
	answer: "blue",
	question_date: "2024-03-15T10:00:00Z",
	haystack_session_ids: ["session_1", "session_2"],
	haystack_dates: ["2024-03-01T09:00:00Z", "2024-03-10T14:00:00Z"],
	haystack_sessions: [
		[
			{ role: "user", content: "My favorite color is blue." },
			{ role: "assistant", content: "That's a nice color!" },
		],
		[
			{ role: "user", content: "I went to the store today.", has_answer: false },
			{ role: "assistant", content: "What did you buy?" },
		],
	],
	answer_session_ids: ["session_1"],
};

const sampleInstanceAbstention: LongMemEvalInstance = {
	question_id: "test_002_abs",
	question_type: "single-session-user",
	question: "What is the user's favorite food?",
	answer: "Not mentioned",
	question_date: "2024-03-15T10:00:00Z",
	haystack_session_ids: ["session_1"],
	haystack_dates: ["2024-03-01T09:00:00Z"],
	haystack_sessions: [
		[
			{ role: "user", content: "My favorite color is blue." },
			{ role: "assistant", content: "That's a nice color!" },
		],
	],
	answer_session_ids: [],
};

const sampleDataset = [sampleInstance, sampleInstanceAbstention];

describe("LongMemEval Loader", () => {
	beforeAll(async () => {
		// Create test directory and sample dataset
		await mkdir(TEST_DIR, { recursive: true });
		await writeFile(join(TEST_DIR, "test_dataset.json"), JSON.stringify(sampleDataset));
	});

	it("should load and parse a valid dataset", async () => {
		const result = await loadDataset({
			datasetPath: join(TEST_DIR, "test_dataset.json"),
		});

		expect(result.instances).toHaveLength(2);
		expect(result.stats.totalInstances).toBe(2);
	});

	it("should correctly identify memory abilities", async () => {
		const result = await loadDataset({
			datasetPath: join(TEST_DIR, "test_dataset.json"),
		});

		const instance1 = result.instances[0];
		expect(instance1.memoryAbility).toBe("IE");
		expect(instance1.isAbstention).toBe(false);

		const instance2 = result.instances[1];
		expect(instance2.memoryAbility).toBe("ABS");
		expect(instance2.isAbstention).toBe(true);
	});

	it("should parse timestamps correctly", async () => {
		const result = await loadDataset({
			datasetPath: join(TEST_DIR, "test_dataset.json"),
		});

		const instance = result.instances[0];
		expect(instance.questionDate).toBeInstanceOf(Date);
		expect(instance.sessions[0].timestamp).toBeInstanceOf(Date);
	});

	it("should compute correct statistics", async () => {
		const result = await loadDataset({
			datasetPath: join(TEST_DIR, "test_dataset.json"),
		});

		expect(result.stats.totalSessions).toBe(3); // 2 + 1 sessions
		expect(result.stats.totalTurns).toBe(6); // 2 + 2 + 2 turns
		expect(result.stats.abstentionCount).toBe(1);
		expect(result.stats.byAbility.IE).toBe(1);
		expect(result.stats.byAbility.ABS).toBe(1);
	});

	it("should apply limit filter", async () => {
		const result = await loadDataset({
			datasetPath: join(TEST_DIR, "test_dataset.json"),
			limit: 1,
		});

		expect(result.instances).toHaveLength(1);
	});

	it("should validate a valid dataset", async () => {
		const result = await validateDataset(join(TEST_DIR, "test_dataset.json"));
		expect(result.valid).toBe(true);
		expect(result.stats).toBeDefined();
	});

	it("should fail validation for invalid file", async () => {
		const result = await validateDataset(join(TEST_DIR, "nonexistent.json"));
		expect(result.valid).toBe(false);
		expect(result.error).toBeDefined();
	});
});

// Cleanup after all tests
afterAll(async () => {
	await rm(TEST_DIR, { recursive: true, force: true });
});

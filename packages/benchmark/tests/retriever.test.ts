import { describe, it, expect, beforeEach } from "vitest";
import {
	Retriever,
	InMemoryVectorStore,
	computeRetrievalMetrics,
	type EmbeddingProvider,
} from "../src/longmemeval/retriever.js";
import { mapInstance } from "../src/longmemeval/mapper.js";
import type { ParsedInstance } from "../src/longmemeval/types.js";

/**
 * Mock embedding provider that generates deterministic embeddings
 * based on word overlap (for testing retrieval logic)
 */
class MockEmbeddingProvider implements EmbeddingProvider {
	readonly dimension = 64;

	async embed(texts: string[]): Promise<number[][]> {
		return texts.map((text) => this.textToVector(text));
	}

	private textToVector(text: string): number[] {
		const words = text.toLowerCase().split(/\s+/);
		const vector = new Array(this.dimension).fill(0);

		// Create a simple bag-of-words style embedding
		for (const word of words) {
			const hash = this.hashString(word);
			const index = hash % this.dimension;
			vector[index] += 1;
		}

		// Normalize
		const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
		if (norm > 0) {
			for (let i = 0; i < vector.length; i++) {
				vector[i] /= norm;
			}
		}

		return vector;
	}

	private hashString(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = (hash << 5) - hash + str.charCodeAt(i);
			hash = hash & hash;
		}
		return Math.abs(hash);
	}
}

const createMockInstance = (): ParsedInstance => ({
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
				{
					role: "assistant",
					content: "Blue is a calming color.",
					hasAnswer: false,
					sequenceIndex: 1,
				},
			],
		},
		{
			sessionId: "session_2",
			timestamp: new Date("2024-03-10T14:00:00Z"),
			turns: [
				{
					role: "user",
					content: "I went to the grocery store.",
					hasAnswer: false,
					sequenceIndex: 0,
				},
				{ role: "assistant", content: "What did you buy?", hasAnswer: false, sequenceIndex: 1 },
			],
		},
	],
	answerSessionIds: ["session_1"],
	isAbstention: false,
});

describe("LongMemEval Retriever", () => {
	let embeddings: MockEmbeddingProvider;
	let retriever: Retriever;

	beforeEach(() => {
		embeddings = new MockEmbeddingProvider();
		retriever = new Retriever(embeddings, { topK: 5 });
	});

	describe("InMemoryVectorStore", () => {
		it("should index and search documents", async () => {
			const store = new InMemoryVectorStore(embeddings);
			const instance = createMockInstance();
			const { documents } = mapInstance(instance);

			await store.index(documents);
			const result = await store.search("favorite color blue", 3);

			expect(result.documents.length).toBeLessThanOrEqual(3);
			expect(result.scores.length).toBe(result.documents.length);
		});
	});

	describe("Retriever", () => {
		it("should retrieve relevant documents", async () => {
			const instance = createMockInstance();
			const mapped = mapInstance(instance);

			await retriever.indexInstance(mapped);
			const result = await retriever.retrieve("What is my favorite color?");

			expect(result.documents.length).toBeGreaterThan(0);
			expect(result.retrievedIds.length).toBe(result.documents.length);
		});

		it("should rank documents by relevance", async () => {
			const instance = createMockInstance();
			const mapped = mapInstance(instance);

			await retriever.indexInstance(mapped);
			const result = await retriever.retrieve("favorite color blue");

			// Scores should be in descending order
			for (let i = 1; i < result.scores.length; i++) {
				expect(result.scores[i]).toBeLessThanOrEqual(result.scores[i - 1]);
			}
		});

		it("should clear index between instances", async () => {
			const instance = createMockInstance();
			const mapped = mapInstance(instance);

			await retriever.indexInstance(mapped);
			retriever.clear();

			// After clear, search should return empty results
			const result = await retriever.retrieve("favorite color");
			expect(result.documents.length).toBe(0);
		});
	});

	describe("computeRetrievalMetrics", () => {
		it("should compute recall correctly", () => {
			const result = {
				documents: [],
				scores: [],
				retrievedIds: ["doc1", "doc2", "doc3"],
			};
			const evidenceIds = ["doc1", "doc4"];

			const metrics = computeRetrievalMetrics(result, evidenceIds);

			expect(metrics.recall).toBe(0.5); // 1 out of 2 evidence docs retrieved
			expect(metrics.precision).toBeCloseTo(1 / 3); // 1 out of 3 retrieved is evidence
		});

		it("should compute recall@K correctly", () => {
			const result = {
				documents: [],
				scores: [],
				retrievedIds: ["doc1", "doc2", "doc3", "doc4", "doc5"],
			};
			const evidenceIds = ["doc1", "doc3"];

			const metrics = computeRetrievalMetrics(result, evidenceIds);

			expect(metrics.recallAtK[1]).toBe(0.5); // doc1 is evidence
			expect(metrics.recallAtK[5]).toBe(1.0); // both doc1 and doc3 in top 5
		});

		it("should handle empty evidence", () => {
			const result = {
				documents: [],
				scores: [],
				retrievedIds: ["doc1"],
			};

			const metrics = computeRetrievalMetrics(result, []);

			expect(metrics.recall).toBe(0);
			expect(metrics.precision).toBe(0);
		});
	});
});

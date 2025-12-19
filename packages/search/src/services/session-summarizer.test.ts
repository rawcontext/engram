import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_SESSION_SUMMARIZER_CONFIG,
	type LLMProvider,
	type LLMResponse,
	SessionSummarizer,
	type Turn,
} from "./session-summarizer";

/**
 * Mock LLM provider for testing
 */
class MockLLMProvider implements LLMProvider {
	private summaryResponse = "This is a test summary of the conversation.";

	setSummaryResponse(response: string): void {
		this.summaryResponse = response;
	}

	async complete(): Promise<LLMResponse> {
		return {
			text: this.summaryResponse,
			usage: { inputTokens: 100, outputTokens: 50 },
		};
	}
}

/**
 * Create sample turns for testing
 */
function createSampleTurns(count: number = 3): Turn[] {
	const baseTime = new Date("2024-01-15T10:00:00Z");
	return Array.from({ length: count }, (_, i) => ({
		id: `turn-${i}`,
		sessionId: "session-123",
		role: (i % 2 === 0 ? "user" : "assistant") as Turn["role"],
		content: i % 2 === 0 ? `User message ${i + 1}` : `Assistant response ${i + 1}`,
		timestamp: new Date(baseTime.getTime() + i * 60000),
	}));
}

describe("SessionSummarizer", () => {
	let mockLLM: MockLLMProvider;

	beforeEach(() => {
		mockLLM = new MockLLMProvider();
	});

	describe("constructor", () => {
		it("should use default config when none provided", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			expect(summarizer.getConfig()).toEqual(DEFAULT_SESSION_SUMMARIZER_CONFIG);
		});

		it("should merge custom config with defaults", () => {
			const summarizer = new SessionSummarizer(mockLLM, { maxTopics: 10 });
			expect(summarizer.getConfig().maxTopics).toBe(10);
			expect(summarizer.getConfig().nerModel).toBe(DEFAULT_SESSION_SUMMARIZER_CONFIG.nerModel);
		});
	});

	describe("summarize", () => {
		it("should throw error for empty turns array", async () => {
			const summarizer = new SessionSummarizer(mockLLM);
			await expect(summarizer.summarize([])).rejects.toThrow("Cannot summarize empty session");
		});

		it("should generate summary with correct session metadata", async () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const turns = createSampleTurns(3);

			// Mock the internal methods to avoid loading models
			const mockSummary = "Test summary of conversation.";
			const mockTopics = ["topic1", "topic2"];
			const mockEntities = ["Entity1"];
			const mockEmbedding = new Array(384).fill(0.1);

			vi.spyOn(summarizer as never, "generateSummary").mockResolvedValue(mockSummary as never);
			vi.spyOn(summarizer, "extractTopics").mockResolvedValue(mockTopics);
			vi.spyOn(summarizer, "extractEntities").mockResolvedValue(mockEntities);
			vi.spyOn(summarizer as never, "embedder", "get").mockReturnValue({
				embed: vi.fn().mockResolvedValue(mockEmbedding),
			} as never);

			const result = await summarizer.summarize(turns);

			expect(result.sessionId).toBe("session-123");
			expect(result.summary).toBe(mockSummary);
			expect(result.topics).toEqual(mockTopics);
			expect(result.entities).toEqual(mockEntities);
			expect(result.turnCount).toBe(3);
			expect(result.startTime).toEqual(turns[0].timestamp);
			expect(result.endTime).toEqual(turns[2].timestamp);
			expect(result.embedding).toHaveLength(384);
		});

		it("should use first turn sessionId for result", async () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const turns = createSampleTurns(2);
			turns[0].sessionId = "session-A";
			turns[1].sessionId = "session-B"; // Different session (edge case)

			vi.spyOn(summarizer as never, "generateSummary").mockResolvedValue("Summary" as never);
			vi.spyOn(summarizer, "extractTopics").mockResolvedValue([]);
			vi.spyOn(summarizer, "extractEntities").mockResolvedValue([]);
			vi.spyOn(summarizer as never, "embedder", "get").mockReturnValue({
				embed: vi.fn().mockResolvedValue(new Array(384).fill(0)),
			} as never);

			const result = await summarizer.summarize(turns);

			expect(result.sessionId).toBe("session-A");
		});
	});

	describe("extractCandidateKeywords", () => {
		it("should extract unique keywords from text", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const extractCandidates = (summarizer as never).extractCandidateKeywords.bind(summarizer) as (
				text: string,
			) => string[];

			const text = "The TypeScript project uses Docker and Kubernetes for deployment";
			const keywords = extractCandidates(text);

			expect(keywords).toContain("typescript");
			expect(keywords).toContain("docker");
			expect(keywords).toContain("kubernetes");
			expect(keywords).toContain("deployment");
		});

		it("should filter common stopwords", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const extractCandidates = (summarizer as never).extractCandidateKeywords.bind(summarizer) as (
				text: string,
			) => string[];

			const text = "The user is working on a project";
			const keywords = extractCandidates(text);

			expect(keywords).not.toContain("the");
			expect(keywords).not.toContain("is");
			expect(keywords).not.toContain("on");
			expect(keywords).not.toContain("a");
			expect(keywords).not.toContain("user"); // "user" is in stopwords
		});

		it("should generate bigrams", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const extractCandidates = (summarizer as never).extractCandidateKeywords.bind(summarizer) as (
				text: string,
			) => string[];

			const text = "machine learning models neural networks";
			const keywords = extractCandidates(text);

			// Should have bigrams
			expect(keywords.some((k) => k.includes(" "))).toBe(true);
		});

		it("should filter short words", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const extractCandidates = (summarizer as never).extractCandidateKeywords.bind(summarizer) as (
				text: string,
			) => string[];

			const text = "AI ML API SDK CLI";
			const keywords = extractCandidates(text);

			// Should filter 2-char or less
			expect(keywords).not.toContain("ai");
			expect(keywords).not.toContain("ml");
			expect(keywords).toContain("api");
			expect(keywords).toContain("sdk");
			expect(keywords).toContain("cli");
		});
	});

	describe("cosineSimilarity", () => {
		it("should calculate correct similarity for identical vectors", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const cosine = (summarizer as never).cosineSimilarity.bind(summarizer) as (
				a: number[],
				b: number[],
			) => number;

			const vec = [0.5, 0.5, 0.5];
			const similarity = cosine(vec, vec);

			expect(similarity).toBeCloseTo(1.0, 5);
		});

		it("should calculate correct similarity for orthogonal vectors", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const cosine = (summarizer as never).cosineSimilarity.bind(summarizer) as (
				a: number[],
				b: number[],
			) => number;

			const vec1 = [1, 0, 0];
			const vec2 = [0, 1, 0];
			const similarity = cosine(vec1, vec2);

			expect(similarity).toBeCloseTo(0.0, 5);
		});

		it("should calculate correct similarity for opposite vectors", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const cosine = (summarizer as never).cosineSimilarity.bind(summarizer) as (
				a: number[],
				b: number[],
			) => number;

			const vec1 = [1, 0, 0];
			const vec2 = [-1, 0, 0];
			const similarity = cosine(vec1, vec2);

			expect(similarity).toBeCloseTo(-1.0, 5);
		});

		it("should throw error for different length vectors", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const cosine = (summarizer as never).cosineSimilarity.bind(summarizer) as (
				a: number[],
				b: number[],
			) => number;

			const vec1 = [1, 0];
			const vec2 = [1, 0, 0];

			expect(() => cosine(vec1, vec2)).toThrow("Vectors must have same length");
		});

		it("should handle zero vectors", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const cosine = (summarizer as never).cosineSimilarity.bind(summarizer) as (
				a: number[],
				b: number[],
			) => number;

			const vec1 = [0, 0, 0];
			const vec2 = [1, 0, 0];
			const similarity = cosine(vec1, vec2);

			expect(similarity).toBe(0);
		});
	});

	describe("cleanEntityWord", () => {
		it("should remove BERT subword prefix", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const clean = (summarizer as never).cleanEntityWord.bind(summarizer) as (
				word: string,
			) => string;

			expect(clean("##ing")).toBe("ing");
			expect(clean("##tion")).toBe("tion");
		});

		it("should leave normal words unchanged", () => {
			const summarizer = new SessionSummarizer(mockLLM);
			const clean = (summarizer as never).cleanEntityWord.bind(summarizer) as (
				word: string,
			) => string;

			expect(clean("Docker")).toBe("Docker");
			expect(clean("TypeScript")).toBe("TypeScript");
		});
	});

	describe("configuration", () => {
		it("should update config at runtime", () => {
			const summarizer = new SessionSummarizer(mockLLM, { maxTopics: 5 });
			expect(summarizer.getConfig().maxTopics).toBe(5);

			summarizer.updateConfig({ maxTopics: 10 });
			expect(summarizer.getConfig().maxTopics).toBe(10);
		});

		it("should preserve other config when updating", () => {
			const summarizer = new SessionSummarizer(mockLLM, {
				maxTopics: 5,
				minEntityScore: 0.5,
			});

			summarizer.updateConfig({ maxTopics: 10 });

			expect(summarizer.getConfig().maxTopics).toBe(10);
			expect(summarizer.getConfig().minEntityScore).toBe(0.5);
		});
	});

	describe("generateSummary", () => {
		it("should use LLM to generate summary", async () => {
			mockLLM.setSummaryResponse("  Generated summary with whitespace  ");
			const summarizer = new SessionSummarizer(mockLLM);

			const generateSummary = (summarizer as never).generateSummary.bind(summarizer) as (
				context: string,
			) => Promise<string>;

			const summary = await generateSummary("user: Hello\nassistant: Hi there!");

			expect(summary).toBe("Generated summary with whitespace"); // Should be trimmed
		});
	});

	describe("extractEntities (unit)", () => {
		it("should deduplicate entities case-insensitively", async () => {
			const summarizer = new SessionSummarizer(mockLLM);

			// Mock NER pipeline
			const mockNerResults = [
				{ word: "Docker", entity: "B-ORG", score: 0.95, start: 0, end: 6 },
				{ word: "docker", entity: "B-ORG", score: 0.9, start: 10, end: 16 },
				{ word: "DOCKER", entity: "B-ORG", score: 0.85, start: 20, end: 26 },
			];

			vi.spyOn(summarizer as never, "loadNERPipeline").mockResolvedValue((() =>
				Promise.resolve(mockNerResults)) as never);

			const entities = await summarizer.extractEntities("Docker docker DOCKER");

			// Should only have one entry (first occurrence)
			expect(entities).toHaveLength(1);
			expect(entities[0]).toBe("Docker");
		});

		it("should filter entities below score threshold", async () => {
			const summarizer = new SessionSummarizer(mockLLM, { minEntityScore: 0.8 });

			const mockNerResults = [
				{ word: "HighScore", entity: "B-ORG", score: 0.95, start: 0, end: 9 },
				{ word: "LowScore", entity: "B-ORG", score: 0.5, start: 10, end: 18 },
			];

			vi.spyOn(summarizer as never, "loadNERPipeline").mockResolvedValue((() =>
				Promise.resolve(mockNerResults)) as never);

			const entities = await summarizer.extractEntities("HighScore LowScore");

			expect(entities).toContain("HighScore");
			expect(entities).not.toContain("LowScore");
		});

		it("should filter single-character entities", async () => {
			const summarizer = new SessionSummarizer(mockLLM);

			const mockNerResults = [
				{ word: "A", entity: "B-MISC", score: 0.95, start: 0, end: 1 },
				{ word: "AWS", entity: "B-ORG", score: 0.95, start: 2, end: 5 },
			];

			vi.spyOn(summarizer as never, "loadNERPipeline").mockResolvedValue((() =>
				Promise.resolve(mockNerResults)) as never);

			const entities = await summarizer.extractEntities("A AWS");

			expect(entities).not.toContain("A");
			expect(entities).toContain("AWS");
		});
	});

	describe("extractTopics (unit)", () => {
		it("should return empty array for text with only stopwords", async () => {
			const summarizer = new SessionSummarizer(mockLLM);

			// Mock keyword pipeline
			vi.spyOn(summarizer as never, "loadKeywordPipeline").mockResolvedValue(((texts: string[]) =>
				Promise.resolve(texts.map(() => ({ data: new Float32Array(384).fill(0.1) })))) as never);

			// Override extractCandidateKeywords to return empty
			vi.spyOn(summarizer as never, "extractCandidateKeywords").mockReturnValue([] as never);

			const topics = await summarizer.extractTopics("the is a an on");

			expect(topics).toEqual([]);
		});

		it("should limit topics to maxTopics config", async () => {
			const summarizer = new SessionSummarizer(mockLLM, { maxTopics: 3 });

			// Mock keyword extraction
			const candidates = ["topic1", "topic2", "topic3", "topic4", "topic5"];
			vi.spyOn(summarizer as never, "extractCandidateKeywords").mockReturnValue(
				candidates as never,
			);

			// Mock embeddings with varying similarities
			vi.spyOn(summarizer as never, "loadKeywordPipeline").mockResolvedValue(((texts: string[]) =>
				Promise.resolve(
					texts.map((_, i) => ({
						data: new Float32Array(384).fill(1 - i * 0.1),
					})),
				)) as never);

			const topics = await summarizer.extractTopics("some text");

			expect(topics.length).toBeLessThanOrEqual(3);
		});
	});
});

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type ConflictCandidate,
	ConflictDetectorService,
	ConflictRelation,
} from "./conflict-detector";

describe("ConflictDetectorService", () => {
	let service: ConflictDetectorService;
	let mockServer: McpServer;
	let mockLogger: Logger;

	beforeEach(() => {
		// Mock MCP server
		mockServer = {
			server: {
				getClientCapabilities: mock(() => ({ sampling: false })),
				createMessage: mock(() => Promise.resolve(null)),
			},
		} as unknown as McpServer;

		// Mock logger
		mockLogger = {
			debug: mock(() => {}),
			info: mock(() => {}),
			warn: mock(() => {}),
			error: mock(() => {}),
		} as unknown as Logger;

		service = new ConflictDetectorService(mockServer, mockLogger, "test-api-key");
	});

	// Note: We don't call mock.restore() because it affects module-level mocks
	// from the preload and can break parallel test files. Each beforeEach creates
	// fresh mocks, so cleanup isn't needed for test isolation within this file.

	describe("parseResponse", () => {
		const newMemory = { content: "User prefers tabs", type: "preference" };
		const candidate: ConflictCandidate = {
			memoryId: "test-123",
			content: "User prefers spaces",
			type: "preference",
			vt_start: Date.now(),
			vt_end: Number.POSITIVE_INFINITY,
			similarity: 0.85,
		};

		it("should parse valid JSON response", () => {
			const validJson = JSON.stringify({
				relation: "contradiction",
				confidence: 0.9,
				reasoning: "Tabs vs spaces is a direct contradiction",
				suggestedAction: "invalidate_old",
			});

			const result = service.parseResponse(validJson, newMemory, candidate);

			expect(result.relation).toBe(ConflictRelation.CONTRADICTION);
			expect(result.confidence).toBe(0.9);
			expect(result.reasoning).toBe("Tabs vs spaces is a direct contradiction");
			expect(result.suggestedAction).toBe("invalidate_old");
			expect(result.newMemory).toEqual(newMemory);
			expect(result.candidate).toEqual(candidate);
		});

		it("should parse JSON from markdown code block", () => {
			const markdownJson = `\`\`\`json
{
  "relation": "supersedes",
  "confidence": 0.85,
  "reasoning": "New preference replaces old",
  "suggestedAction": "invalidate_old"
}
\`\`\``;

			const result = service.parseResponse(markdownJson, newMemory, candidate);

			expect(result.relation).toBe(ConflictRelation.SUPERSEDES);
			expect(result.confidence).toBe(0.85);
			expect(result.suggestedAction).toBe("invalidate_old");
		});

		it("should parse JSON from markdown code block without language tag", () => {
			const markdownJson = `\`\`\`
{
  "relation": "duplicate",
  "confidence": 0.95,
  "reasoning": "Same content",
  "suggestedAction": "skip_new"
}
\`\`\``;

			const result = service.parseResponse(markdownJson, newMemory, candidate);

			expect(result.relation).toBe(ConflictRelation.DUPLICATE);
			expect(result.confidence).toBe(0.95);
			expect(result.suggestedAction).toBe("skip_new");
		});

		it("should clamp confidence to [0, 1] range", () => {
			const invalidConfidence = JSON.stringify({
				relation: "independent",
				confidence: 1.5, // Out of range
				reasoning: "Unrelated facts",
				suggestedAction: "keep_both",
			});

			const result = service.parseResponse(invalidConfidence, newMemory, candidate);

			expect(result.confidence).toBe(1.0); // Clamped to 1
		});

		it("should clamp negative confidence to 0", () => {
			const negativeConfidence = JSON.stringify({
				relation: "augments",
				confidence: -0.2,
				reasoning: "Complementary info",
				suggestedAction: "keep_both",
			});

			const result = service.parseResponse(negativeConfidence, newMemory, candidate);

			expect(result.confidence).toBe(0); // Clamped to 0
		});

		it("should return default INDEPENDENT for invalid JSON", () => {
			const invalidJson = "This is not JSON at all";

			const result = service.parseResponse(invalidJson, newMemory, candidate);

			expect(result.relation).toBe(ConflictRelation.INDEPENDENT);
			expect(result.confidence).toBe(0.5);
			expect(result.reasoning).toBe("Failed to parse LLM response");
			expect(result.suggestedAction).toBe("keep_both");
		});

		it("should return default for missing required fields", () => {
			const missingFields = JSON.stringify({
				relation: "contradiction",
				// Missing confidence, reasoning, suggestedAction
			});

			const result = service.parseResponse(missingFields, newMemory, candidate);

			expect(result.relation).toBe(ConflictRelation.INDEPENDENT);
			expect(result.confidence).toBe(0.5);
			expect(result.suggestedAction).toBe("keep_both");
		});

		it("should return default for invalid relation enum", () => {
			const invalidRelation = JSON.stringify({
				relation: "completely_different", // Invalid enum value
				confidence: 0.8,
				reasoning: "Test",
				suggestedAction: "keep_both",
			});

			const result = service.parseResponse(invalidRelation, newMemory, candidate);

			expect(result.relation).toBe(ConflictRelation.INDEPENDENT);
		});

		it("should return default for invalid suggestedAction enum", () => {
			const invalidAction = JSON.stringify({
				relation: "contradiction",
				confidence: 0.8,
				reasoning: "Test",
				suggestedAction: "delete_everything", // Invalid enum value
			});

			const result = service.parseResponse(invalidAction, newMemory, candidate);

			expect(result.suggestedAction).toBe("keep_both");
		});
	});

	describe("buildPrompt", () => {
		it("should generate correct prompt format", () => {
			const newMemory = { content: "Use TypeScript for new services", type: "decision" };
			const candidate: ConflictCandidate = {
				memoryId: "old-123",
				content: "Use JavaScript for new services",
				type: "decision",
				vt_start: 1640000000000,
				vt_end: Number.POSITIVE_INFINITY,
				similarity: 0.88,
			};

			const prompt = service.buildPrompt(newMemory, candidate);

			// Check all key sections are present
			expect(prompt).toContain("NEW MEMORY:");
			expect(prompt).toContain("Type: decision");
			expect(prompt).toContain("Content: Use TypeScript for new services");

			expect(prompt).toContain("EXISTING MEMORY:");
			expect(prompt).toContain("Type: decision");
			expect(prompt).toContain("Content: Use JavaScript for new services");
			expect(prompt).toContain("Created:");
			expect(prompt).toContain("2021-12-20"); // Check date is present (timezone agnostic)
			expect(prompt).toContain("Similarity Score: 0.88");

			// Check relationship types are documented
			expect(prompt).toContain("contradiction:");
			expect(prompt).toContain("supersedes:");
			expect(prompt).toContain("augments:");
			expect(prompt).toContain("duplicate:");
			expect(prompt).toContain("independent:");

			// Check suggested actions are documented
			expect(prompt).toContain("keep_both:");
			expect(prompt).toContain("invalidate_old:");
			expect(prompt).toContain("skip_new:");
			expect(prompt).toContain("merge:");

			// Check JSON schema is included
			expect(prompt).toContain('"relation":');
			expect(prompt).toContain('"confidence":');
			expect(prompt).toContain('"reasoning":');
			expect(prompt).toContain('"suggestedAction":');
		});
	});

	describe("detectConflicts - classification accuracy", () => {
		it("should classify preference change as SUPERSEDES", async () => {
			const newMemory = { content: "User prefers tabs for indentation", type: "preference" };
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "pref-old",
					content: "User prefers spaces for indentation",
					type: "preference",
					vt_start: Date.now() - 86400000,
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.92,
				},
			];

			// Mock classifyWithGemini to return controlled response
			service.classifyWithGemini = mock(() =>
				Promise.resolve(
					JSON.stringify({
						relation: "supersedes",
						confidence: 0.95,
						reasoning: "User changed their indentation preference from spaces to tabs",
						suggestedAction: "invalidate_old",
					}),
				),
			);

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.SUPERSEDES);
			expect(results[0].suggestedAction).toBe("invalidate_old");
			expect(results[0].confidence).toBeGreaterThan(0.9);
		});

		it("should classify fact update as SUPERSEDES", async () => {
			const newMemory = {
				content: "API rate limit is 1000 requests per minute",
				type: "fact",
			};
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "fact-old",
					content: "API rate limit is 100 requests per minute",
					type: "fact",
					vt_start: Date.now() - 172800000,
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.89,
				},
			];

			service.classifyWithGemini = mock(() =>
				Promise.resolve(
					JSON.stringify({
						relation: "supersedes",
						confidence: 0.92,
						reasoning: "Updated rate limit replaces old value",
						suggestedAction: "invalidate_old",
					}),
				),
			);

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.SUPERSEDES);
			expect(results[0].suggestedAction).toBe("invalidate_old");
		});

		it("should classify direct contradiction as CONTRADICTION", async () => {
			const newMemory = { content: "Feature X is enabled by default", type: "fact" };
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "fact-contradiction",
					content: "Feature X is disabled by default",
					type: "fact",
					vt_start: Date.now() - 3600000,
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.87,
				},
			];

			service.classifyWithGemini = mock(() =>
				Promise.resolve(
					JSON.stringify({
						relation: "contradiction",
						confidence: 0.98,
						reasoning: "Enabled vs disabled are mutually exclusive states",
						suggestedAction: "invalidate_old",
					}),
				),
			);

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.CONTRADICTION);
			expect(results[0].suggestedAction).toBe("invalidate_old");
		});

		it("should classify complementary information as AUGMENTS", async () => {
			const newMemory = {
				content: "Database uses connection pooling with max 20 connections",
				type: "fact",
			};
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "fact-related",
					content: "Database is PostgreSQL 14",
					type: "fact",
					vt_start: Date.now() - 7200000,
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.75,
				},
			];

			service.classifyWithGemini = mock(() =>
				Promise.resolve(
					JSON.stringify({
						relation: "augments",
						confidence: 0.88,
						reasoning: "New fact adds connection pooling details to database configuration",
						suggestedAction: "keep_both",
					}),
				),
			);

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.AUGMENTS);
			expect(results[0].suggestedAction).toBe("keep_both");
		});

		it("should classify duplicate content as DUPLICATE", async () => {
			const newMemory = {
				content: "Always run tests before committing code",
				type: "preference",
			};
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "pref-dup",
					content: "User prefers to run tests before committing",
					type: "preference",
					vt_start: Date.now() - 1800000,
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.94,
				},
			];

			service.classifyWithGemini = mock(() =>
				Promise.resolve(
					JSON.stringify({
						relation: "duplicate",
						confidence: 0.96,
						reasoning: "Both memories express the same preference about running tests",
						suggestedAction: "skip_new",
					}),
				),
			);

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.DUPLICATE);
			expect(results[0].suggestedAction).toBe("skip_new");
		});

		it("should classify unrelated facts as INDEPENDENT", async () => {
			const newMemory = {
				content: "User's favorite color is blue",
				type: "preference",
			};
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "pref-unrelated",
					content: "User prefers TypeScript over JavaScript",
					type: "preference",
					vt_start: Date.now() - 86400000,
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.45,
				},
			];

			service.classifyWithGemini = mock(() =>
				Promise.resolve(
					JSON.stringify({
						relation: "independent",
						confidence: 0.99,
						reasoning: "Color preference and programming language preference are orthogonal",
						suggestedAction: "keep_both",
					}),
				),
			);

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.INDEPENDENT);
			expect(results[0].suggestedAction).toBe("keep_both");
		});
	});

	describe("detectConflicts - error handling", () => {
		it("should return empty array for no candidates", async () => {
			const newMemory = { content: "Test memory", type: "fact" };
			const results = await service.detectConflicts(newMemory, []);

			expect(results).toHaveLength(0);
		});

		it("should default to INDEPENDENT on classification failure", async () => {
			const newMemory = { content: "Test memory", type: "fact" };
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "fail-123",
					content: "Another memory",
					type: "fact",
					vt_start: Date.now(),
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.8,
				},
			];

			// Mock classifyWithGemini to throw an error
			service.classifyWithGemini = mock(() => Promise.reject(new Error("API Error")));

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(1);
			expect(results[0].relation).toBe(ConflictRelation.INDEPENDENT);
			expect(results[0].confidence).toBe(0.5);
			expect(results[0].suggestedAction).toBe("keep_both");
			expect(results[0].reasoning).toContain("Classification failed");
		});

		it("should handle multiple candidates sequentially", async () => {
			const newMemory = { content: "Test memory", type: "fact" };
			const candidates: ConflictCandidate[] = [
				{
					memoryId: "cand-1",
					content: "Memory 1",
					type: "fact",
					vt_start: Date.now(),
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.9,
				},
				{
					memoryId: "cand-2",
					content: "Memory 2",
					type: "fact",
					vt_start: Date.now(),
					vt_end: Number.POSITIVE_INFINITY,
					similarity: 0.85,
				},
			];

			let callCount = 0;
			const mockClassify = mock(() => {
				callCount++;
				const relation = callCount === 1 ? "duplicate" : "independent";
				return Promise.resolve(
					JSON.stringify({
						relation,
						confidence: 0.9,
						reasoning: `Classification ${callCount}`,
						suggestedAction: callCount === 1 ? "skip_new" : "keep_both",
					}),
				);
			});
			service.classifyWithGemini = mockClassify;

			const results = await service.detectConflicts(newMemory, candidates);

			expect(results).toHaveLength(2);
			expect(results[0].relation).toBe(ConflictRelation.DUPLICATE);
			expect(results[1].relation).toBe(ConflictRelation.INDEPENDENT);
			expect(mockClassify).toHaveBeenCalledTimes(2);
		});
	});

	describe("tryWithSampling", () => {
		it("should return null when sampling is not available", async () => {
			const prompt = "Test prompt";
			const result = await service.tryWithSampling(prompt, mockServer);

			expect(result).toBeNull();
		});

		it("should use MCP sampling when available", async () => {
			const prompt = "Test prompt";
			const mockServerWithSampling = {
				server: {
					getClientCapabilities: mock(() => ({ sampling: true })),
					createMessage: mock(() =>
						Promise.resolve({
							content: {
								type: "text",
								text: JSON.stringify({
									relation: "independent",
									confidence: 0.8,
									reasoning: "Test",
									suggestedAction: "keep_both",
								}),
							},
						}),
					),
				},
			} as unknown as McpServer;

			const result = await service.tryWithSampling(prompt, mockServerWithSampling);

			expect(result).toBeTruthy();
			expect(result).toContain("independent");
		});

		it("should return null on sampling failure", async () => {
			const prompt = "Test prompt";
			const mockServerWithSampling = {
				server: {
					getClientCapabilities: mock(() => ({ sampling: true })),
					createMessage: mock(() => Promise.reject(new Error("Sampling failed"))),
				},
			} as unknown as McpServer;

			const result = await service.tryWithSampling(prompt, mockServerWithSampling);

			expect(result).toBeNull();
		});
	});

	describe("classifyWithGemini", () => {
		it("should return JSON stringified response from Gemini client", async () => {
			const prompt = "Test classification prompt";
			const expectedResult = {
				relation: "independent",
				confidence: 0.8,
				reasoning: "Test reasoning",
				suggestedAction: "keep_both",
			};

			// Access private geminiClient and mock its method
			const geminiClient = (service as any).geminiClient;
			geminiClient.generateStructuredOutput = mock(() => Promise.resolve(expectedResult));

			const result = await service.classifyWithGemini(prompt);

			expect(geminiClient.generateStructuredOutput).toHaveBeenCalledTimes(1);
			expect(JSON.parse(result)).toEqual(expectedResult);
		});

		it("should throw error when API key is missing", async () => {
			// Save and clear environment variable
			const originalApiKey = process.env.GEMINI_API_KEY;
			delete process.env.GEMINI_API_KEY;

			const serviceWithoutKey = new ConflictDetectorService(mockServer, mockLogger);
			const prompt = "Test prompt";

			await expect(serviceWithoutKey.classifyWithGemini(prompt)).rejects.toThrow(
				"GEMINI_API_KEY not configured",
			);

			// Restore environment variable
			if (originalApiKey) {
				process.env.GEMINI_API_KEY = originalApiKey;
			}
		});

		it("should propagate errors from Gemini client", async () => {
			const prompt = "Test prompt";

			// Access private geminiClient and mock its method to throw
			const geminiClient = (service as any).geminiClient;
			geminiClient.generateStructuredOutput = mock(() =>
				Promise.reject(new Error("Gemini API request failed: Unauthorized")),
			);

			await expect(service.classifyWithGemini(prompt)).rejects.toThrow("Gemini API request failed");
		});
	});
});

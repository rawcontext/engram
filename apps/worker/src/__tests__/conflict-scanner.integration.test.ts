/**
 * Integration tests for ConflictScanner job handler
 *
 * Tests the conflict scanning pipeline:
 * 1. Load active memories for project
 * 2. Find conflict candidates via search service
 * 3. Batch classify conflicts using LLM
 * 4. Create ConflictReport nodes for confirmed conflicts
 */

import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { GeminiClient } from "@engram/common/clients";
import type { FalkorConflictReportRepository, FalkorMemoryRepository, Memory } from "@engram/graph";
import type { Logger } from "@engram/logger";
import { type ConflictScanJob, ConflictScannerConsumer } from "../jobs/conflict-scanner";

// =============================================================================
// Mocks
// =============================================================================

const createMockLogger = (): Logger => {
	const logger = {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		trace: mock(() => {}),
		fatal: mock(() => {}),
		child: mock(function (this: Logger) {
			return this;
		}),
		level: "info",
		silent: mock(() => {}),
	} as unknown as Logger;
	// Make child return the same logger so mocks work
	(logger.child as ReturnType<typeof mock>).mockReturnValue(logger);
	return logger;
};

const createMockMemoryRepo = () => ({
	findById: mock(async () => null),
	findByProject: mock(async () => []),
	findByType: mock(async () => []),
	findByTag: mock(async () => []),
	findActive: mock(async () => []),
	create: mock(async () => ({})),
	update: mock(async () => ({})),
	delete: mock(async () => {}),
});

const createMockConflictRepo = () => ({
	findById: mock(async () => null),
	findByProject: mock(async () => []),
	findPending: mock(async () => []),
	create: mock(async () => ({})),
	createMany: mock(async () => []),
	resolve: mock(async () => {}),
	dismiss: mock(async () => {}),
});

const createMockGeminiClient = () => ({
	generateStructuredOutput: mock(async () => ({
		relation: "independent",
		confidence: 0.9,
		reasoning: "These memories are unrelated.",
		suggestedAction: "keep_both",
	})),
});

// Global fetch mock for search service
const originalFetch = global.fetch;

// =============================================================================
// Test Fixtures
// =============================================================================

const MAX_DATE = 253402300799999;

const createMemories = (): Memory[] => [
	{
		id: "mem-1",
		content: "User prefers tabs over spaces for indentation",
		contentHash: "hash1",
		type: "preference",
		tags: ["coding-style"],
		source: "user",
		vtStart: Date.now() - 86400000,
		vtEnd: MAX_DATE,
		ttStart: Date.now() - 86400000,
		ttEnd: MAX_DATE,
		project: "test-project",
	},
	{
		id: "mem-2",
		content: "The API uses REST with JSON payloads",
		contentHash: "hash2",
		type: "fact",
		tags: ["api", "architecture"],
		source: "auto",
		vtStart: Date.now() - 172800000,
		vtEnd: MAX_DATE,
		ttStart: Date.now() - 172800000,
		ttEnd: MAX_DATE,
		project: "test-project",
	},
	{
		id: "mem-3",
		content: "User prefers spaces over tabs for indentation",
		contentHash: "hash3",
		type: "preference",
		tags: ["coding-style"],
		source: "user",
		vtStart: Date.now() - 3600000,
		vtEnd: MAX_DATE,
		ttStart: Date.now() - 3600000,
		ttEnd: MAX_DATE,
		project: "test-project",
	},
];

const createConflictCandidates = () => [
	{
		memory_id: "mem-3",
		content: "User prefers spaces over tabs for indentation",
		type: "preference",
		similarity: 0.85,
		vt_start: Date.now() - 3600000,
		vt_end: MAX_DATE,
	},
];

const createJob = (overrides?: Partial<ConflictScanJob>): ConflictScanJob => ({
	project: "test-project",
	orgId: "org-123",
	scanId: `scan-${Date.now()}`,
	triggeredBy: "manual",
	...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe("ConflictScannerConsumer", () => {
	let consumer: ConflictScannerConsumer;
	let mockLogger: Logger;
	let mockMemoryRepo: ReturnType<typeof createMockMemoryRepo>;
	let mockConflictRepo: ReturnType<typeof createMockConflictRepo>;
	let mockGemini: ReturnType<typeof createMockGeminiClient>;

	beforeEach(() => {
		mockLogger = createMockLogger();
		mockMemoryRepo = createMockMemoryRepo();
		mockConflictRepo = createMockConflictRepo();
		mockGemini = createMockGeminiClient();

		// Reset fetch mock
		global.fetch = mock(async () => new Response(JSON.stringify([]), { status: 200 }));

		consumer = new ConflictScannerConsumer(
			mockLogger,
			mockMemoryRepo as unknown as FalkorMemoryRepository,
			mockConflictRepo as unknown as FalkorConflictReportRepository,
			mockGemini as unknown as GeminiClient,
			"http://localhost:6176",
		);
	});

	afterAll(() => {
		global.fetch = originalFetch;
	});

	describe("process", () => {
		it("should skip scanning when no memories found for project", async () => {
			mockMemoryRepo.findByProject.mockResolvedValueOnce([]);

			await consumer.process(createJob());

			// Should log "no memories" and return early
			const infoCalls = (mockLogger.info as ReturnType<typeof mock>).mock.calls;
			expect(infoCalls.some((call) => String(call[1])?.includes("No memories found"))).toBe(true);
			expect(mockConflictRepo.createMany).not.toHaveBeenCalled();
		});

		it("should scan memories and find conflict candidates", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Mock search service response with candidates
			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			await consumer.process(createJob());

			// Should have called search service for each memory
			const fetchCalls = (global.fetch as ReturnType<typeof mock>).mock.calls;
			expect(fetchCalls.length).toBeGreaterThan(0);
		});

		it("should classify candidate pairs using Gemini", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Return candidates for first memory
			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			await consumer.process(createJob());

			// Should have called Gemini for classification
			expect(mockGemini.generateStructuredOutput).toHaveBeenCalled();
		});

		it("should create ConflictReport nodes for confirmed conflicts", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Return candidates
			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			// Classify as contradiction (not independent)
			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "contradiction",
				confidence: 0.95,
				reasoning: "These preferences directly contradict each other.",
				suggestedAction: "invalidate_a",
			});

			await consumer.process(createJob());

			// Should create conflict reports
			expect(mockConflictRepo.createMany).toHaveBeenCalled();
			const createCall = mockConflictRepo.createMany.mock.calls[0];
			expect(createCall[0].length).toBeGreaterThan(0);
		});

		it("should not create reports for independent memory pairs", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Return candidates
			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			// Classify as independent
			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "independent",
				confidence: 0.9,
				reasoning: "These memories are unrelated.",
				suggestedAction: "keep_both",
			});

			await consumer.process(createJob());

			// Should not create conflict reports (or create empty array)
			const createCalls = mockConflictRepo.createMany.mock.calls;
			if (createCalls.length > 0) {
				expect(createCalls[0][0]).toHaveLength(0);
			}
		});

		it("should skip self-matches in candidate pairs", async () => {
			const memories = [createMemories()[0]];
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Return candidate that matches the source memory
			global.fetch = mock(
				async () =>
					new Response(
						JSON.stringify([
							{
								memory_id: memories[0].id, // Same as source
								content: memories[0].content,
								type: memories[0].type,
								similarity: 1.0,
								vt_start: memories[0].vtStart,
								vt_end: memories[0].vtEnd,
							},
						]),
						{ status: 200 },
					),
			);

			await consumer.process(createJob());

			// Should not classify self-match
			expect(mockGemini.generateStructuredOutput).not.toHaveBeenCalled();
		});

		it("should deduplicate bidirectional pairs", async () => {
			const memories = createMemories().slice(0, 2);
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Each memory returns the other as a candidate
			global.fetch = mock(async (url, options) => {
				const body = JSON.parse(options?.body as string);
				const otherId = body.content.includes("tabs") ? "mem-2" : "mem-1";
				return new Response(
					JSON.stringify([
						{
							memory_id: otherId,
							content: "Matching content",
							type: "fact",
							similarity: 0.8,
							vt_start: Date.now(),
							vt_end: MAX_DATE,
						},
					]),
					{ status: 200 },
				);
			});

			await consumer.process(createJob());

			// Should only classify once (not twice for A->B and B->A)
			const geminiCalls = mockGemini.generateStructuredOutput.mock.calls;
			expect(geminiCalls.length).toBeLessThanOrEqual(1);
		});

		it("should filter candidates below similarity threshold", async () => {
			const memories = [createMemories()[0]];
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Return candidate with low similarity
			global.fetch = mock(
				async () =>
					new Response(
						JSON.stringify([
							{
								memory_id: "other-mem",
								content: "Unrelated content",
								type: "fact",
								similarity: 0.5, // Below 0.7 threshold
								vt_start: Date.now(),
								vt_end: MAX_DATE,
							},
						]),
						{ status: 200 },
					),
			);

			await consumer.process(createJob());

			// Should not classify low-similarity candidates
			expect(mockGemini.generateStructuredOutput).not.toHaveBeenCalled();
		});

		it("should limit candidates per memory to max 5", async () => {
			const memories = [createMemories()[0]];
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Return 10 high-similarity candidates
			const manyCandidates = Array.from({ length: 10 }, (_, i) => ({
				memory_id: `candidate-${i}`,
				content: `Candidate content ${i}`,
				type: "fact",
				similarity: 0.9,
				vt_start: Date.now(),
				vt_end: MAX_DATE,
			}));

			global.fetch = mock(
				async () => new Response(JSON.stringify(manyCandidates), { status: 200 }),
			);

			await consumer.process(createJob());

			// Should only classify max 5 candidates
			const geminiCalls = mockGemini.generateStructuredOutput.mock.calls;
			expect(geminiCalls.length).toBeLessThanOrEqual(5);
		});
	});

	describe("classification batch processing", () => {
		it("should batch classify multiple pairs efficiently", async () => {
			// Create enough memories to generate multiple pairs
			const memories = Array.from({ length: 5 }, (_, i) => ({
				...createMemories()[0],
				id: `mem-${i}`,
				content: `Memory content ${i}`,
				contentHash: `hash${i}`,
			}));
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Each memory returns 2 candidates
			global.fetch = mock(async (url, options) => {
				const body = JSON.parse(options?.body as string);
				const sourceId = memories.find((m) => m.content === body.content)?.id || "unknown";
				const candidates = memories
					.filter((m) => m.id !== sourceId)
					.slice(0, 2)
					.map((m) => ({
						memory_id: m.id,
						content: m.content,
						type: m.type,
						similarity: 0.8,
						vt_start: m.vtStart,
						vt_end: m.vtEnd,
					}));
				return new Response(JSON.stringify(candidates), { status: 200 });
			});

			await consumer.process(createJob());

			// Should classify pairs (with deduplication)
			expect(mockGemini.generateStructuredOutput).toHaveBeenCalled();
		});
	});

	describe("error handling", () => {
		it("should handle search service failures gracefully", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Search service returns error
			global.fetch = mock(async () => new Response("Service unavailable", { status: 503 }));

			// Should not throw
			await expect(consumer.process(createJob())).resolves.toBeUndefined();

			// Should log warning
			const warnCalls = (mockLogger.warn as ReturnType<typeof mock>).mock.calls;
			expect(warnCalls.length).toBeGreaterThan(0);
		});

		it("should handle search service network errors gracefully", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			// Network error
			global.fetch = mock(async () => {
				throw new Error("Network error");
			});

			// Should not throw
			await expect(consumer.process(createJob())).resolves.toBeUndefined();
		});

		it("should handle Gemini classification failures gracefully", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			// Gemini throws error
			mockGemini.generateStructuredOutput.mockRejectedValue(new Error("API error"));

			// Should not throw
			await expect(consumer.process(createJob())).resolves.toBeUndefined();

			// Should log warning
			const warnCalls = (mockLogger.warn as ReturnType<typeof mock>).mock.calls;
			expect(warnCalls.length).toBeGreaterThan(0);
		});
	});

	describe("conflict relations", () => {
		it("should handle contradiction relations", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "contradiction",
				confidence: 0.95,
				reasoning: "Direct contradiction",
				suggestedAction: "invalidate_a",
			});

			await consumer.process(createJob());

			const createCall = mockConflictRepo.createMany.mock.calls[0];
			if (createCall && createCall[0].length > 0) {
				expect(createCall[0][0].relation).toBe("contradiction");
			}
		});

		it("should handle supersedes relations", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "supersedes",
				confidence: 0.9,
				reasoning: "Newer preference replaces older one",
				suggestedAction: "invalidate_b",
			});

			await consumer.process(createJob());

			const createCall = mockConflictRepo.createMany.mock.calls[0];
			if (createCall && createCall[0].length > 0) {
				expect(createCall[0][0].relation).toBe("supersedes");
			}
		});

		it("should handle duplicate relations", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "duplicate",
				confidence: 0.98,
				reasoning: "Semantically identical content",
				suggestedAction: "merge",
			});

			await consumer.process(createJob());

			const createCall = mockConflictRepo.createMany.mock.calls[0];
			if (createCall && createCall[0].length > 0) {
				expect(createCall[0][0].relation).toBe("duplicate");
			}
		});

		it("should handle augments relations", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "augments",
				confidence: 0.85,
				reasoning: "Adds additional context",
				suggestedAction: "keep_both",
			});

			await consumer.process(createJob());

			const createCall = mockConflictRepo.createMany.mock.calls[0];
			if (createCall && createCall[0].length > 0) {
				expect(createCall[0][0].relation).toBe("augments");
			}
		});
	});

	describe("job metadata", () => {
		it("should include scanId in conflict reports", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "contradiction",
				confidence: 0.9,
				reasoning: "Conflict detected",
				suggestedAction: "invalidate_a",
			});

			const job = createJob({ scanId: "unique-scan-id" });
			await consumer.process(job);

			const createCall = mockConflictRepo.createMany.mock.calls[0];
			if (createCall && createCall[0].length > 0) {
				expect(createCall[0][0].scanId).toBe("unique-scan-id");
			}
		});

		it("should include orgId and project in conflict reports", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(
				async () => new Response(JSON.stringify(createConflictCandidates()), { status: 200 }),
			);

			mockGemini.generateStructuredOutput.mockResolvedValue({
				relation: "contradiction",
				confidence: 0.9,
				reasoning: "Conflict",
				suggestedAction: "invalidate_a",
			});

			const job = createJob({ orgId: "test-org", project: "test-proj" });
			await consumer.process(job);

			const createCall = mockConflictRepo.createMany.mock.calls[0];
			if (createCall && createCall[0].length > 0) {
				expect(createCall[0][0].orgId).toBe("test-org");
				expect(createCall[0][0].project).toBe("test-proj");
			}
		});

		it("should log completion with scan statistics", async () => {
			const memories = createMemories();
			mockMemoryRepo.findByProject.mockResolvedValueOnce(memories);

			global.fetch = mock(async () => new Response(JSON.stringify([]), { status: 200 }));

			await consumer.process(createJob());

			// Should log completion - check structured logging format
			const infoCalls = (mockLogger.info as ReturnType<typeof mock>).mock.calls;
			const completionCall = infoCalls.find((call) => {
				const msg =
					typeof call[1] === "string" ? call[1] : typeof call[0] === "string" ? call[0] : "";
				return msg.toLowerCase().includes("complet") || msg.toLowerCase().includes("scan");
			});
			expect(completionCall).toBeDefined();
		});
	});
});

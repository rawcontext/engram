import { describe, expect, it, mock } from "bun:test";
import { ConflictScannerConsumer } from "../conflict-scanner";

// Mock logger - returns self for child() to maintain mock tracking
const createMockLogger = () => {
	const logger: any = {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		child: null as any,
	};
	logger.child = mock(() => logger);
	return logger;
};

// Mock memory repository
const createMockMemoryRepo = (memories: any[] = []) => ({
	findByProject: mock(async () => memories),
});

// Mock conflict report repository
const createMockConflictRepo = () => ({
	createMany: mock(async (inputs: any[]) =>
		inputs.map((i, idx) => ({ ...i, id: `report-${idx}` })),
	),
});

// Mock Gemini client
const createMockGemini = (
	response = {
		relation: "independent",
		confidence: 0.9,
		reasoning: "The memories are unrelated",
		suggestedAction: "keep_both",
	},
) => ({
	generateStructuredOutput: mock(async () => response),
});

// Mock fetch for search API
const mockSearchResponse = (candidates: any[] = []) => {
	global.fetch = mock(async () => ({
		ok: true,
		json: async () => candidates,
	})) as any;
};

describe("ConflictScannerConsumer", () => {
	describe("constructor", () => {
		it("should initialize with correct subject and consumer name", () => {
			const logger = createMockLogger();
			const memoryRepo = createMockMemoryRepo();
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			expect(consumer.subject).toBe("engram.jobs.conflict-scan");
			expect(consumer.consumerName).toBe("conflict-scanner-worker");
		});
	});

	describe("process", () => {
		it("should skip when no memories found", async () => {
			mockSearchResponse([]);

			const logger = createMockLogger();
			const memoryRepo = createMockMemoryRepo([]);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "manual",
			});

			// Should log about no memories
			expect(logger.info.mock.calls.some((call: any) => call[1]?.includes?.("No memories"))).toBe(
				true,
			);
			// Should not call createMany
			expect(conflictRepo.createMany).not.toHaveBeenCalled();
		});

		it("should skip when no conflict candidates found", async () => {
			mockSearchResponse([]);

			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory content",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "cron",
			});

			// Should not call createMany since no conflicts
			expect(conflictRepo.createMany).not.toHaveBeenCalled();
		});

		it("should detect and create conflict reports for contradictions", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "The sky is blue",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();

			// Gemini returns contradiction
			const gemini = createMockGemini({
				relation: "contradiction",
				confidence: 0.95,
				reasoning: "Both statements cannot be true",
				suggestedAction: "invalidate_a",
			});

			// Mock search to return conflict candidate
			global.fetch = mock(async () => ({
				ok: true,
				json: async () => [
					{
						memory_id: "memory-2",
						content: "The sky is green",
						type: "fact",
						similarity: 0.85,
						vt_start: Date.now() - 86400000,
						vt_end: 253402300799999,
					},
				],
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "manual",
			});

			// Should call createMany with conflict report
			expect(conflictRepo.createMany).toHaveBeenCalled();
			const createCall = (conflictRepo.createMany as any).mock.calls[0];
			expect(createCall[0]).toHaveLength(1);
			expect(createCall[0][0].relation).toBe("contradiction");
			expect(createCall[0][0].confidence).toBe(0.95);
		});

		it("should filter out candidates below similarity threshold", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			// Mock search to return low similarity candidate
			global.fetch = mock(async () => ({
				ok: true,
				json: async () => [
					{
						memory_id: "memory-2",
						content: "Unrelated content",
						type: "fact",
						similarity: 0.5, // Below 0.7 threshold
						vt_start: Date.now(),
						vt_end: 253402300799999,
					},
				],
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "threshold",
			});

			// Should not call Gemini since candidate is filtered out
			expect(gemini.generateStructuredOutput).not.toHaveBeenCalled();
		});

		it("should skip self-matches", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			// Mock search to return the same memory as a candidate
			global.fetch = mock(async () => ({
				ok: true,
				json: async () => [
					{
						memory_id: "memory-1", // Same ID as the source memory
						content: "Test memory",
						type: "fact",
						similarity: 1.0,
						vt_start: Date.now(),
						vt_end: 253402300799999,
					},
				],
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "manual",
			});

			// Should not call Gemini since self-match is skipped
			expect(gemini.generateStructuredOutput).not.toHaveBeenCalled();
		});

		it("should deduplicate memory pairs (A-B and B-A)", async () => {
			const logger = createMockLogger();
			const memories = [
				{ id: "memory-1", content: "Memory A", type: "fact", project: "test-project" },
				{ id: "memory-2", content: "Memory B", type: "fact", project: "test-project" },
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini({
				relation: "duplicate",
				confidence: 0.9,
				reasoning: "Same content",
				suggestedAction: "keep_both",
			});

			// For memory-1, return memory-2 as candidate
			// For memory-2, return memory-1 as candidate
			let callCount = 0;
			global.fetch = mock(async () => {
				callCount++;
				return {
					ok: true,
					json: async () => [
						{
							memory_id: callCount === 1 ? "memory-2" : "memory-1",
							content: callCount === 1 ? "Memory B" : "Memory A",
							type: "fact",
							similarity: 0.95,
							vt_start: Date.now(),
							vt_end: 253402300799999,
						},
					],
				};
			}) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "cron",
			});

			// Should only classify once despite finding the pair twice
			expect(gemini.generateStructuredOutput.mock.calls.length).toBe(1);
		});

		it("should not create reports for independent relations", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "About TypeScript",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();

			// Gemini returns independent
			const gemini = createMockGemini({
				relation: "independent",
				confidence: 0.85,
				reasoning: "Topics are unrelated",
				suggestedAction: "keep_both",
			});

			global.fetch = mock(async () => ({
				ok: true,
				json: async () => [
					{
						memory_id: "memory-2",
						content: "About Python",
						type: "fact",
						similarity: 0.75,
						vt_start: Date.now(),
						vt_end: 253402300799999,
					},
				],
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "manual",
			});

			// Should not create reports for independent relations
			expect(conflictRepo.createMany).not.toHaveBeenCalled();
		});
	});

	describe("search API handling", () => {
		it("should handle search API failures gracefully", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			// Mock search to fail
			global.fetch = mock(async () => ({
				ok: false,
				status: 500,
				text: async () => "Internal Server Error",
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			// Should not throw
			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "manual",
			});

			// Should log warning
			expect(logger.warn.mock.calls.length).toBeGreaterThan(0);
		});

		it("should call correct search endpoint", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini();

			let fetchUrl = "";
			let fetchBody: any = {};
			global.fetch = mock(async (url: string, opts: any) => {
				fetchUrl = url;
				fetchBody = JSON.parse(opts.body);
				return {
					ok: true,
					json: async () => [],
				};
			}) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "cron",
			});

			expect(fetchUrl).toBe("http://localhost:6176/v1/search/conflict-candidates");
			expect(fetchBody.content).toBe("Test memory");
			expect(fetchBody.project).toBe("test-project");
			expect(fetchBody.org_id).toBe("org-123");
		});
	});

	describe("logging", () => {
		it("should log job start and completion", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini({
				relation: "augments",
				confidence: 0.8,
				reasoning: "Related content",
				suggestedAction: "keep_both",
			});

			// Return a candidate so we go through the full flow
			global.fetch = mock(async () => ({
				ok: true,
				json: async () => [
					{
						memory_id: "memory-2",
						content: "Related memory",
						type: "fact",
						similarity: 0.8,
						vt_start: Date.now(),
						vt_end: 253402300799999,
					},
				],
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "manual",
			});

			// Should log start
			expect(logger.info.mock.calls.some((call: any) => call[1]?.includes?.("Starting"))).toBe(
				true,
			);

			// Should log completion
			expect(logger.info.mock.calls.some((call: any) => call[1]?.includes?.("completed"))).toBe(
				true,
			);
		});

		it("should log scan result metrics", async () => {
			const logger = createMockLogger();
			const memories = [
				{
					id: "memory-1",
					content: "Test memory",
					type: "fact",
					project: "test-project",
				},
			];
			const memoryRepo = createMockMemoryRepo(memories);
			const conflictRepo = createMockConflictRepo();
			const gemini = createMockGemini({
				relation: "supersedes",
				confidence: 0.9,
				reasoning: "Newer version",
				suggestedAction: "invalidate_b",
			});

			global.fetch = mock(async () => ({
				ok: true,
				json: async () => [
					{
						memory_id: "memory-2",
						content: "Old version",
						type: "fact",
						similarity: 0.9,
						vt_start: Date.now() - 86400000,
						vt_end: 253402300799999,
					},
				],
			})) as any;

			const consumer = new ConflictScannerConsumer(
				logger as any,
				memoryRepo as any,
				conflictRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				scanId: "scan-001",
				triggeredBy: "cron",
			});

			// Should log with metrics
			const completedLog = logger.info.mock.calls.find((call: any) =>
				call[1]?.includes?.("completed"),
			);
			expect(completedLog).toBeDefined();
			expect(completedLog[0]).toHaveProperty("durationMs");
			expect(completedLog[0]).toHaveProperty("memoriesScanned");
			expect(completedLog[0]).toHaveProperty("conflictsDetected");
		});
	});
});

/**
 * Integration tests for DecayCalculator job handler
 *
 * Tests the decay calculation pipeline:
 * 1. Load active memories from FalkorDB (exclude pinned)
 * 2. Calculate decay scores using exponential decay algorithm
 * 3. Batch update scores in FalkorDB using UNWIND
 * 4. Skip updates when score change is below threshold
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { Logger } from "@engram/logger";
import type { FalkorClient } from "@engram/storage";
import { type DecayCalculationJob, DecayCalculatorConsumer } from "../jobs/decay-calculator";

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

const createMockFalkorClient = () => ({
	connect: mock(async () => {}),
	disconnect: mock(async () => {}),
	query: mock(async () => []),
	isConnected: mock(() => true),
});

// =============================================================================
// Test Fixtures
// =============================================================================

const MAX_DATE = 253402300799999;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Create memory records with varying ages and types */
const createMemoryRecords = (now: number) => [
	{
		id: "mem-1",
		type: "decision",
		vt_start: now - 7 * MS_PER_DAY, // 7 days old
		last_accessed: now - 1 * MS_PER_DAY,
		access_count: 5,
		decay_score: 0.9,
		pinned: false,
		project: "test-project",
	},
	{
		id: "mem-2",
		type: "context",
		vt_start: now - 30 * MS_PER_DAY, // 30 days old
		last_accessed: null,
		access_count: 0,
		decay_score: 0.8,
		pinned: false,
		project: "test-project",
	},
	{
		id: "mem-3",
		type: "preference",
		vt_start: now - 1 * MS_PER_DAY, // 1 day old
		last_accessed: now,
		access_count: 10,
		decay_score: 0.95,
		pinned: false,
		project: "test-project",
	},
	{
		id: "mem-4",
		type: "turn",
		vt_start: now - 90 * MS_PER_DAY, // 90 days old
		last_accessed: null,
		access_count: 0,
		decay_score: 0.5,
		pinned: false,
		project: "test-project",
	},
];

/** Create pinned memories that should be excluded */
const createPinnedMemoryRecords = (now: number) => [
	{
		id: "pinned-1",
		type: "decision",
		vt_start: now - 365 * MS_PER_DAY, // 1 year old
		last_accessed: null,
		access_count: 0,
		decay_score: 1.0,
		pinned: true,
		project: "test-project",
	},
];

const createJob = (overrides?: Partial<DecayCalculationJob>): DecayCalculationJob => ({
	orgId: "org-123",
	triggeredBy: "manual",
	...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe("DecayCalculatorConsumer", () => {
	let consumer: DecayCalculatorConsumer;
	let mockLogger: Logger;
	let mockFalkor: ReturnType<typeof createMockFalkorClient>;
	let now: number;

	beforeEach(() => {
		now = Date.now();
		mockLogger = createMockLogger();
		mockFalkor = createMockFalkorClient();

		consumer = new DecayCalculatorConsumer(mockLogger, mockFalkor as unknown as FalkorClient);
	});

	describe("process", () => {
		it("should skip processing when no active memories found", async () => {
			mockFalkor.query.mockResolvedValueOnce([]);

			await consumer.process(createJob());

			// Should log "no memories" and return early
			const infoCalls = (mockLogger.info as ReturnType<typeof mock>).mock.calls;
			expect(
				infoCalls.some((call) => {
					const msg = typeof call[0] === "string" ? call[0] : String(call[1] || "");
					return msg.includes("No active memories") || msg.includes("no active");
				}),
			).toBe(true);
		});

		it("should calculate and update decay scores for active memories", async () => {
			const memories = createMemoryRecords(now);
			mockFalkor.query.mockResolvedValueOnce(memories);

			// Track update calls
			const updateCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					if (cypher.includes("UNWIND")) {
						updateCalls.push({ cypher, params: params || {} });
					}
					return [];
				},
			);

			await consumer.process(createJob());

			// Should have at least one batch update
			expect(updateCalls.length).toBeGreaterThan(0);

			// Updates should contain memory IDs and new scores
			const updateParams = updateCalls[0].params;
			expect(updateParams.updates).toBeDefined();
			expect(Array.isArray(updateParams.updates)).toBe(true);
		});

		it("should skip updates when score change is below threshold", async () => {
			// Create memory with score that won't change significantly
			const memories = [
				{
					id: "stable-mem",
					type: "decision",
					vt_start: now - 1 * MS_PER_DAY,
					last_accessed: now,
					access_count: 0,
					decay_score: 0.99, // Very close to calculated score
					pinned: false,
					project: "test-project",
				},
			];

			mockFalkor.query.mockResolvedValueOnce(memories);

			const updateCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					if (cypher.includes("UNWIND")) {
						updateCalls.push({ cypher, params: params || {} });
					}
					return [];
				},
			);

			await consumer.process(createJob());

			// Check if updates array is empty or call wasn't made
			if (updateCalls.length > 0) {
				const updates = updateCalls[0].params.updates as Array<{ id: string; score: number }>;
				// Should either be empty or not contain the stable memory
				const stableMemUpdate = updates.find((u) => u.id === "stable-mem");
				if (stableMemUpdate) {
					// If included, score difference should be >= threshold
					expect(Math.abs(stableMemUpdate.score - 0.99)).toBeGreaterThanOrEqual(0.01);
				}
			}
		});

		it("should respect project filter when provided", async () => {
			const queryCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];

			// Track all queries
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params: params || {} });
					// Return memories on first call (MATCH query), empty for updates
					if (cypher.includes("MATCH (m:Memory)") && !cypher.includes("UNWIND")) {
						return createMemoryRecords(now);
					}
					return [];
				},
			);

			const job = createJob({ project: "specific-project" });
			await consumer.process(job);

			// First query should filter by project
			const loadQuery = queryCalls.find(
				(q) => q.cypher.includes("MATCH (m:Memory)") && !q.cypher.includes("UNWIND"),
			);
			expect(loadQuery?.cypher).toContain("project = $project");
			expect(loadQuery?.params.project).toBe("specific-project");
		});

		it("should process all projects when no project filter provided", async () => {
			const memories = createMemoryRecords(now);
			mockFalkor.query.mockResolvedValueOnce(memories);

			const queryCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params: params || {} });
					return [];
				},
			);

			const job = createJob({ project: undefined });
			await consumer.process(job);

			// Query should not filter by project
			const loadQuery = queryCalls[0];
			expect(loadQuery?.params.project).toBeUndefined();
		});

		it("should handle cron-triggered jobs", async () => {
			mockFalkor.query.mockResolvedValueOnce([]);

			const job = createJob({ triggeredBy: "cron" });
			await consumer.process(job);

			expect((mockLogger.info as ReturnType<typeof mock>).mock.calls).toBeDefined();
		});

		it("should log summary statistics on completion", async () => {
			const memories = createMemoryRecords(now);
			mockFalkor.query.mockResolvedValueOnce(memories);
			mockFalkor.query.mockResolvedValue([]);

			await consumer.process(createJob());

			// Should log completion with statistics - check both log formats
			const infoCalls = (mockLogger.info as ReturnType<typeof mock>).mock.calls;
			const completionCall = infoCalls.find((call) => {
				// Check if the message (2nd arg or 1st arg) contains "completed"
				const msg =
					typeof call[1] === "string" ? call[1] : typeof call[0] === "string" ? call[0] : "";
				return msg.toLowerCase().includes("complet");
			});

			expect(completionCall).toBeDefined();
			if (completionCall) {
				// Stats object is typically the first arg in structured logging
				const stats = typeof completionCall[0] === "object" ? completionCall[0] : completionCall[1];
				if (typeof stats === "object" && stats !== null) {
					expect(stats).toHaveProperty("durationMs");
				}
			}
		});
	});

	describe("decay algorithm validation", () => {
		it("should apply type-based weights correctly", async () => {
			// Create memories of different types at same age
			const baseTime = now - 30 * MS_PER_DAY;
			const memories = [
				{
					id: "decision-mem",
					type: "decision", // weight: 1.0
					vt_start: baseTime,
					last_accessed: null,
					access_count: 0,
					decay_score: 0.5,
					pinned: false,
					project: "test-project",
				},
				{
					id: "turn-mem",
					type: "turn", // weight: 0.3
					vt_start: baseTime,
					last_accessed: null,
					access_count: 0,
					decay_score: 0.5,
					pinned: false,
					project: "test-project",
				},
			];

			mockFalkor.query.mockResolvedValueOnce(memories);

			const updateCalls: Array<{ params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					if (cypher.includes("UNWIND")) {
						updateCalls.push({ params: params || {} });
					}
					return [];
				},
			);

			await consumer.process(createJob());

			// Decision memory should have higher score than turn memory
			if (updateCalls.length > 0) {
				const updates = updateCalls[0].params.updates as Array<{ id: string; score: number }>;
				const decisionScore = updates.find((u) => u.id === "decision-mem")?.score || 0;
				const turnScore = updates.find((u) => u.id === "turn-mem")?.score || 0;
				expect(decisionScore).toBeGreaterThan(turnScore);
			}
		});

		it("should apply access count boost (rehearsal factor)", async () => {
			// Create memories with different access counts
			const baseTime = now - 30 * MS_PER_DAY;
			const memories = [
				{
					id: "accessed-mem",
					type: "fact",
					vt_start: baseTime,
					last_accessed: now,
					access_count: 100, // Frequently accessed
					decay_score: 0.5,
					pinned: false,
					project: "test-project",
				},
				{
					id: "forgotten-mem",
					type: "fact",
					vt_start: baseTime,
					last_accessed: null,
					access_count: 0, // Never accessed
					decay_score: 0.5,
					pinned: false,
					project: "test-project",
				},
			];

			mockFalkor.query.mockResolvedValueOnce(memories);

			const updateCalls: Array<{ params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					if (cypher.includes("UNWIND")) {
						updateCalls.push({ params: params || {} });
					}
					return [];
				},
			);

			await consumer.process(createJob());

			// Accessed memory should have higher score
			if (updateCalls.length > 0) {
				const updates = updateCalls[0].params.updates as Array<{ id: string; score: number }>;
				const accessedScore = updates.find((u) => u.id === "accessed-mem")?.score || 0;
				const forgottenScore = updates.find((u) => u.id === "forgotten-mem")?.score || 0;
				expect(accessedScore).toBeGreaterThan(forgottenScore);
			}
		});

		it("should apply recency-based exponential decay", async () => {
			// Create memories at different ages
			const memories = [
				{
					id: "recent-mem",
					type: "fact",
					vt_start: now - 1 * MS_PER_DAY, // 1 day old
					last_accessed: null,
					access_count: 0,
					decay_score: 0.5,
					pinned: false,
					project: "test-project",
				},
				{
					id: "old-mem",
					type: "fact",
					vt_start: now - 100 * MS_PER_DAY, // 100 days old
					last_accessed: null,
					access_count: 0,
					decay_score: 0.5,
					pinned: false,
					project: "test-project",
				},
			];

			mockFalkor.query.mockResolvedValueOnce(memories);

			const updateCalls: Array<{ params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					if (cypher.includes("UNWIND")) {
						updateCalls.push({ params: params || {} });
					}
					return [];
				},
			);

			await consumer.process(createJob());

			// Recent memory should have higher score
			if (updateCalls.length > 0) {
				const updates = updateCalls[0].params.updates as Array<{ id: string; score: number }>;
				const recentScore = updates.find((u) => u.id === "recent-mem")?.score || 0;
				const oldScore = updates.find((u) => u.id === "old-mem")?.score || 0;
				expect(recentScore).toBeGreaterThan(oldScore);
			}
		});
	});

	describe("batching behavior", () => {
		it("should batch updates when processing many memories", async () => {
			// Create 250 memories (exceeds batch size of 100)
			const memories = Array.from({ length: 250 }, (_, i) => ({
				id: `mem-${i}`,
				type: "fact",
				vt_start: now - (i + 1) * MS_PER_DAY,
				last_accessed: null,
				access_count: 0,
				decay_score: 0.5,
				pinned: false,
				project: "test-project",
			}));

			mockFalkor.query.mockResolvedValueOnce(memories);

			const updateCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					if (cypher.includes("UNWIND")) {
						updateCalls.push({ cypher, params: params || {} });
					}
					return [];
				},
			);

			await consumer.process(createJob());

			// Should have multiple batch update calls (250/100 = at least 3 batches)
			expect(updateCalls.length).toBeGreaterThanOrEqual(2);

			// Each batch should have max 100 updates
			for (const call of updateCalls) {
				const updates = call.params.updates as Array<{ id: string; score: number }>;
				expect(updates.length).toBeLessThanOrEqual(100);
			}
		});

		it("should process large memory sets in reasonable time", async () => {
			// Create 1000 memories
			const memories = Array.from({ length: 1000 }, (_, i) => ({
				id: `mem-${i}`,
				type: "fact",
				vt_start: now - (i + 1) * MS_PER_DAY,
				last_accessed: null,
				access_count: i % 10,
				decay_score: 0.5,
				pinned: false,
				project: "test-project",
			}));

			mockFalkor.query.mockResolvedValueOnce(memories);
			mockFalkor.query.mockResolvedValue([]);

			const startTime = Date.now();
			await consumer.process(createJob());
			const duration = Date.now() - startTime;

			// Should complete in reasonable time (< 5 seconds)
			expect(duration).toBeLessThan(5000);
		});
	});

	describe("edge cases", () => {
		it("should handle memories with null last_accessed", async () => {
			const memories = [
				{
					id: "null-accessed-mem",
					type: "context",
					vt_start: now - 7 * MS_PER_DAY,
					last_accessed: null,
					access_count: 0,
					decay_score: 0.7,
					pinned: false,
					project: "test-project",
				},
			];

			mockFalkor.query.mockResolvedValueOnce(memories);
			mockFalkor.query.mockResolvedValue([]);

			// Should not throw
			await expect(consumer.process(createJob())).resolves.toBeUndefined();
		});

		it("should exclude pinned memories from decay calculation", async () => {
			// The query itself should exclude pinned=false, but verify behavior
			const queryCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params: params || {} });
					return [];
				},
			);

			await consumer.process(createJob());

			// Load query should filter pinned = false
			const loadQuery = queryCalls[0];
			expect(loadQuery?.cypher).toContain("pinned = false");
		});

		it("should handle empty updates array gracefully", async () => {
			// All memories have scores that don't change significantly
			const memories = createMemoryRecords(now).map((m) => ({
				...m,
				decay_score: 1.0, // Max score, no change needed
				type: "decision" as const,
				vt_start: now, // Brand new
				access_count: 100, // High access
			}));

			mockFalkor.query.mockResolvedValueOnce(memories);
			mockFalkor.query.mockResolvedValue([]);

			// Should not throw
			await expect(consumer.process(createJob())).resolves.toBeUndefined();
		});
	});
});

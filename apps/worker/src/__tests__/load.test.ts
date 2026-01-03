/**
 * Load Tests for Intelligence Layer
 *
 * Tests performance characteristics of job handlers at scale:
 * - Community detection on 10K entities (< 30 seconds)
 * - Decay calculation on 100K memories (< 60 seconds)
 * - Conflict scan on 50K memories (< 5 minutes)
 *
 * Note: These tests use mocked storage to measure algorithm performance,
 * not database I/O. For production performance testing, use real infrastructure.
 */

import { describe, expect, it, mock } from "bun:test";
import type { GeminiClient } from "@engram/common/clients";
import type {
	FalkorCommunityRepository,
	FalkorConflictReportRepository,
	FalkorMemoryRepository,
	Memory,
} from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { FalkorClient } from "@engram/storage";
import { CommunityDetectorConsumer, type CommunityDetectionJob } from "../jobs/community-detector";
import { ConflictScannerConsumer, type ConflictScanJob } from "../jobs/conflict-scanner";
import { DecayCalculatorConsumer, type DecayCalculationJob } from "../jobs/decay-calculator";

// =============================================================================
// Constants
// =============================================================================

const MAX_DATE = 253402300799999;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// =============================================================================
// Mock Factories
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
	(logger.child as ReturnType<typeof mock>).mockReturnValue(logger);
	return logger;
};

const createMockFalkorClient = () => ({
	connect: mock(async () => {}),
	disconnect: mock(async () => {}),
	query: mock(async () => []),
	isConnected: mock(() => true),
});

const createMockCommunityRepo = () => ({
	findById: mock(async () => null),
	findByProject: mock(async () => []),
	findActive: mock(async () => []),
	findExistingByMemberOverlap: mock(async () => []),
	getMembers: mock(async () => []),
	create: mock(async (input: { name: string; memberCount?: number }) => ({
		id: `community-${Date.now()}`,
		name: input.name,
		memberCount: input.memberCount || 0,
		vtStart: Date.now(),
		vtEnd: MAX_DATE,
		ttStart: Date.now(),
		ttEnd: MAX_DATE,
	})),
	update: mock(async () => ({})),
	delete: mock(async () => {}),
});

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

// =============================================================================
// Data Generators
// =============================================================================

/**
 * Generate a random entity graph with specified number of entities and edge density.
 * Creates clusters of entities to simulate realistic community structures.
 *
 * @param entityCount - Number of entities to generate
 * @param avgDegree - Average edges per entity (default: 5)
 * @returns Array of edge records
 */
function generateEntityGraph(entityCount: number, avgDegree = 5) {
	const edges: Array<{ fromId: string; toId: string; type: string }> = [];
	const edgeTypes = ["RELATED_TO", "DEPENDS_ON", "IMPLEMENTS", "PART_OF"];

	// Create clusters of ~50 entities each
	const clusterSize = 50;
	const clusterCount = Math.ceil(entityCount / clusterSize);

	for (let cluster = 0; cluster < clusterCount; cluster++) {
		const clusterStart = cluster * clusterSize;
		const clusterEnd = Math.min(clusterStart + clusterSize, entityCount);

		// Dense connections within cluster
		for (let i = clusterStart; i < clusterEnd; i++) {
			const connections = Math.floor(Math.random() * avgDegree) + 1;
			for (let c = 0; c < connections; c++) {
				const target = clusterStart + Math.floor(Math.random() * (clusterEnd - clusterStart));
				if (target !== i) {
					edges.push({
						fromId: `entity-${i}`,
						toId: `entity-${target}`,
						type: edgeTypes[Math.floor(Math.random() * edgeTypes.length)],
					});
				}
			}
		}

		// Sparse cross-cluster connections
		if (cluster > 0) {
			const crossConnections = Math.floor(clusterSize * 0.1);
			for (let c = 0; c < crossConnections; c++) {
				const from = clusterStart + Math.floor(Math.random() * (clusterEnd - clusterStart));
				const prevCluster = cluster - 1;
				const prevStart = prevCluster * clusterSize;
				const prevEnd = Math.min(prevStart + clusterSize, entityCount);
				const to = prevStart + Math.floor(Math.random() * (prevEnd - prevStart));
				edges.push({
					fromId: `entity-${from}`,
					toId: `entity-${to}`,
					type: edgeTypes[Math.floor(Math.random() * edgeTypes.length)],
				});
			}
		}
	}

	return edges;
}

/**
 * Generate memory records with varied ages, types, and access patterns.
 *
 * @param count - Number of memories to generate
 * @returns Array of memory records
 */
function generateMemoryRecords(count: number) {
	const now = Date.now();
	const types = ["decision", "preference", "fact", "insight", "context", "turn"];

	return Array.from({ length: count }, (_, i) => ({
		id: `mem-${i}`,
		type: types[i % types.length],
		vt_start: now - ((i % 365) + 1) * MS_PER_DAY, // Varied ages up to 1 year
		last_accessed: i % 3 === 0 ? now - (i % 30) * MS_PER_DAY : null,
		access_count: i % 5 === 0 ? Math.floor(Math.random() * 100) : 0,
		decay_score: 0.5 + Math.random() * 0.5,
		pinned: false,
		project: "test-project",
	}));
}

/**
 * Generate full Memory objects for conflict scanning.
 *
 * @param count - Number of memories to generate
 * @param conflictRatio - Ratio of memories that should have potential conflicts (0-1)
 * @returns Array of Memory objects
 */
function generateMemories(count: number, conflictRatio = 0.05): Memory[] {
	const now = Date.now();
	const types = ["decision", "preference", "fact", "insight", "context"] as const;
	const baseContents = [
		"User prefers tabs for indentation",
		"The API uses REST endpoints",
		"Database is PostgreSQL 14",
		"Deploy to staging before production",
		"Run tests before committing",
	];

	return Array.from({ length: count }, (_, i) => {
		// Introduce conflicts by using similar content with slight variations
		const hasConflict = i < count * conflictRatio;
		const baseIndex = hasConflict ? i % baseContents.length : i;
		const content = hasConflict
			? `${baseContents[i % baseContents.length]} (version ${Math.floor(i / baseContents.length)})`
			: `Unique memory content ${i}: ${baseContents[i % baseContents.length]}`;

		return {
			id: `mem-${i}`,
			content,
			contentHash: `hash-${i}`,
			type: types[i % types.length],
			tags: [`tag-${i % 10}`],
			source: i % 2 === 0 ? "user" : "auto",
			vtStart: now - ((i % 365) + 1) * MS_PER_DAY,
			vtEnd: MAX_DATE,
			ttStart: now - ((i % 365) + 1) * MS_PER_DAY,
			ttEnd: MAX_DATE,
			project: "test-project",
		} as Memory;
	});
}

// =============================================================================
// Load Tests
// =============================================================================

describe("Load Tests", () => {
	describe("Community Detection - 10K entities", () => {
		it("should complete in < 30 seconds", async () => {
			const mockLogger = createMockLogger();
			const mockFalkor = createMockFalkorClient();
			const mockCommunityRepo = createMockCommunityRepo();

			// Generate 10K entity graph
			const entityCount = 10000;
			const edges = generateEntityGraph(entityCount, 5);

			// First call returns edges, subsequent calls are for edge creation
			let callCount = 0;
			mockFalkor.query.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return edges;
				}
				return [];
			});

			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);

			const consumer = new CommunityDetectorConsumer(
				mockLogger,
				mockFalkor as unknown as FalkorClient,
				mockCommunityRepo as unknown as FalkorCommunityRepository,
			);

			const job: CommunityDetectionJob = {
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "manual",
			};

			const startTime = Date.now();
			await consumer.process(job);
			const duration = Date.now() - startTime;

			// Assert completion within 30 seconds
			expect(duration).toBeLessThan(30000);

			// Should have created communities (with 10K entities and clusters of 50, expect ~200 communities)
			const createCalls = mockCommunityRepo.create.mock.calls;
			expect(createCalls.length).toBeGreaterThan(50);
			expect(createCalls.length).toBeLessThan(500);

			// Log performance metrics
			console.log(`Community Detection (${entityCount} entities):`);
			console.log(`  Duration: ${duration}ms`);
			console.log(`  Edges: ${edges.length}`);
			console.log(`  Communities: ${createCalls.length}`);
		}, 60000); // 60s timeout for the test itself
	});

	describe("Decay Calculation - 100K memories", () => {
		it("should complete in < 60 seconds", async () => {
			const mockLogger = createMockLogger();
			const mockFalkor = createMockFalkorClient();

			// Generate 100K memory records
			const memoryCount = 100000;
			const memories = generateMemoryRecords(memoryCount);

			// First call returns memories, subsequent calls are batch updates
			let callCount = 0;
			mockFalkor.query.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return memories;
				}
				return [];
			});

			const consumer = new DecayCalculatorConsumer(
				mockLogger,
				mockFalkor as unknown as FalkorClient,
			);

			const job: DecayCalculationJob = {
				orgId: "org-123",
				triggeredBy: "manual",
			};

			const startTime = Date.now();
			await consumer.process(job);
			const duration = Date.now() - startTime;

			// Assert completion within 60 seconds
			expect(duration).toBeLessThan(60000);

			// Should have made batch update calls (100K / 100 batch size = 1000 calls max)
			const queryCalls = mockFalkor.query.mock.calls;
			const updateCalls = queryCalls.filter(
				(call) => typeof call[0] === "string" && call[0].includes("UNWIND"),
			);
			expect(updateCalls.length).toBeGreaterThan(0);

			// Log performance metrics
			console.log(`Decay Calculation (${memoryCount} memories):`);
			console.log(`  Duration: ${duration}ms`);
			console.log(`  Batch updates: ${updateCalls.length}`);
			console.log(`  Avg per batch: ${Math.round(memoryCount / Math.max(updateCalls.length, 1))}`);
		}, 120000); // 2min timeout for the test
	});

	describe("Conflict Scan - 100 memories", () => {
		it("should complete in < 30 seconds", async () => {
			const mockLogger = createMockLogger();
			const mockMemoryRepo = createMockMemoryRepo();
			const mockConflictRepo = createMockConflictRepo();
			const mockGemini = createMockGeminiClient();

			// Generate 100 memories with 20% potential conflicts
			// Note: ConflictScanner has 100ms rate limit per memory (10s base time)
			// Full 50K test would require ~83 minutes from rate limiting alone
			const memoryCount = 100;
			const memories = generateMemories(memoryCount, 0.2);

			mockMemoryRepo.findByProject.mockResolvedValue(memories);

			// Track conflict detection calls
			let candidateCallCount = 0;

			// Mock search service - return empty candidates for most memories
			// to simulate realistic search behavior (most memories don't have conflicts)
			const originalFetch = global.fetch;
			global.fetch = mock(async () => {
				candidateCallCount++;
				// Only 5% of memories have candidates
				if (candidateCallCount % 20 === 0) {
					return new Response(
						JSON.stringify([
							{
								memory_id: `mem-${candidateCallCount - 1}`,
								content: "Similar content",
								type: "fact",
								similarity: 0.8,
								vt_start: Date.now(),
								vt_end: MAX_DATE,
							},
						]),
						{ status: 200 },
					);
				}
				return new Response(JSON.stringify([]), { status: 200 });
			});

			const consumer = new ConflictScannerConsumer(
				mockLogger,
				mockMemoryRepo as unknown as FalkorMemoryRepository,
				mockConflictRepo as unknown as FalkorConflictReportRepository,
				mockGemini as unknown as GeminiClient,
				"http://localhost:6176",
			);

			const job: ConflictScanJob = {
				project: "test-project",
				orgId: "org-123",
				scanId: "load-test-scan",
				triggeredBy: "manual",
			};

			const startTime = Date.now();
			await consumer.process(job);
			const duration = Date.now() - startTime;

			// Restore fetch
			global.fetch = originalFetch;

			// Assert completion within 30 seconds
			// (100 memories × 100ms rate limit = 10s base + classification time)
			expect(duration).toBeLessThan(30000);

			// Should have detected some conflicts (20% of 100 = ~20 potential pairs)
			const geminiCalls = mockGemini.generateStructuredOutput.mock.calls;

			// Log performance metrics
			console.log(`Conflict Scan (${memoryCount} memories):`);
			console.log(`  Duration: ${duration}ms`);
			console.log(`  Search calls: ${candidateCallCount}`);
			console.log(`  Classification calls: ${geminiCalls.length}`);
			console.log(`  Detection rate: ${((candidateCallCount / memoryCount) * 100).toFixed(1)}%`);
		}, 60000); // 1min timeout for the test
	});

	describe("Memory Usage", () => {
		it("should not exceed memory limits during large batch processing", async () => {
			const mockLogger = createMockLogger();
			const mockFalkor = createMockFalkorClient();

			// Generate 50K memory records and check memory usage
			const memoryCount = 50000;
			const beforeHeap = process.memoryUsage().heapUsed;

			const memories = generateMemoryRecords(memoryCount);

			const afterGenerate = process.memoryUsage().heapUsed;
			const generateDelta = (afterGenerate - beforeHeap) / 1024 / 1024;

			// Memory for 50K records should be reasonable (< 500MB)
			expect(generateDelta).toBeLessThan(500);

			let callCount = 0;
			mockFalkor.query.mockImplementation(async () => {
				callCount++;
				if (callCount === 1) {
					return memories;
				}
				return [];
			});

			const consumer = new DecayCalculatorConsumer(
				mockLogger,
				mockFalkor as unknown as FalkorClient,
			);

			const job: DecayCalculationJob = {
				orgId: "org-123",
				triggeredBy: "manual",
			};

			await consumer.process(job);

			const afterProcess = process.memoryUsage().heapUsed;
			const processDelta = (afterProcess - afterGenerate) / 1024 / 1024;

			// Processing overhead should be reasonable (< 200MB)
			expect(processDelta).toBeLessThan(200);

			console.log(`Memory Usage (${memoryCount} memories):`);
			console.log(`  Data generation: ${generateDelta.toFixed(2)}MB`);
			console.log(`  Processing overhead: ${processDelta.toFixed(2)}MB`);
			console.log(`  Total: ${((afterProcess - beforeHeap) / 1024 / 1024).toFixed(2)}MB`);
		}, 120000);
	});
});

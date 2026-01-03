/**
 * Integration tests for CommunityDetector job handler
 *
 * Tests the community detection pipeline:
 * 1. Load entity relationships from FalkorDB
 * 2. Run label propagation algorithm
 * 3. Create/update Community nodes with MEMBER_OF edges
 * 4. Trigger summarization jobs for communities
 */

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorCommunityRepository, Community } from "@engram/graph";
import type { Logger } from "@engram/logger";
import type { FalkorClient } from "@engram/storage";
import { CommunityDetectorConsumer, type CommunityDetectionJob } from "../jobs/community-detector";

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

const createMockCommunityRepo = () => ({
	findById: mock(async () => null),
	findByProject: mock(async () => []),
	findActive: mock(async () => []),
	findExistingByMemberOverlap: mock(async () => []),
	getMembers: mock(async () => []),
	create: mock(async (input) => ({
		id: `community-${Date.now()}`,
		name: input.name,
		summary: input.summary,
		keywords: input.keywords || [],
		memberCount: input.memberCount || 0,
		memoryCount: input.memoryCount || 0,
		lastUpdated: Date.now(),
		project: input.project,
		orgId: input.orgId,
		vtStart: Date.now(),
		vtEnd: 253402300799999,
		ttStart: Date.now(),
		ttEnd: 253402300799999,
	})),
	update: mock(async (id, updates) => ({
		id,
		...updates,
		vtStart: Date.now(),
		vtEnd: 253402300799999,
		ttStart: Date.now(),
		ttEnd: 253402300799999,
	})),
	delete: mock(async () => {}),
});

// =============================================================================
// Test Fixtures
// =============================================================================

const MAX_DATE = 253402300799999;

/** Sample entity graph with two communities */
const createEntityEdges = () => [
	// Community 1: entities A, B, C (triangle)
	{ fromId: "entity-a", toId: "entity-b", type: "RELATED_TO" },
	{ fromId: "entity-b", toId: "entity-c", type: "RELATED_TO" },
	{ fromId: "entity-c", toId: "entity-a", type: "RELATED_TO" },
	// Community 2: entities D, E, F (triangle)
	{ fromId: "entity-d", toId: "entity-e", type: "DEPENDS_ON" },
	{ fromId: "entity-e", toId: "entity-f", type: "DEPENDS_ON" },
	{ fromId: "entity-f", toId: "entity-d", type: "IMPLEMENTS" },
];

const createJob = (overrides?: Partial<CommunityDetectionJob>): CommunityDetectionJob => ({
	project: "test-project",
	orgId: "org-123",
	triggeredBy: "manual",
	...overrides,
});

// =============================================================================
// Tests
// =============================================================================

describe("CommunityDetectorConsumer", () => {
	let consumer: CommunityDetectorConsumer;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let mockFalkor: ReturnType<typeof createMockFalkorClient>;
	let mockCommunityRepo: ReturnType<typeof createMockCommunityRepo>;

	beforeEach(() => {
		mockLogger = createMockLogger();
		mockFalkor = createMockFalkorClient();
		mockCommunityRepo = createMockCommunityRepo();

		consumer = new CommunityDetectorConsumer(
			mockLogger as unknown as Logger,
			mockFalkor as unknown as FalkorClient,
			mockCommunityRepo as unknown as FalkorCommunityRepository,
		);
	});

	describe("process", () => {
		it("should skip detection when no entity edges found", async () => {
			// Return empty edge list
			mockFalkor.query.mockResolvedValueOnce([]);

			await consumer.process(createJob());

			// Should log "no edges found" and return early
			expect(mockLogger.info).toHaveBeenCalled();
			expect(mockCommunityRepo.create).not.toHaveBeenCalled();
		});

		it("should create new communities when none exist", async () => {
			// Return entity edges forming two communities
			mockFalkor.query.mockResolvedValueOnce(createEntityEdges());

			// No existing communities with member overlap
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);

			// Mock MEMBER_OF edge creation
			mockFalkor.query.mockResolvedValue([]);

			await consumer.process(createJob());

			// Should create communities (at least one with 3+ members)
			expect(mockCommunityRepo.create).toHaveBeenCalled();
		});

		it("should update existing community when member overlap exceeds threshold", async () => {
			const existingCommunity: Community = {
				id: "existing-community-1",
				name: "Existing Community",
				summary: "",
				keywords: [],
				memberCount: 3,
				memoryCount: 0,
				lastUpdated: Date.now() - 86400000,
				project: "test-project",
				vtStart: Date.now() - 86400000,
				vtEnd: MAX_DATE,
				ttStart: Date.now() - 86400000,
				ttEnd: MAX_DATE,
			};

			// Return entity edges
			mockFalkor.query.mockResolvedValueOnce(createEntityEdges());

			// Return existing community with high overlap
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([
				{ community: existingCommunity, overlapCount: 2 },
			]);

			// Mock edge operations
			mockFalkor.query.mockResolvedValue([]);

			await consumer.process(createJob());

			// Should update existing community, not create new
			expect(mockCommunityRepo.update).toHaveBeenCalledWith(
				existingCommunity.id,
				expect.objectContaining({
					memberCount: expect.any(Number),
				}),
			);
		});

		it("should create MEMBER_OF edges for community members", async () => {
			// Return entity edges
			mockFalkor.query.mockResolvedValueOnce(createEntityEdges());

			// No existing communities
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);

			// Track query calls
			const queryCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params: params || {} });
					return [];
				},
			);

			await consumer.process(createJob());

			// Should have created MEMBER_OF edges
			const memberOfQueries = queryCalls.filter((call) => call.cypher.includes("MEMBER_OF"));
			expect(memberOfQueries.length).toBeGreaterThan(0);
		});

		it("should handle cron-triggered jobs", async () => {
			mockFalkor.query.mockResolvedValueOnce(createEntityEdges());
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);
			mockFalkor.query.mockResolvedValue([]);

			const job = createJob({ triggeredBy: "cron" });

			await consumer.process(job);

			// Should process normally
			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.objectContaining({ triggeredBy: "cron" }),
				expect.any(String),
			);
		});

		it("should handle threshold-triggered jobs", async () => {
			mockFalkor.query.mockResolvedValueOnce(createEntityEdges());
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);
			mockFalkor.query.mockResolvedValue([]);

			const job = createJob({ triggeredBy: "threshold" });

			await consumer.process(job);

			expect(mockLogger.info).toHaveBeenCalledWith(
				expect.objectContaining({ triggeredBy: "threshold" }),
				expect.any(String),
			);
		});

		it("should log completion with statistics", async () => {
			mockFalkor.query.mockResolvedValueOnce(createEntityEdges());
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);
			mockFalkor.query.mockResolvedValue([]);

			await consumer.process(createJob());

			// Should log multiple info messages during processing
			const infoCalls = (mockLogger.info as ReturnType<typeof mock>).mock.calls;
			// Job should log at least: start, graph built, LPA completed, and completion
			expect(infoCalls.length).toBeGreaterThanOrEqual(2);
		});

		it("should correctly build undirected graph from directed edges", async () => {
			// Single directed edge
			const directedEdges = [{ fromId: "entity-x", toId: "entity-y", type: "RELATED_TO" }];

			mockFalkor.query.mockResolvedValueOnce(directedEdges);
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);
			mockFalkor.query.mockResolvedValue([]);

			await consumer.process(createJob());

			// Graph should have both directions (undirected)
			// This is reflected in the LPA output - both nodes should be in same community
			// With only 2 nodes, no community meets min size threshold (3), so none created
			expect(mockCommunityRepo.create).not.toHaveBeenCalled();
		});
	});

	describe("edge cases", () => {
		it("should handle isolated entities (no edges)", async () => {
			// Empty edge list - only entities with no relationships
			mockFalkor.query.mockResolvedValueOnce([]);

			await consumer.process(createJob());

			expect(mockCommunityRepo.create).not.toHaveBeenCalled();
		});

		it("should filter out communities smaller than minimum size", async () => {
			// Two entities connected - too small for community (min 3)
			const smallCommunityEdges = [{ fromId: "entity-1", toId: "entity-2", type: "RELATED_TO" }];

			mockFalkor.query.mockResolvedValueOnce(smallCommunityEdges);
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);
			mockFalkor.query.mockResolvedValue([]);

			await consumer.process(createJob());

			// Should not create any communities (too small)
			expect(mockCommunityRepo.create).not.toHaveBeenCalled();
		});

		it("should handle large entity graphs efficiently", async () => {
			// Create a larger graph with 100 entities
			const largeGraph = [];
			for (let i = 0; i < 100; i++) {
				const nextI = (i + 1) % 100;
				largeGraph.push({
					fromId: `entity-${i}`,
					toId: `entity-${nextI}`,
					type: "RELATED_TO",
				});
			}

			mockFalkor.query.mockResolvedValueOnce(largeGraph);
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);
			mockFalkor.query.mockResolvedValue([]);

			const startTime = Date.now();
			await consumer.process(createJob());
			const duration = Date.now() - startTime;

			// Should complete in reasonable time (< 5 seconds)
			expect(duration).toBeLessThan(5000);
		});

		it("should process project-specific entities only", async () => {
			const queryCalls: Array<{ cypher: string; params: Record<string, unknown> }> = [];

			// Track all queries and return edges on the entity load query
			mockFalkor.query.mockImplementation(
				async (cypher: string, params?: Record<string, unknown>) => {
					queryCalls.push({ cypher, params: params || {} });
					// Return edges on entity relationship query
					if (cypher.includes("MATCH (e:Entity)-[r:")) {
						return createEntityEdges();
					}
					return [];
				},
			);
			mockCommunityRepo.findExistingByMemberOverlap.mockResolvedValue([]);

			const job = createJob({ project: "specific-project" });
			await consumer.process(job);

			// Find the entity query (first MATCH on Entity relationships)
			const entityQuery = queryCalls.find((q) => q.cypher.includes("MATCH (e:Entity)-[r:"));
			expect(entityQuery?.cypher).toContain("project = $project");
			expect(entityQuery?.params.project).toBe("specific-project");
		});
	});
});

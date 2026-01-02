import { describe, expect, it, mock } from "bun:test";
import { CommunityDetectorConsumer } from "../community-detector";

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

// Mock FalkorDB client
const createMockFalkor = (edges: { fromId: string; toId: string; type: string }[] = []) => ({
	query: mock(async (cypher: string) => {
		// Return edges for entity graph query
		if (cypher.includes("MATCH (e:Entity)")) {
			return edges;
		}
		// Return empty for update queries
		return [];
	}),
	connect: mock(async () => {}),
});

// Mock community repository
const createMockCommunityRepo = () => ({
	findExistingByMemberOverlap: mock(async () => []),
	create: mock(async (input: any) => ({
		id: `community-${Date.now()}`,
		name: input.name,
		summary: input.summary,
		keywords: input.keywords,
		memberCount: input.memberCount,
		memoryCount: input.memoryCount,
		project: input.project,
		orgId: input.orgId,
		lastUpdated: Date.now(),
		vtStart: Date.now(),
		vtEnd: 253402300799999,
		ttStart: Date.now(),
		ttEnd: 253402300799999,
	})),
	update: mock(async () => ({})),
});

describe("CommunityDetectorConsumer", () => {
	describe("constructor", () => {
		it("should initialize with correct subject and consumer name", () => {
			const logger = createMockLogger();
			const falkor = createMockFalkor();
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			expect(consumer.subject).toBe("engram.jobs.community-detection");
			expect(consumer.consumerName).toBe("community-detector-worker");
		});
	});

	describe("process", () => {
		it("should skip detection when no edges found", async () => {
			const logger = createMockLogger();
			const falkor = createMockFalkor([]);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "manual",
			});

			// Should log that no edges were found
			expect(logger.info.mock.calls.some((call: any) => call[0]?.project)).toBe(true);
		});

		it("should detect communities from entity graph", async () => {
			const logger = createMockLogger();
			// Create a connected graph: A-B-C forms a triangle, D-E is separate
			const edges = [
				{ fromId: "a", toId: "b", type: "RELATED_TO" },
				{ fromId: "b", toId: "c", type: "RELATED_TO" },
				{ fromId: "c", toId: "a", type: "RELATED_TO" },
				{ fromId: "d", toId: "e", type: "DEPENDS_ON" },
			];
			const falkor = createMockFalkor(edges);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "cron",
			});

			// Should detect at least one community (A-B-C has size 3)
			// The D-E pair has size 2, so it's filtered out
			const infoLogs = logger.info.mock.calls;
			const completedLog = infoLogs.find(
				(call: any) =>
					call[1]?.includes?.("completed") || call[1]?.includes?.("Community detection"),
			);
			expect(completedLog).toBeDefined();
		});

		it("should create new community when no overlap found", async () => {
			const logger = createMockLogger();
			const edges = [
				{ fromId: "a", toId: "b", type: "RELATED_TO" },
				{ fromId: "b", toId: "c", type: "RELATED_TO" },
				{ fromId: "c", toId: "a", type: "RELATED_TO" },
			];
			const falkor = createMockFalkor(edges);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "manual",
			});

			// Should call create for the new community
			expect(communityRepo.create).toHaveBeenCalled();
		});

		it("should update existing community when overlap exceeds threshold", async () => {
			const logger = createMockLogger();
			const edges = [
				{ fromId: "a", toId: "b", type: "RELATED_TO" },
				{ fromId: "b", toId: "c", type: "RELATED_TO" },
				{ fromId: "c", toId: "a", type: "RELATED_TO" },
			];
			const falkor = createMockFalkor(edges);
			const communityRepo = createMockCommunityRepo();

			// Return existing community with high overlap
			communityRepo.findExistingByMemberOverlap = mock(async () => [
				{
					community: {
						id: "existing-community-1",
						name: "Existing Community",
						memberCount: 3,
					},
					overlapCount: 2, // 2/3 = 66% overlap > 50% threshold
				},
			]);

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "threshold",
			});

			// Should call update instead of create
			expect(communityRepo.update).toHaveBeenCalled();
		});
	});

	describe("graph building", () => {
		it("should create bidirectional edges for undirected community detection", async () => {
			const logger = createMockLogger();
			// Single directed edge A->B
			const edges = [
				{ fromId: "a", toId: "b", type: "RELATED_TO" },
				{ fromId: "a", toId: "c", type: "RELATED_TO" },
				{ fromId: "b", toId: "c", type: "RELATED_TO" },
			];
			const falkor = createMockFalkor(edges);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "manual",
			});

			// The graph should be built bidirectionally for LPA
			// A triangle with 3 nodes should be detected as a community
			expect(communityRepo.create).toHaveBeenCalled();
		});
	});

	describe("job types", () => {
		it("should handle cron trigger type", async () => {
			const logger = createMockLogger();
			const falkor = createMockFalkor([]);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "cron",
			});

			// Should log with triggeredBy: cron
			expect(logger.info.mock.calls.some((call: any) => call[0]?.triggeredBy === "cron")).toBe(
				true,
			);
		});

		it("should handle threshold trigger type", async () => {
			const logger = createMockLogger();
			const falkor = createMockFalkor([]);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "threshold",
			});

			// Should log with triggeredBy: threshold
			expect(logger.info.mock.calls.some((call: any) => call[0]?.triggeredBy === "threshold")).toBe(
				true,
			);
		});

		it("should handle manual trigger type", async () => {
			const logger = createMockLogger();
			const falkor = createMockFalkor([]);
			const communityRepo = createMockCommunityRepo();

			const consumer = new CommunityDetectorConsumer(
				logger as any,
				falkor as any,
				communityRepo as any,
			);

			await consumer.process({
				project: "test-project",
				orgId: "org-123",
				triggeredBy: "manual",
			});

			// Should log with triggeredBy: manual
			expect(logger.info.mock.calls.some((call: any) => call[0]?.triggeredBy === "manual")).toBe(
				true,
			);
		});
	});
});

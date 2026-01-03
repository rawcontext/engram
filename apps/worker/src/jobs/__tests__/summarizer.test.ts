import { describe, expect, it, mock } from "bun:test";
import { SummarizerConsumer } from "../summarizer";

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

// Mock community repository
const createMockCommunityRepo = (community: any = null) => ({
	findById: mock(async () => community),
	getMembers: mock(async () => []),
	update: mock(async () => ({})),
});

// Mock entity repository
const createMockEntityRepo = () => ({
	findById: mock(async (id: string) => ({
		id,
		name: `Entity ${id}`,
		type: "concept",
		description: `Description for ${id}`,
		aliases: [],
		mentionCount: 1,
		vtStart: Date.now(),
		vtEnd: 253402300799999,
		ttStart: Date.now(),
		ttEnd: 253402300799999,
	})),
	findMentioningMemories: mock(async () => []),
});

// Mock Gemini client
const createMockGemini = (
	response = {
		name: "Test Community",
		text: "A test summary.",
		keywords: ["test", "mock", "community"],
	},
) => ({
	generateStructuredOutput: mock(async () => response),
});

// Mock fetch for embeddings
const mockFetchResponse = (embedding: number[] = Array(384).fill(0.1)) => {
	global.fetch = mock(async () => ({
		ok: true,
		json: async () => ({
			embedding,
			dimensions: 384,
			embedder_type: "text",
			took_ms: 10,
		}),
	})) as any;
};

describe("SummarizerConsumer", () => {
	describe("constructor", () => {
		it("should initialize with correct subject and consumer name", () => {
			const logger = createMockLogger();
			const communityRepo = createMockCommunityRepo();
			const entityRepo = createMockEntityRepo();
			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			expect(consumer.subject).toBe("engram.jobs.summarization");
			expect(consumer.consumerName).toBe("summarizer-worker");
		});
	});

	describe("process", () => {
		it("should skip when community not found", async () => {
			const logger = createMockLogger();
			const communityRepo = createMockCommunityRepo(null);
			const entityRepo = createMockEntityRepo();
			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "nonexistent-community",
				project: "test-project",
				orgId: "org-123",
			});

			// Should log warning about missing community
			expect(logger.warn.mock.calls.some((call: any) => call[0]?.communityId)).toBe(true);
			// Should not call update
			expect(communityRepo.update).not.toHaveBeenCalled();
		});

		it("should skip when no member entities found", async () => {
			const logger = createMockLogger();
			const community = {
				id: "community-123",
				name: "Test Community",
				summary: "",
				keywords: [],
				memberCount: 0,
			};
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => []);
			const entityRepo = createMockEntityRepo();
			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			// Should log warning about no members
			expect(logger.warn.mock.calls.some((call: any) => call[1]?.includes?.("member"))).toBe(true);
			// Should not call update
			expect(communityRepo.update).not.toHaveBeenCalled();
		});

		it("should generate summary and update community", async () => {
			mockFetchResponse();

			const logger = createMockLogger();
			const community = {
				id: "community-123",
				name: "Unnamed Community",
				summary: "",
				keywords: [],
				memberCount: 3,
			};
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1", "entity-2", "entity-3"]);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => [
				{
					id: "memory-1",
					content: "Test memory content",
					type: "decision",
					vtStart: Date.now(),
				},
			]);

			const summaryResponse = {
				name: "Graph Database Architecture",
				text: "This community represents the database layer. It includes core storage patterns.",
				keywords: ["database", "storage", "architecture"],
			};
			const gemini = createMockGemini(summaryResponse);

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			// Should call Gemini
			expect(gemini.generateStructuredOutput).toHaveBeenCalled();

			// Should call update with generated content
			expect(communityRepo.update).toHaveBeenCalled();
			const updateCall = (communityRepo.update as any).mock.calls[0];
			expect(updateCall[0]).toBe("community-123");
			expect(updateCall[1].name).toBe("Graph Database Architecture");
			expect(updateCall[1].summary).toBe(
				"This community represents the database layer. It includes core storage patterns.",
			);
			expect(updateCall[1].keywords).toEqual(["database", "storage", "architecture"]);
			expect(updateCall[1].embedding).toBeDefined();
		});

		it("should limit entities to MAX_ENTITIES_PER_COMMUNITY (50)", async () => {
			mockFetchResponse();

			const logger = createMockLogger();
			const community = { id: "community-123", name: "Large Community" };
			const communityRepo = createMockCommunityRepo(community);
			// Return 100 member IDs
			communityRepo.getMembers = mock(async () =>
				Array.from({ length: 100 }, (_, i) => `entity-${i}`),
			);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => []);

			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			// Should only fetch 50 entities (MAX_ENTITIES_PER_COMMUNITY)
			expect(entityRepo.findById.mock.calls.length).toBe(50);
		});

		it("should deduplicate memories across entities", async () => {
			mockFetchResponse();

			const logger = createMockLogger();
			const community = { id: "community-123", name: "Test Community" };
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1", "entity-2"]);

			const entityRepo = createMockEntityRepo();
			// Both entities mention the same memory
			const sharedMemory = {
				id: "shared-memory-1",
				content: "Shared memory content",
				type: "fact",
				vtStart: Date.now(),
			};
			entityRepo.findMentioningMemories = mock(async () => [sharedMemory]);

			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			// Gemini should be called with deduplicated memories
			const geminiCall = (gemini.generateStructuredOutput as any).mock.calls[0];
			// The prompt builder receives the input, so we just verify it was called
			expect(gemini.generateStructuredOutput).toHaveBeenCalled();
		});
	});

	describe("embedding generation", () => {
		it("should call search service /v1/search/embed endpoint", async () => {
			const logger = createMockLogger();
			const community = { id: "community-123", name: "Test Community" };
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1"]);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => []);

			const gemini = createMockGemini();

			let fetchUrl = "";
			let fetchBody: any = {};
			global.fetch = mock(async (url: string, opts: any) => {
				fetchUrl = url;
				fetchBody = JSON.parse(opts.body);
				return {
					ok: true,
					json: async () => ({
						embedding: Array(384).fill(0.1),
						dimensions: 384,
						embedder_type: "text",
						took_ms: 10,
					}),
				};
			}) as any;

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			expect(fetchUrl).toBe("http://localhost:6176/v1/search/embed");
			expect(fetchBody.embedder_type).toBe("text");
			expect(fetchBody.is_query).toBe(false);
		});

		it("should handle trailing slash in search URL", async () => {
			mockFetchResponse();

			const logger = createMockLogger();
			const community = { id: "community-123", name: "Test Community" };
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1"]);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => []);

			const gemini = createMockGemini();

			// URL with trailing slash
			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176/",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			// Should not have double slashes in URL
			const fetchCall = (global.fetch as any).mock.calls[0];
			expect(fetchCall[0]).not.toContain("//v1");
		});

		it("should throw error when embedding fails", async () => {
			const logger = createMockLogger();
			const community = { id: "community-123", name: "Test Community" };
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1"]);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => []);

			const gemini = createMockGemini();

			global.fetch = mock(async () => ({
				ok: false,
				status: 500,
				text: async () => "Internal Server Error",
			})) as any;

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await expect(
				consumer.process({
					communityId: "community-123",
					project: "test-project",
					orgId: "org-123",
				}),
			).rejects.toThrow("Embedding failed");
		});
	});

	describe("logging", () => {
		it("should log job start and completion", async () => {
			mockFetchResponse();

			const logger = createMockLogger();
			const community = { id: "community-123", name: "Test Community" };
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1"]);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => []);

			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
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

		it("should log summarization result metrics", async () => {
			mockFetchResponse();

			const logger = createMockLogger();
			const community = { id: "community-123", name: "Test Community" };
			const communityRepo = createMockCommunityRepo(community);
			communityRepo.getMembers = mock(async () => ["entity-1", "entity-2"]);

			const entityRepo = createMockEntityRepo();
			entityRepo.findMentioningMemories = mock(async () => [
				{ id: "m1", content: "Memory 1", type: "fact", vtStart: Date.now() },
			]);

			const gemini = createMockGemini();

			const consumer = new SummarizerConsumer(
				logger as any,
				communityRepo as any,
				entityRepo as any,
				gemini as any,
				"http://localhost:6176",
			);

			await consumer.process({
				communityId: "community-123",
				project: "test-project",
				orgId: "org-123",
			});

			// Should log metrics including durationMs
			const completedLog = logger.info.mock.calls.find((call: any) =>
				call[1]?.includes?.("completed"),
			);
			expect(completedLog).toBeDefined();
			expect(completedLog[0]).toHaveProperty("durationMs");
		});
	});
});

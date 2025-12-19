import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./memory-store";

// Mock the graph client
const mockGraphClient = {
	connect: vi.fn().mockResolvedValue(undefined),
	disconnect: vi.fn().mockResolvedValue(undefined),
	query: vi.fn(),
};

// Mock the logger
const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
};

describe("MemoryStore", () => {
	let store: MemoryStore;

	beforeEach(() => {
		vi.clearAllMocks();
		store = new MemoryStore({
			graphClient: mockGraphClient as any,
			logger: mockLogger as any,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("createMemory", () => {
		it("should create a new memory when no duplicate exists", async () => {
			// No existing memory
			mockGraphClient.query.mockResolvedValueOnce([]);
			// Create succeeds
			mockGraphClient.query.mockResolvedValueOnce([]);

			const memory = await store.createMemory({
				content: "Test memory content",
				type: "decision",
				tags: ["test"],
				project: "test-project",
			});

			expect(memory).toBeDefined();
			expect(memory.content).toBe("Test memory content");
			expect(memory.type).toBe("decision");
			expect(memory.tags).toEqual(["test"]);
			expect(memory.project).toBe("test-project");
			expect(memory.id).toBeDefined();
			expect(memory.content_hash).toBeDefined();

			// Should have called connect
			expect(mockGraphClient.connect).toHaveBeenCalled();
			// Should have checked for duplicates first
			expect(mockGraphClient.query).toHaveBeenCalledTimes(2);
		});

		it("should return existing memory if duplicate content exists", async () => {
			const existingMemory = {
				m: {
					properties: {
						id: "existing-id",
						content: "Test memory content",
						content_hash: "abc123",
						type: "decision",
						tags: [],
						source: "user",
						vt_start: Date.now(),
						vt_end: Number.MAX_SAFE_INTEGER,
						tt_start: Date.now(),
						tt_end: Number.MAX_SAFE_INTEGER,
					},
				},
			};
			mockGraphClient.query.mockResolvedValueOnce([existingMemory]);

			const memory = await store.createMemory({
				content: "Test memory content",
			});

			expect(memory.id).toBe("existing-id");
			// Should only have called query once (duplicate check)
			expect(mockGraphClient.query).toHaveBeenCalledTimes(1);
			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({ contentHash: expect.any(String) }),
				"Duplicate memory detected, returning existing",
			);
		});

		it("should use default values when optional fields not provided", async () => {
			mockGraphClient.query.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce([]);

			const memory = await store.createMemory({
				content: "Simple memory",
			});

			expect(memory.type).toBe("context"); // default
			expect(memory.tags).toEqual([]); // default
			expect(memory.source).toBe("user"); // default
		});
	});

	describe("getMemory", () => {
		it("should return memory when found", async () => {
			const mockMemory = {
				m: {
					properties: {
						id: "test-id",
						content: "Test content",
						type: "context",
					},
				},
			};
			mockGraphClient.query.mockResolvedValueOnce([mockMemory]);

			const memory = await store.getMemory("test-id");

			expect(memory).toBeDefined();
			expect(memory?.id).toBe("test-id");
			expect(memory?.content).toBe("Test content");
		});

		it("should return null when memory not found", async () => {
			mockGraphClient.query.mockResolvedValueOnce([]);

			const memory = await store.getMemory("nonexistent-id");

			expect(memory).toBeNull();
		});
	});

	describe("listMemories", () => {
		it("should return list of memories", async () => {
			const mockMemories = [
				{ m: { properties: { id: "1", content: "Memory 1", type: "decision" } } },
				{ m: { properties: { id: "2", content: "Memory 2", type: "context" } } },
			];
			mockGraphClient.query.mockResolvedValueOnce(mockMemories);

			const memories = await store.listMemories();

			expect(memories).toHaveLength(2);
			expect(memories[0].id).toBe("1");
			expect(memories[1].id).toBe("2");
		});

		it("should filter by type when provided", async () => {
			mockGraphClient.query.mockResolvedValueOnce([]);

			await store.listMemories({ type: "decision" });

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("m.type = $type"),
				expect.objectContaining({ type: "decision" }),
			);
		});

		it("should filter by project when provided", async () => {
			mockGraphClient.query.mockResolvedValueOnce([]);

			await store.listMemories({ project: "my-project" });

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("m.project = $project"),
				expect.objectContaining({ project: "my-project" }),
			);
		});

		it("should apply limit", async () => {
			mockGraphClient.query.mockResolvedValueOnce([]);

			await store.listMemories({ limit: 10 });

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("LIMIT $limit"),
				expect.objectContaining({ limit: 10 }),
			);
		});
	});

	describe("deleteMemory", () => {
		it("should soft delete memory by setting vt_end", async () => {
			mockGraphClient.query.mockResolvedValueOnce([{ m: { properties: { id: "test-id" } } }]);

			const result = await store.deleteMemory("test-id");

			expect(result).toBe(true);
			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("SET m.vt_end = $now"),
				expect.objectContaining({ id: "test-id" }),
			);
		});

		it("should return false when memory not found", async () => {
			mockGraphClient.query.mockResolvedValueOnce([]);

			const result = await store.deleteMemory("nonexistent");

			expect(result).toBe(false);
		});
	});
});

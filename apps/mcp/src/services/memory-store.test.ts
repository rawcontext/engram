import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createTestGraphClient, createTestLogger } from "@engram/common/testing";
import { MemoryStore } from "./memory-store";

// Create typed mock instances
const mockGraphClient = createTestGraphClient();
const mockLogger = createTestLogger();

describe("MemoryStore", () => {
	let store: MemoryStore;

	beforeEach(() => {
		// Clear all mock call counts before each test
		mockGraphClient.connect.mockClear();
		mockGraphClient.disconnect.mockClear();
		mockGraphClient.query.mockClear();
		mockGraphClient.isConnected.mockClear();

		store = new MemoryStore({
			graphClient: mockGraphClient,
			logger: mockLogger,
		});
	});

	afterEach(() => {});

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

		it("should return empty array when result is not an array", async () => {
			mockGraphClient.query.mockResolvedValueOnce(null);

			const memories = await store.listMemories();

			expect(memories).toEqual([]);
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

	describe("connection management", () => {
		it("should connect and disconnect", async () => {
			await store.connect();
			expect(mockGraphClient.connect).toHaveBeenCalled();

			await store.disconnect();
			expect(mockGraphClient.disconnect).toHaveBeenCalled();
		});

		it("should not disconnect connection that was already connected", async () => {
			// Simulate already connected state
			await store.connect();

			// Create memory with already-connected store
			mockGraphClient.query.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce([]);
			await store.createMemory({ content: "test" });

			// Should not have disconnected
			expect(mockGraphClient.disconnect).not.toHaveBeenCalled();
		});

		it("should auto-disconnect if connection was initiated by operation", async () => {
			// Store starts not connected
			mockGraphClient.query.mockResolvedValueOnce([]);

			const memory = await store.getMemory("test-id");

			// Should have auto-disconnected after operation
			expect(mockGraphClient.disconnect).toHaveBeenCalled();
		});

		it("should not connect again if already connected", async () => {
			await store.connect();

			// Clear the call count to isolate the second call
			mockGraphClient.connect.mockClear();

			// Try to connect again
			await store.connect();

			// Should not have called connect again (already connected)
			expect(mockGraphClient.connect).not.toHaveBeenCalled();
		});

		it("should not disconnect if not connected", async () => {
			// Store starts not connected, just call disconnect
			await store.disconnect();

			// Should not have called disconnect
			expect(mockGraphClient.disconnect).not.toHaveBeenCalled();
		});

		it("should use default graphClient when not provided", () => {
			const defaultStore = new MemoryStore();
			expect(defaultStore).toBeDefined();
		});

		it("should use default logger when not provided", () => {
			const defaultStore = new MemoryStore();
			expect(defaultStore).toBeDefined();
		});
	});
});

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { MemoryService } from "./memory";

// Mock fetch for SearchClient
const mockFetch = mock();
const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe("MemoryService", () => {
	const mockLogger = {
		debug: mock(),
		info: mock(),
		warn: mock(),
		error: mock(),
	} as any;

	const createMockGraphClient = () => ({
		query: mock(),
	});

	beforeEach(() => {});

	afterEach(() => {});

	describe("remember", () => {
		it("should store new memory", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValueOnce([]); // No duplicates
			mockGraphClient.query.mockResolvedValueOnce(undefined); // Create succeeds

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const result = await service.remember({
				content: "Test memory content",
				type: "fact",
				tags: ["test"],
			});

			expect(result.stored).toBe(true);
			expect(result.duplicate).toBe(false);
			expect(result.id).toBeDefined();

			// Should check for duplicates first
			expect(mockGraphClient.query).toHaveBeenNthCalledWith(
				1,
				expect.stringContaining("content_hash"),
				expect.any(Object),
			);

			// Should create memory
			expect(mockGraphClient.query).toHaveBeenNthCalledWith(
				2,
				expect.stringContaining("CREATE (m:Memory"),
				expect.objectContaining({
					content: "Test memory content",
					type: "fact",
					tags: ["test"],
				}),
			);
		});

		it("should detect duplicate memory", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([{ id: "existing-memory-id" }]);

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const result = await service.remember({ content: "Duplicate content" });

			expect(result.stored).toBe(false);
			expect(result.duplicate).toBe(true);
			expect(result.id).toBe("existing-memory-id");

			// Should not create new memory
			expect(mockGraphClient.query).toHaveBeenCalledTimes(1);
		});

		it("should use default type when not provided", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce(undefined);

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			await service.remember({ content: "Test" });

			expect(mockGraphClient.query).toHaveBeenNthCalledWith(
				2,
				expect.any(String),
				expect.objectContaining({ type: "context" }), // Default type
			);
		});

		it("should set bitemporal fields", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValueOnce([]);
			mockGraphClient.query.mockResolvedValueOnce(undefined);

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			await service.remember({ content: "Test" });

			const createCall = mockGraphClient.query.mock.calls[1][1];
			expect(createCall.vtStart).toBeDefined();
			expect(createCall.vtEnd).toBe(Number.MAX_SAFE_INTEGER);
			expect(createCall.ttStart).toBeDefined();
			expect(createCall.ttEnd).toBe(Number.MAX_SAFE_INTEGER);
		});
	});

	describe("recall", () => {
		it("should perform hybrid search and merge results", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							id: "v1",
							score: 0.95,
							reranker_score: 0.98,
							payload: {
								node_id: "memory-1",
								content: "Vector result",
								type: "fact",
								tags: [],
								timestamp: Date.now(),
							},
						},
					],
					total: 1,
					took_ms: 15,
				}),
			});

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const results = await service.recall("test query", 5);

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("memory-1");
			expect(results[0].score).toBe(0.98); // Should use reranker_score
		});

		it("should merge vector and graph results", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([
				{
					id: "graph-memory",
					content: "Graph result",
					type: "fact",
					tags: [],
					created_at: new Date().toISOString(),
				},
			]);

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							id: "v1",
							score: 0.95,
							reranker_score: null,
							payload: {
								node_id: "vector-memory",
								content: "Vector result",
								type: "fact",
								tags: [],
								timestamp: Date.now(),
							},
						},
					],
					total: 1,
					took_ms: 15,
				}),
			});

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const results = await service.recall("test query", 10);

			// Should have both results
			expect(results.length).toBeGreaterThanOrEqual(2);
			const ids = results.map((r) => r.id);
			expect(ids).toContain("vector-memory");
			expect(ids).toContain("graph-memory");
		});

		it("should fallback to keyword search on vector failure", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([
				{
					id: "fallback-memory",
					content: "Keyword match",
					type: "fact",
					tags: [],
					created_at: new Date().toISOString(),
				},
			]);

			mockFetch.mockRejectedValue(new Error("Search service unavailable"));

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const results = await service.recall("test query", 5);

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe("fallback-memory");
			expect(mockLogger.warn).toHaveBeenCalled();
		});

		it("should apply filters to graph query", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ results: [], total: 0, took_ms: 5 }),
			});

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			await service.recall("test", 5, {
				type: "decision",
				project: "my-project",
			});

			expect(mockGraphClient.query).toHaveBeenCalledWith(
				expect.stringContaining("m.type = $type"),
				expect.objectContaining({
					type: "decision",
					project: "my-project",
				}),
			);
		});
	});

	describe("query", () => {
		it("should execute valid read-only queries", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([{ id: "node-1" }]);

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const results = await service.query("MATCH (n) RETURN n LIMIT 10");

			expect(results).toEqual([{ id: "node-1" }]);
		});

		it("should allow various read-only patterns", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const validQueries = [
				"MATCH (n) RETURN n",
				"OPTIONAL MATCH (n) RETURN n",
				"WITH 1 AS x RETURN x",
				"RETURN 1",
			];

			for (const query of validQueries) {
				await expect(service.query(query)).resolves.toBeDefined();
			}
		});

		it("should reject queries starting with disallowed keywords", async () => {
			const mockGraphClient = createMockGraphClient();
			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			await expect(service.query("CREATE (n:Node)")).rejects.toThrow(
				"Query must start with one of",
			);
		});

		it("should reject queries containing write operations", async () => {
			const mockGraphClient = createMockGraphClient();
			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const blockedQueries = [
				"MATCH (n) DELETE n",
				"MATCH (n) SET n.prop = 1",
				"MATCH (n) MERGE (m:Node)",
				"MATCH (n) DETACH DELETE n",
				"MATCH (n) REMOVE n.prop",
			];

			for (const query of blockedQueries) {
				await expect(service.query(query)).rejects.toThrow("Write operations are not allowed");
			}
		});

		it("should pass params to graph client", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			await service.query("MATCH (n {id: $id}) RETURN n", { id: "node-123" });

			expect(mockGraphClient.query).toHaveBeenCalledWith("MATCH (n {id: $id}) RETURN n", {
				id: "node-123",
			});
		});
	});

	describe("getContext", () => {
		it("should return context items from memories and decisions", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							id: "v1",
							score: 0.9,
							payload: {
								node_id: "m1",
								content: "Memory content",
								type: "fact",
								timestamp: Date.now(),
							},
						},
					],
					total: 1,
					took_ms: 10,
				}),
			});

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const context = await service.getContext("Implement feature X");

			expect(context.length).toBeGreaterThan(0);
			expect(context[0].type).toBe("memory");
			expect(context[0].content).toBe("Memory content");
		});

		it("should use depth to control result limits", async () => {
			mockFetch.mockClear();
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({ results: [], total: 0, took_ms: 5 }),
			});

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			// Should call recall with different limits based on depth
			await service.getContext("Task", undefined, "shallow");
			await service.getContext("Task", undefined, "deep");

			// Check that search was called with different limits
			const calls = mockFetch.mock.calls;
			const shallowBody = JSON.parse(calls[0][1].body);
			const deepBody = JSON.parse(calls[2][1].body);

			expect(shallowBody.limit).toBeLessThan(deepBody.limit);
		});

		it("should sort context items by relevance", async () => {
			const mockGraphClient = createMockGraphClient();
			mockGraphClient.query.mockResolvedValue([]);

			mockFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					results: [
						{
							id: "v1",
							score: 0.5,
							payload: { node_id: "m1", content: "Low score", timestamp: Date.now() },
						},
						{
							id: "v2",
							score: 0.9,
							payload: { node_id: "m2", content: "High score", timestamp: Date.now() },
						},
					],
					total: 2,
					took_ms: 10,
				}),
			});

			const service = new MemoryService({
				graphClient: mockGraphClient as any,
				searchUrl: "http://localhost:5002",
				logger: mockLogger,
			});

			const context = await service.getContext("Task");

			// Higher relevance should come first
			expect(context[0].relevance).toBeGreaterThanOrEqual(context[context.length - 1].relevance);
		});
	});
});

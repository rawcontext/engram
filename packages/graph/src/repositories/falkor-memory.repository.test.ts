import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorMemoryRepository } from "./falkor-memory.repository";
import type { Memory } from "./types";

describe("FalkorMemoryRepository - Invalidation", () => {
	let mockClient: GraphClient;
	let repository: FalkorMemoryRepository;
	const mockNow = 1640000000000; // Fixed timestamp for testing

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorMemoryRepository(mockClient);
	});

	describe("invalidate", () => {
		it("should close vt_end and tt_end to current time without replacement", async () => {
			const memoryId = "mem-123";
			const beforeTime = Date.now();

			// Mock findById to return an existing memory
			const existingMemory: Memory = {
				id: memoryId,
				content: "Test memory",
				contentHash: "hash123",
				type: "context",
				tags: ["test"],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// First call: findById
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: existingMemory.id,
								content: existingMemory.content,
								content_hash: existingMemory.contentHash,
								type: existingMemory.type,
								tags: existingMemory.tags,
								source: existingMemory.source,
								vt_start: existingMemory.vtStart,
								vt_end: existingMemory.vtEnd,
								tt_start: existingMemory.ttStart,
								tt_end: existingMemory.ttEnd,
							},
						} as FalkorNode,
					},
				])
				// Second call: invalidate query
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								...existingMemory,
								vt_end: mockNow,
								tt_end: mockNow,
								invalidated_at: mockNow,
							},
						} as FalkorNode,
					},
				]);

			await repository.invalidate(memoryId);

			const afterTime = Date.now();

			// Verify the invalidate query was called correctly
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);

			// Check the invalidate query (second call)
			const [invalidateQuery, invalidateParams] = calls[1];
			expect(invalidateQuery).toContain("MATCH (m:Memory {id: $id})");
			expect(invalidateQuery).toContain("WHERE m.vt_end > $now");
			expect(invalidateQuery).toContain(
				"SET m.vt_end = $now, m.tt_end = $now, m.invalidated_at = $now",
			);
			expect(invalidateQuery).not.toContain("m.replaced_by");
			expect(invalidateParams.id).toBe(memoryId);
			expect(invalidateParams.now).toBeGreaterThanOrEqual(beforeTime);
			expect(invalidateParams.now).toBeLessThanOrEqual(afterTime);
			expect(invalidateParams.replacedById).toBeUndefined();
		});

		it("should close vt_end and tt_end and set replaced_by when replacedById is provided", async () => {
			const memoryId = "mem-123";
			const replacementId = "mem-456";
			const beforeTime = Date.now();

			// Mock findById to return an existing memory
			const existingMemory: Memory = {
				id: memoryId,
				content: "Test memory",
				contentHash: "hash123",
				type: "context",
				tags: ["test"],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// First call: findById
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: existingMemory.id,
								content: existingMemory.content,
								content_hash: existingMemory.contentHash,
								type: existingMemory.type,
								tags: existingMemory.tags,
								source: existingMemory.source,
								vt_start: existingMemory.vtStart,
								vt_end: existingMemory.vtEnd,
								tt_start: existingMemory.ttStart,
								tt_end: existingMemory.ttEnd,
							},
						} as FalkorNode,
					},
				])
				// Second call: invalidate query
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								...existingMemory,
								vt_end: mockNow,
								tt_end: mockNow,
								invalidated_at: mockNow,
								replaced_by: replacementId,
							},
						} as FalkorNode,
					},
				])
				// Third call: create REPLACES edge
				.mockResolvedValueOnce([]);

			await repository.invalidate(memoryId, replacementId);

			const afterTime = Date.now();

			// Verify all queries were called
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(3);

			// Check the invalidate query (second call)
			const [invalidateQuery, invalidateParams] = calls[1];
			expect(invalidateQuery).toContain("MATCH (m:Memory {id: $id})");
			expect(invalidateQuery).toContain("WHERE m.vt_end > $now");
			expect(invalidateQuery).toContain(
				"SET m.vt_end = $now, m.tt_end = $now, m.invalidated_at = $now, m.replaced_by = $replacedById",
			);
			expect(invalidateParams.id).toBe(memoryId);
			expect(invalidateParams.now).toBeGreaterThanOrEqual(beforeTime);
			expect(invalidateParams.now).toBeLessThanOrEqual(afterTime);
			expect(invalidateParams.replacedById).toBe(replacementId);
		});

		it("should create REPLACES edge when replacedById is provided", async () => {
			const memoryId = "mem-123";
			const replacementId = "mem-456";
			const beforeTime = Date.now();

			// Mock findById
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: memoryId,
								content: "Test",
								content_hash: "hash",
								type: "context",
								tags: [],
								source: "user",
								vt_start: mockNow - 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow - 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Invalidate query
				.mockResolvedValueOnce([{ m: {} }])
				// REPLACES edge creation
				.mockResolvedValueOnce([]);

			await repository.invalidate(memoryId, replacementId);

			const afterTime = Date.now();
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(3);

			// Check the REPLACES edge query (third call)
			const [replacesQuery, replacesParams] = calls[2];
			expect(replacesQuery).toContain(
				"MATCH (new:Memory {id: $replacedById}), (old:Memory {id: $id})",
			);
			expect(replacesQuery).toContain("CREATE (new)-[:REPLACES");
			expect(replacesQuery).toContain(`tt_start: $now, tt_end: ${MAX_DATE}`);
			expect(replacesQuery).toContain(`vt_start: $now, vt_end: ${MAX_DATE}`);
			expect(replacesParams.replacedById).toBe(replacementId);
			expect(replacesParams.id).toBe(memoryId);
			expect(replacesParams.now).toBeGreaterThanOrEqual(beforeTime);
			expect(replacesParams.now).toBeLessThanOrEqual(afterTime);
		});

		it("should throw error if memory does not exist", async () => {
			const memoryId = "nonexistent";

			// Mock findById to return null
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.invalidate(memoryId)).rejects.toThrow(
				`Memory not found: ${memoryId}`,
			);
		});

		it("should not create REPLACES edge when replacedById is not provided", async () => {
			const memoryId = "mem-123";

			// Mock findById and invalidate query
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: memoryId,
								content: "Test",
								content_hash: "hash",
								type: "context",
								tags: [],
								source: "user",
								vt_start: mockNow - 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow - 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				.mockResolvedValueOnce([{ m: {} }]);

			await repository.invalidate(memoryId);

			// Should only have 2 calls (findById and invalidate), no REPLACES edge
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);

			// Verify no REPLACES query was made
			const queries = calls.map(([query]: [string]) => query);
			expect(queries.some((q) => q.includes("REPLACES"))).toBe(false);
		});
	});

	describe("findReplacements", () => {
		it("should return memories that replaced the target memory", async () => {
			const targetId = "mem-old";
			const replacement1: Memory = {
				id: "mem-new-1",
				content: "Replacement 1",
				contentHash: "hash1",
				type: "context",
				tags: ["updated"],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow,
				vtEnd: MAX_DATE,
				ttStart: mockNow,
				ttEnd: MAX_DATE,
			};
			const replacement2: Memory = {
				id: "mem-new-2",
				content: "Replacement 2",
				contentHash: "hash2",
				type: "context",
				tags: ["updated"],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow + 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow + 1000,
				ttEnd: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: replacement1.id,
							content: replacement1.content,
							content_hash: replacement1.contentHash,
							type: replacement1.type,
							tags: replacement1.tags,
							source: replacement1.source,
							vt_start: replacement1.vtStart,
							vt_end: replacement1.vtEnd,
							tt_start: replacement1.ttStart,
							tt_end: replacement1.ttEnd,
						},
					} as FalkorNode,
				},
				{
					m: {
						properties: {
							id: replacement2.id,
							content: replacement2.content,
							content_hash: replacement2.contentHash,
							type: replacement2.type,
							tags: replacement2.tags,
							source: replacement2.source,
							vt_start: replacement2.vtStart,
							vt_end: replacement2.vtEnd,
							tt_start: replacement2.ttStart,
							tt_end: replacement2.ttEnd,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findReplacements(targetId);

			// Verify the query
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(1);

			const [query, params] = calls[0];
			expect(query).toContain("MATCH (m:Memory)-[:REPLACES]->(:Memory {id: $targetId})");
			expect(query).toContain(`WHERE m.tt_end = ${MAX_DATE}`);
			expect(query).toContain("RETURN m");
			expect(params).toEqual({ targetId });

			// Verify the result
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual(replacement1);
			expect(result[1]).toEqual(replacement2);
		});

		it("should return empty array if no replacements exist", async () => {
			const targetId = "mem-never-replaced";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findReplacements(targetId);

			expect(result).toEqual([]);
		});

		it("should only return active replacements (tt_end = MAX_DATE)", async () => {
			const targetId = "mem-old";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: "mem-active",
							content: "Active replacement",
							content_hash: "hash",
							type: "context",
							tags: [],
							source: "user",
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findReplacements(targetId);

			// Verify query filters by tt_end
			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain(`WHERE m.tt_end = ${MAX_DATE}`);

			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("mem-active");
		});

		it("should traverse REPLACES edge correctly", async () => {
			const targetId = "mem-original";
			const replacement: Memory = {
				id: "mem-updated",
				content: "Updated version",
				contentHash: "hash-new",
				type: "context",
				tags: ["v2"],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow,
				vtEnd: MAX_DATE,
				ttStart: mockNow,
				ttEnd: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: replacement.id,
							content: replacement.content,
							content_hash: replacement.contentHash,
							type: replacement.type,
							tags: replacement.tags,
							source: replacement.source,
							vt_start: replacement.vtStart,
							vt_end: replacement.vtEnd,
							tt_start: replacement.ttStart,
							tt_end: replacement.ttEnd,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findReplacements(targetId);

			// Verify correct edge direction: (new)-[:REPLACES]->(old)
			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("(m:Memory)-[:REPLACES]->(:Memory {id: $targetId})");
			expect(params.targetId).toBe(targetId);

			expect(result).toHaveLength(1);
			expect(result[0]).toEqual(replacement);
		});
	});

	describe("findActive", () => {
		it("should exclude invalidated memories (vt_end closed)", async () => {
			const activeMemory: Memory = {
				id: "mem-active",
				content: "Active memory",
				contentHash: "hash1",
				type: "context",
				tags: [],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			// Mock query to return only active memories
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: activeMemory.id,
							content: activeMemory.content,
							content_hash: activeMemory.contentHash,
							type: activeMemory.type,
							tags: activeMemory.tags,
							source: activeMemory.source,
							vt_start: activeMemory.vtStart,
							vt_end: activeMemory.vtEnd,
							tt_start: activeMemory.ttStart,
							tt_end: activeMemory.ttEnd,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findActive();

			// Verify query only returns memories with tt_end = MAX_DATE
			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain(`WHERE m.tt_end = ${MAX_DATE}`);

			// Result should only include active memory
			expect(result).toHaveLength(1);
			expect(result[0].id).toBe("mem-active");
			expect(result[0].vtEnd).toBe(MAX_DATE);
			expect(result[0].ttEnd).toBe(MAX_DATE);
		});

		it("should return memories ordered by vt_start DESC", async () => {
			const memory1: Memory = {
				id: "mem-1",
				content: "Older",
				contentHash: "hash1",
				type: "context",
				tags: [],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow - 2000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 2000,
				ttEnd: MAX_DATE,
			};
			const memory2: Memory = {
				id: "mem-2",
				content: "Newer",
				contentHash: "hash2",
				type: "context",
				tags: [],
				source: "user",
				accessCount: 0,
				decayScore: 1.0,
				pinned: false,
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: memory2.id,
							content: memory2.content,
							content_hash: memory2.contentHash,
							type: memory2.type,
							tags: memory2.tags,
							source: memory2.source,
							vt_start: memory2.vtStart,
							vt_end: memory2.vtEnd,
							tt_start: memory2.ttStart,
							tt_end: memory2.ttEnd,
						},
					} as FalkorNode,
				},
				{
					m: {
						properties: {
							id: memory1.id,
							content: memory1.content,
							content_hash: memory1.contentHash,
							type: memory1.type,
							tags: memory1.tags,
							source: memory1.source,
							vt_start: memory1.vtStart,
							vt_end: memory1.vtEnd,
							tt_start: memory1.ttStart,
							tt_end: memory1.ttEnd,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findActive();

			// Verify ordering in query
			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY m.vt_start DESC");

			// Results should be ordered newest first
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("mem-2");
			expect(result[1].id).toBe("mem-1");
		});

		it("should not include memories with vt_end in the past", async () => {
			// Setup: In reality, invalidated memories have vt_end = now (not MAX_DATE)
			// findActive filters by tt_end = MAX_DATE which excludes invalidated ones

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: "mem-active",
							content: "Only active",
							content_hash: "hash",
							type: "context",
							tags: [],
							source: "user",
							vt_start: mockNow - 1000,
							vt_end: MAX_DATE,
							tt_start: mockNow - 1000,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findActive();

			// Query filters by tt_end = MAX_DATE, which excludes invalidated memories
			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain(`WHERE m.tt_end = ${MAX_DATE}`);

			expect(result).toHaveLength(1);
			expect(result[0].vtEnd).toBe(MAX_DATE);
		});

		it("should return empty array when no active memories exist", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findActive();

			expect(result).toEqual([]);
		});
	});

	describe("Integration: invalidate + findReplacements + findActive", () => {
		it("should invalidate memory, create replacement edge, and exclude from findActive", async () => {
			const oldMemoryId = "mem-old";
			const newMemoryId = "mem-new";

			// Step 1: Invalidate old memory
			spyOn(mockClient, "query")
				// findById for invalidate
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: oldMemoryId,
								content: "Old content",
								content_hash: "hash-old",
								type: "context",
								tags: [],
								source: "user",
								vt_start: mockNow - 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow - 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// invalidate query
				.mockResolvedValueOnce([{ m: {} }])
				// REPLACES edge creation
				.mockResolvedValueOnce([])
				// findReplacements query
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: newMemoryId,
								content: "New content",
								content_hash: "hash-new",
								type: "context",
								tags: [],
								source: "user",
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// findActive query
				.mockResolvedValueOnce([
					{
						m: {
							properties: {
								id: newMemoryId,
								content: "New content",
								content_hash: "hash-new",
								type: "context",
								tags: [],
								source: "user",
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				]);

			await repository.invalidate(oldMemoryId, newMemoryId);

			// Step 2: Verify replacement relationship
			const replacements = await repository.findReplacements(oldMemoryId);
			expect(replacements).toHaveLength(1);
			expect(replacements[0].id).toBe(newMemoryId);

			// Step 3: Verify old memory is excluded from active results
			const activeMemories = await repository.findActive();
			expect(activeMemories.some((m) => m.id === oldMemoryId)).toBe(false);
			expect(activeMemories.some((m) => m.id === newMemoryId)).toBe(true);
		});
	});
});

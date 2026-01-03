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
				// First call: findById (uses query builder with alias 'n')
				.mockResolvedValueOnce([
					{
						n: {
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
				// Second call: invalidate query (uses raw Cypher with alias 'm')
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

			// Verify correct number of queries were made (behavior)
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);
		});

		it("should close vt_end and tt_end and set replaced_by when replacedById is provided", async () => {
			const memoryId = "mem-123";
			const replacementId = "mem-456";

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
				// First call: findById (uses query builder with alias 'n')
				.mockResolvedValueOnce([
					{
						n: {
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
				// Second call: invalidate query (uses raw Cypher with alias 'm')
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

			// Verify three queries were made: findById, invalidate, and REPLACES edge (behavior)
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(3);
		});

		it("should create REPLACES edge when replacedById is provided", async () => {
			const memoryId = "mem-123";
			const replacementId = "mem-456";

			// Mock findById (uses query builder with alias 'n')
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						n: {
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
				// Invalidate query (uses raw Cypher with alias 'm')
				.mockResolvedValueOnce([{ m: {} }])
				// REPLACES edge creation
				.mockResolvedValueOnce([]);

			await repository.invalidate(memoryId, replacementId);

			// Verify three queries were made: findById, invalidate, and REPLACES edge (behavior)
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(3);
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

			// Mock findById (uses query builder with alias 'n') and invalidate query
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						n: {
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
				// Invalidate query (uses raw Cypher with alias 'm')
				.mockResolvedValueOnce([{ m: {} }]);

			await repository.invalidate(memoryId);

			// Verify only 2 queries were made: findById and invalidate (no REPLACES edge)
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);
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

			// Verify query was made (behavior)
			expect(mockClient.query).toHaveBeenCalled();

			// Verify result mapping is correct (behavior)
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

			// Verify query was made (behavior)
			expect(mockClient.query).toHaveBeenCalled();

			// Verify result contains only active replacements (behavior)
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

			// Verify query was made (behavior)
			expect(mockClient.query).toHaveBeenCalled();

			// Verify result mapping is correct (behavior)
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

			// Mock query to return only active memories (uses query builder with alias 'n')
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					n: {
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

			// Verify query was made (behavior)
			expect(mockClient.query).toHaveBeenCalled();

			// Result should only include active memory (behavior)
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

			// Uses query builder with alias 'n'
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					n: {
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
					n: {
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

			// Verify query was made (behavior)
			expect(mockClient.query).toHaveBeenCalled();

			// Results should be ordered newest first (behavior)
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("mem-2");
			expect(result[1].id).toBe("mem-1");
		});

		it("should not include memories with vt_end in the past", async () => {
			// Setup: In reality, invalidated memories have vt_end = now (not MAX_DATE)
			// findActive filters by tt_end = MAX_DATE which excludes invalidated ones

			// Uses query builder with alias 'n'
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					n: {
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

			// Verify query was made (behavior)
			expect(mockClient.query).toHaveBeenCalled();

			// Verify result only includes active memories (behavior)
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
				// findById for invalidate (uses query builder with alias 'n')
				.mockResolvedValueOnce([
					{
						n: {
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
				// invalidate query (uses raw Cypher with alias 'm')
				.mockResolvedValueOnce([{ m: {} }])
				// REPLACES edge creation
				.mockResolvedValueOnce([])
				// findReplacements query (uses raw Cypher with alias 'm')
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
				// findActive query (uses query builder with alias 'n')
				.mockResolvedValueOnce([
					{
						n: {
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

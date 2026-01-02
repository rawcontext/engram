import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorCommunityRepository } from "./falkor-community.repository";
import type { Community } from "./types";

describe("FalkorCommunityRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorCommunityRepository;
	const mockNow = 1640000000000;

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorCommunityRepository(mockClient);
	});

	describe("findById", () => {
		it("should return community when found", async () => {
			const communityId = "comm-123";
			const props = {
				id: communityId,
				name: "TypeScript Patterns",
				summary: "Common TypeScript patterns and practices",
				keywords: ["typescript", "patterns"],
				member_count: 5,
				memory_count: 10,
				last_updated: mockNow,
				vt_start: mockNow - 1000,
				vt_end: MAX_DATE,
				tt_start: mockNow - 1000,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findById(communityId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(communityId);
			expect(result?.name).toBe("TypeScript Patterns");
			expect(result?.memberCount).toBe(5);
			expect(result?.memoryCount).toBe(10);
		});

		it("should return null when not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should filter by tt_end = MAX_DATE", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findById("comm-123");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain(`WHERE c.tt_end = ${MAX_DATE}`);
		});
	});

	describe("findByProject", () => {
		it("should find communities by project", async () => {
			const project = "engram";
			const communities = [
				{
					id: "comm-1",
					name: "Memory Patterns",
					summary: "Memory handling patterns",
					keywords: ["memory"],
					member_count: 10,
					memory_count: 20,
					last_updated: mockNow,
					project,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "comm-2",
					name: "Graph Patterns",
					summary: "Graph database patterns",
					keywords: ["graph"],
					member_count: 5,
					memory_count: 15,
					last_updated: mockNow,
					project,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				communities.map((c) => ({ c: { properties: c } as FalkorNode })),
			);

			const result = await repository.findByProject(project);

			expect(result).toHaveLength(2);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("{project: $project}");
			expect(params.project).toBe(project);
		});

		it("should order by member_count DESC", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByProject("engram");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY c.member_count DESC");
		});
	});

	describe("getMembers", () => {
		it("should return entity IDs in a community", async () => {
			const communityId = "comm-123";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ entityId: "entity-1" },
				{ entityId: "entity-2" },
				{ entityId: "entity-3" },
			]);

			const result = await repository.getMembers(communityId);

			expect(result).toEqual(["entity-1", "entity-2", "entity-3"]);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("(e:Entity)-[:MEMBER_OF]->(c:Community {id: $communityId})");
			expect(params.communityId).toBe(communityId);
		});

		it("should return empty array when community has no members", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.getMembers("empty-comm");

			expect(result).toEqual([]);
		});
	});

	describe("create", () => {
		it("should create community with required fields", async () => {
			const input = {
				name: "New Community",
				summary: "A new community for testing",
			};

			const createdProps = {
				id: "generated-id",
				name: input.name,
				summary: input.summary,
				keywords: [],
				member_count: 0,
				memory_count: 0,
				last_updated: mockNow,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: createdProps } as FalkorNode },
			]);

			const result = await repository.create(input);

			expect(result.name).toBe(input.name);
			expect(result.summary).toBe(input.summary);
			expect(result.keywords).toEqual([]);
			expect(result.memberCount).toBe(0);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CREATE (c:Community");
		});

		it("should create community with all optional fields", async () => {
			const input = {
				name: "Full Community",
				summary: "A fully specified community",
				keywords: ["test", "example"],
				memberCount: 5,
				memoryCount: 10,
				project: "engram",
				orgId: "org-123",
				embedding: [0.1, 0.2, 0.3],
			};

			const createdProps = {
				id: "generated-id",
				name: input.name,
				summary: input.summary,
				keywords: input.keywords,
				member_count: input.memberCount,
				memory_count: input.memoryCount,
				last_updated: mockNow,
				project: input.project,
				org_id: input.orgId,
				embedding: input.embedding,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: createdProps } as FalkorNode },
			]);

			const result = await repository.create(input);

			expect(result.keywords).toEqual(input.keywords);
			expect(result.memberCount).toBe(input.memberCount);
			expect(result.memoryCount).toBe(input.memoryCount);
			expect(result.project).toBe(input.project);
			expect(result.orgId).toBe(input.orgId);
			expect(result.embedding).toEqual(input.embedding);
		});
	});

	describe("update", () => {
		it("should update community with bitemporal versioning", async () => {
			const existingCommunity: Community = {
				id: "comm-123",
				name: "Old Name",
				summary: "Old summary",
				keywords: ["old"],
				memberCount: 5,
				memoryCount: 10,
				lastUpdated: mockNow - 1000,
				vtStart: mockNow - 1000,
				vtEnd: MAX_DATE,
				ttStart: mockNow - 1000,
				ttEnd: MAX_DATE,
			};

			const updates = {
				name: "New Name",
				summary: "Updated summary",
				keywords: ["new", "updated"],
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						c: {
							properties: {
								id: existingCommunity.id,
								name: existingCommunity.name,
								summary: existingCommunity.summary,
								keywords: existingCommunity.keywords,
								member_count: existingCommunity.memberCount,
								memory_count: existingCommunity.memoryCount,
								last_updated: existingCommunity.lastUpdated,
								vt_start: existingCommunity.vtStart,
								vt_end: existingCommunity.vtEnd,
								tt_start: existingCommunity.ttStart,
								tt_end: existingCommunity.ttEnd,
							},
						} as FalkorNode,
					},
				])
				// close old version
				.mockResolvedValueOnce([{ count: 1 }])
				// create new version
				.mockResolvedValueOnce([
					{
						c: {
							properties: {
								id: "new-comm-id",
								name: updates.name,
								summary: updates.summary,
								keywords: updates.keywords,
								member_count: existingCommunity.memberCount,
								memory_count: existingCommunity.memoryCount,
								last_updated: mockNow,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// link REPLACES edge
				.mockResolvedValueOnce([]);

			const result = await repository.update(existingCommunity.id, updates);

			expect(result.name).toBe(updates.name);
			expect(result.summary).toBe(updates.summary);
			expect(result.keywords).toEqual(updates.keywords);
			expect(result.memberCount).toBe(existingCommunity.memberCount);
		});

		it("should throw error if community not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.update("nonexistent", { name: "New" })).rejects.toThrow(
				"Community not found: nonexistent",
			);
		});

		it("should retry on concurrent modification", async () => {
			const existingProps = {
				id: "comm-123",
				name: "Community",
				summary: "Summary",
				keywords: [],
				member_count: 5,
				memory_count: 10,
				last_updated: mockNow,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// First attempt - findById
				.mockResolvedValueOnce([{ c: { properties: existingProps } as FalkorNode }])
				// First attempt - close fails
				.mockResolvedValueOnce([{ count: 0 }])
				// Second attempt - findById
				.mockResolvedValueOnce([{ c: { properties: existingProps } as FalkorNode }])
				// Second attempt - close succeeds
				.mockResolvedValueOnce([{ count: 1 }])
				// Second attempt - create new version
				.mockResolvedValueOnce([
					{ c: { properties: { ...existingProps, name: "Updated" } } as FalkorNode },
				])
				// Second attempt - link REPLACES edge
				.mockResolvedValueOnce([]);

			const result = await repository.update("comm-123", { name: "Updated" });

			expect(result.name).toBe("Updated");
		});
	});

	describe("findExistingByMemberOverlap", () => {
		it("should find communities with overlapping members", async () => {
			const memberIds = ["entity-1", "entity-2", "entity-3"];
			const communityProps = {
				id: "comm-123",
				name: "Overlapping Community",
				summary: "Has some shared members",
				keywords: [],
				member_count: 5,
				memory_count: 10,
				last_updated: mockNow,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: communityProps } as FalkorNode, overlapCount: 2 },
			]);

			const result = await repository.findExistingByMemberOverlap(memberIds, 2);

			expect(result).toHaveLength(1);
			expect(result[0].community.id).toBe("comm-123");
			expect(result[0].overlapCount).toBe(2);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("e.id IN $memberIds");
			expect(query).toContain("WHERE overlapCount >= $minOverlap");
			expect(params.memberIds).toEqual(memberIds);
			expect(params.minOverlap).toBe(2);
		});

		it("should return empty array when no memberIds provided", async () => {
			const result = await repository.findExistingByMemberOverlap([], 2);

			expect(result).toEqual([]);
			// Should not make any queries
			expect((mockClient.query as any).mock.calls).toHaveLength(0);
		});

		it("should order by overlapCount DESC", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findExistingByMemberOverlap(["entity-1", "entity-2"], 1);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY overlapCount DESC");
		});
	});

	describe("findActive", () => {
		it("should return all active communities ordered by member count", async () => {
			const communities = [
				{
					id: "comm-1",
					name: "Large Community",
					summary: "Most members",
					keywords: [],
					member_count: 100,
					memory_count: 200,
					last_updated: mockNow,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
				{
					id: "comm-2",
					name: "Small Community",
					summary: "Fewer members",
					keywords: [],
					member_count: 10,
					memory_count: 20,
					last_updated: mockNow,
					vt_start: mockNow,
					vt_end: MAX_DATE,
					tt_start: mockNow,
					tt_end: MAX_DATE,
				},
			];

			spyOn(mockClient, "query").mockResolvedValueOnce(
				communities.map((c) => ({ c: { properties: c } as FalkorNode })),
			);

			const result = await repository.findActive();

			expect(result).toHaveLength(2);
			expect(result[0].memberCount).toBe(100);
			expect(result[1].memberCount).toBe(10);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY c.member_count DESC");
		});
	});

	describe("delete", () => {
		it("should soft delete existing community", async () => {
			const communityId = "comm-123";
			const props = {
				id: communityId,
				name: "To Delete",
				summary: "Will be deleted",
				keywords: [],
				member_count: 0,
				memory_count: 0,
				last_updated: mockNow,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([{ c: { properties: props } as FalkorNode }])
				// softDelete
				.mockResolvedValueOnce([]);

			await repository.delete(communityId);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);
			const [deleteQuery] = calls[1];
			expect(deleteQuery).toContain("SET n.tt_end = $t");
		});

		it("should throw error if community not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.delete("nonexistent")).rejects.toThrow(
				"Community not found: nonexistent",
			);
		});
	});

	describe("mapToCommunity", () => {
		it("should correctly map all fields", async () => {
			const props = {
				id: "comm-123",
				name: "Full Community",
				summary: "Complete mapping test",
				keywords: ["test", "complete"],
				member_count: 25,
				memory_count: 100,
				last_updated: mockNow,
				project: "engram",
				org_id: "org-456",
				embedding: [0.1, 0.2, 0.3],
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findById("comm-123");

			expect(result).not.toBeNull();
			expect(result?.id).toBe("comm-123");
			expect(result?.name).toBe("Full Community");
			expect(result?.summary).toBe("Complete mapping test");
			expect(result?.keywords).toEqual(["test", "complete"]);
			expect(result?.memberCount).toBe(25);
			expect(result?.memoryCount).toBe(100);
			expect(result?.lastUpdated).toBe(mockNow);
			expect(result?.project).toBe("engram");
			expect(result?.orgId).toBe("org-456");
			expect(result?.embedding).toEqual([0.1, 0.2, 0.3]);
			expect(result?.vtStart).toBe(mockNow);
			expect(result?.vtEnd).toBe(MAX_DATE);
		});

		it("should handle missing optional fields", async () => {
			const props = {
				id: "comm-123",
				name: "Minimal",
				summary: "Just the basics",
				keywords: [],
				member_count: 0,
				memory_count: 0,
				last_updated: mockNow,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findById("comm-123");

			expect(result).not.toBeNull();
			expect(result?.project).toBeUndefined();
			expect(result?.orgId).toBeUndefined();
			expect(result?.embedding).toBeUndefined();
		});

		it("should handle non-array keywords gracefully", async () => {
			const props = {
				id: "comm-123",
				name: "Bad Keywords",
				summary: "Keywords not an array",
				keywords: "not-an-array" as unknown,
				member_count: 0,
				memory_count: 0,
				last_updated: mockNow,
				vt_start: mockNow,
				vt_end: MAX_DATE,
				tt_start: mockNow,
				tt_end: MAX_DATE,
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{ c: { properties: props } as FalkorNode },
			]);

			const result = await repository.findById("comm-123");

			expect(result).not.toBeNull();
			expect(result?.keywords).toEqual([]);
		});
	});
});

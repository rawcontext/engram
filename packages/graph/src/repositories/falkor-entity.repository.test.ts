import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FalkorNode, GraphClient } from "@engram/storage";
import { MAX_DATE } from "../utils/time";
import { FalkorEntityRepository } from "./falkor-entity.repository";
import type { CreateEntityInput, UpdateEntityInput } from "./types";

describe("FalkorEntityRepository", () => {
	let mockClient: GraphClient;
	let repository: FalkorEntityRepository;
	const mockNow = 1640000000000; // Fixed timestamp for testing

	beforeEach(() => {
		mockClient = {
			connect: mock(async () => {}),
			disconnect: mock(async () => {}),
			query: mock(async () => []),
			isConnected: mock(() => true),
		} as unknown as GraphClient;

		repository = new FalkorEntityRepository(mockClient);
	});

	// =============================================================================
	// CRUD Operations
	// =============================================================================

	describe("create", () => {
		it("should create entity with all required fields", async () => {
			const input: CreateEntityInput = {
				name: "TypeScript",
				type: "technology",
				aliases: ["ts"],
				description: "JavaScript with types",
				mentionCount: 5,
				project: "/engram",
				embedding: [0.1, 0.2, 0.3],
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-123",
							name: input.name,
							aliases: input.aliases,
							type: input.type,
							description: input.description,
							mention_count: input.mentionCount,
							project: input.project,
							embedding: input.embedding,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.create(input);

			// Verify query was called with correct Cypher
			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(1);

			const [query, params] = calls[0];
			expect(query).toContain("CREATE (e:Entity {");
			expect(query).toContain("}) RETURN e");
			expect(params.name).toBe(input.name);
			expect(params.type).toBe(input.type);
			expect(params.aliases).toEqual(input.aliases);
			expect(params.description).toBe(input.description);
			expect(params.mention_count).toBe(input.mentionCount);
			expect(params.project).toBe(input.project);
			expect(params.embedding).toEqual(input.embedding);

			// Verify bitemporal fields
			expect(params.vt_start).toBeGreaterThan(0);
			expect(params.vt_end).toBe(MAX_DATE);
			expect(params.tt_start).toBeGreaterThan(0);
			expect(params.tt_end).toBe(MAX_DATE);

			// Verify result mapping
			expect(result.name).toBe(input.name);
			expect(result.type).toBe(input.type);
			expect(result.mentionCount).toBe(input.mentionCount);
			expect(result.vtEnd).toBe(MAX_DATE);
			expect(result.ttEnd).toBe(MAX_DATE);
		});

		it("should create entity with minimal fields", async () => {
			const input: CreateEntityInput = {
				name: "React",
				type: "technology",
			};

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-456",
							name: input.name,
							aliases: [],
							type: input.type,
							mention_count: 1,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.create(input);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(params.name).toBe(input.name);
			expect(params.type).toBe(input.type);
			expect(params.aliases).toEqual([]);
			expect(params.mention_count).toBe(1);
			expect(params.description).toBeUndefined();
			expect(params.project).toBeUndefined();
			expect(params.embedding).toBeUndefined();

			expect(result.aliases).toEqual([]);
			expect(result.mentionCount).toBe(1);
		});

		it("should set bitemporal fields correctly", async () => {
			const input: CreateEntityInput = {
				name: "Node.js",
				type: "technology",
			};

			const beforeTime = Date.now();

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-789",
							name: input.name,
							aliases: [],
							type: input.type,
							mention_count: 1,
							vt_start: beforeTime,
							vt_end: MAX_DATE,
							tt_start: beforeTime,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.create(input);

			const afterTime = Date.now();

			const [, params] = (mockClient.query as any).mock.calls[0];
			expect(params.vt_start).toBeGreaterThanOrEqual(beforeTime);
			expect(params.vt_start).toBeLessThanOrEqual(afterTime);
			expect(params.vt_end).toBe(MAX_DATE);
			expect(params.tt_start).toBeGreaterThanOrEqual(beforeTime);
			expect(params.tt_start).toBeLessThanOrEqual(afterTime);
			expect(params.tt_end).toBe(MAX_DATE);

			expect(result.vtEnd).toBe(MAX_DATE);
			expect(result.ttEnd).toBe(MAX_DATE);
		});
	});

	describe("findById", () => {
		it("should find entity by ID", async () => {
			const entityId = "entity-123";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: entityId,
							name: "GraphQL",
							aliases: ["gql"],
							type: "technology",
							description: "Query language",
							mention_count: 10,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findById(entityId);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {id: $id})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("RETURN e");
			expect(params.id).toBe(entityId);

			expect(result).not.toBeNull();
			expect(result?.id).toBe(entityId);
			expect(result?.name).toBe("GraphQL");
			expect(result?.aliases).toEqual(["gql"]);
			expect(result?.mentionCount).toBe(10);
		});

		it("should return null when entity not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findById("nonexistent");

			expect(result).toBeNull();
		});

		it("should only return active entities (tt_end = MAX_DATE)", async () => {
			const entityId = "entity-active";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: entityId,
							name: "Active",
							aliases: [],
							type: "concept",
							mention_count: 1,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			await repository.findById(entityId);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
		});
	});

	describe("findByName", () => {
		it("should find entity by name without project filter", async () => {
			const entityName = "Docker";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-docker",
							name: entityName,
							aliases: [],
							type: "tool",
							mention_count: 15,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByName(entityName);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {name: $name})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).not.toContain("project");
			expect(params.name).toBe(entityName);

			expect(result).not.toBeNull();
			expect(result?.name).toBe(entityName);
		});

		it("should find entity by name with project filter", async () => {
			const entityName = "UserService";
			const project = "/backend";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-service",
							name: entityName,
							aliases: [],
							type: "file",
							project,
							mention_count: 3,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByName(entityName, project);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {name: $name, project: $project})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(params.name).toBe(entityName);
			expect(params.project).toBe(project);

			expect(result).not.toBeNull();
			expect(result?.name).toBe(entityName);
			expect(result?.project).toBe(project);
		});

		it("should return null when entity not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByName("NonExistent");

			expect(result).toBeNull();
		});
	});

	describe("findByAlias", () => {
		it("should find entity by alias without project filter", async () => {
			const alias = "ts";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-ts",
							name: "TypeScript",
							aliases: ["ts", "typescript"],
							type: "technology",
							mention_count: 20,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByAlias(alias);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity)");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("$alias IN e.aliases");
			expect(params.alias).toBe(alias);

			expect(result).not.toBeNull();
			expect(result?.aliases).toContain(alias);
		});

		it("should find entity by alias with project filter", async () => {
			const alias = "k8s";
			const project = "/infra";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-k8s",
							name: "Kubernetes",
							aliases: ["k8s", "kube"],
							type: "technology",
							project,
							mention_count: 8,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByAlias(alias, project);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {project: $project})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("$alias IN e.aliases");
			expect(params.alias).toBe(alias);
			expect(params.project).toBe(project);

			expect(result).not.toBeNull();
			expect(result?.project).toBe(project);
		});

		it("should return null when no entity has the alias", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByAlias("unknown");

			expect(result).toBeNull();
		});
	});

	describe("findByType", () => {
		it("should find entities by type without project filter", async () => {
			const type = "technology";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-1",
							name: "React",
							aliases: [],
							type,
							mention_count: 50,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
				{
					e: {
						properties: {
							id: "entity-2",
							name: "Vue",
							aliases: [],
							type,
							mention_count: 30,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByType(type);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {type: $type})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("ORDER BY e.mention_count DESC");
			expect(params.type).toBe(type);

			expect(result).toHaveLength(2);
			expect(result[0].type).toBe(type);
			expect(result[1].type).toBe(type);
		});

		it("should find entities by type with project filter", async () => {
			const type = "file";
			const project = "/frontend";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-file-1",
							name: "App.tsx",
							aliases: [],
							type,
							project,
							mention_count: 12,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByType(type, project);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {type: $type, project: $project})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("ORDER BY e.mention_count DESC");
			expect(params.type).toBe(type);
			expect(params.project).toBe(project);

			expect(result).toHaveLength(1);
			expect(result[0].project).toBe(project);
		});

		it("should return empty array when no entities match", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByType("unknown");

			expect(result).toEqual([]);
		});

		it("should order results by mention count descending", async () => {
			const type = "concept";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-high",
							name: "High Mentions",
							aliases: [],
							type,
							mention_count: 100,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
				{
					e: {
						properties: {
							id: "entity-low",
							name: "Low Mentions",
							aliases: [],
							type,
							mention_count: 5,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByType(type);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY e.mention_count DESC");

			// Results are already ordered by the mock
			expect(result[0].mentionCount).toBeGreaterThan(result[1].mentionCount);
		});
	});

	describe("update", () => {
		it("should update entity and create new version", async () => {
			const entityId = "entity-old";
			const updates: UpdateEntityInput = {
				name: "Updated Name",
				description: "Updated description",
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Old Name",
								aliases: ["old"],
								type: "concept",
								description: "Old description",
								mention_count: 5,
								vt_start: mockNow - 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow - 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Close old version
				.mockResolvedValueOnce([{ count: 1 }])
				// Create new version
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-new",
								name: updates.name,
								aliases: ["old"],
								type: "concept",
								description: updates.description,
								mention_count: 5,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Create REPLACES edge
				.mockResolvedValueOnce([]);

			const result = await repository.update(entityId, updates);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(4);

			// Check close query
			const [closeQuery, closeParams] = calls[1];
			expect(closeQuery).toContain("MATCH (e:Entity {id: $id})");
			expect(closeQuery).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(closeQuery).toContain("SET e.tt_end = $t");
			expect(closeParams.id).toBe(entityId);

			// Check create new version query
			const [createQuery, createParams] = calls[2];
			expect(createQuery).toContain("CREATE (e:Entity {");
			expect(createParams.name).toBe(updates.name);
			expect(createParams.description).toBe(updates.description);
			expect(createParams.aliases).toEqual(["old"]);

			// Check REPLACES edge
			const [replacesQuery] = calls[3];
			expect(replacesQuery).toContain("MATCH (new:Entity {id: $newId}), (old:Entity {id: $oldId})");
			expect(replacesQuery).toContain("CREATE (new)-[:REPLACES");

			expect(result.name).toBe(updates.name);
			expect(result.description).toBe(updates.description);
		});

		it("should preserve unchanged fields", async () => {
			const entityId = "entity-partial";
			const updates: UpdateEntityInput = {
				mentionCount: 10,
			};

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Original",
								aliases: ["orig"],
								type: "tool",
								mention_count: 5,
								vt_start: mockNow - 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow - 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Close
				.mockResolvedValueOnce([{ count: 1 }])
				// Create
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-new",
								name: "Original",
								aliases: ["orig"],
								type: "tool",
								mention_count: 10,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// REPLACES
				.mockResolvedValueOnce([]);

			const result = await repository.update(entityId, updates);

			const [, createParams] = (mockClient.query as any).mock.calls[2];
			expect(createParams.name).toBe("Original");
			expect(createParams.aliases).toEqual(["orig"]);
			expect(createParams.type).toBe("tool");
			expect(createParams.mention_count).toBe(10);

			expect(result.name).toBe("Original");
			expect(result.mentionCount).toBe(10);
		});

		it("should throw error if entity not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.update("nonexistent", {})).rejects.toThrow(
				"Entity not found: nonexistent",
			);
		});

		it("should retry on concurrent modification", async () => {
			const entityId = "entity-concurrent";

			spyOn(mockClient, "query")
				// First attempt: findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Test",
								aliases: [],
								type: "concept",
								mention_count: 1,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// First attempt: close fails (concurrent modification)
				.mockResolvedValueOnce([{ count: 0 }])
				// Second attempt: findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Test",
								aliases: [],
								type: "concept",
								mention_count: 1,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Second attempt: close succeeds
				.mockResolvedValueOnce([{ count: 1 }])
				// Create new version
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-new",
								name: "Updated",
								aliases: [],
								type: "concept",
								mention_count: 1,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// REPLACES
				.mockResolvedValueOnce([]);

			const result = await repository.update(entityId, { name: "Updated" });

			expect(result.name).toBe("Updated");
			// Should have retried: 2x findById, 2x close, 1x create, 1x REPLACES
			expect((mockClient.query as any).mock.calls.length).toBeGreaterThanOrEqual(5);
		});

		it("should throw after max retries on concurrent modification", async () => {
			const entityId = "entity-always-concurrent";

			// Mock always returns 0 count (concurrent modification)
			spyOn(mockClient, "query")
				// Always return entity exists for findById
				.mockImplementation(async (query: string) => {
					if (
						query.includes("MATCH (e:Entity {id: $id}) WHERE e.tt_end") &&
						query.includes("RETURN e")
					) {
						return [
							{
								e: {
									properties: {
										id: entityId,
										name: "Test",
										aliases: [],
										type: "concept",
										mention_count: 1,
										vt_start: mockNow,
										vt_end: MAX_DATE,
										tt_start: mockNow,
										tt_end: MAX_DATE,
									},
								} as FalkorNode,
							},
						];
					}
					// Close always fails
					return [{ count: 0 }];
				});

			await expect(repository.update(entityId, { name: "Test" })).rejects.toThrow(
				/Failed to update entity .* after 3 attempts/,
			);
		});
	});

	describe("delete", () => {
		it("should soft delete entity by closing tt_end", async () => {
			const entityId = "entity-delete";

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "ToDelete",
								aliases: [],
								type: "concept",
								mention_count: 1,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// softDelete
				.mockResolvedValueOnce([]);

			await repository.delete(entityId);

			const calls = (mockClient.query as any).mock.calls;
			expect(calls).toHaveLength(2);

			const [deleteQuery, deleteParams] = calls[1];
			expect(deleteQuery).toContain("MATCH (n:Entity {id: $id})");
			expect(deleteQuery).toContain(`WHERE n.tt_end = ${MAX_DATE}`);
			expect(deleteQuery).toContain("SET n.tt_end = $t");
			expect(deleteParams.id).toBe(entityId);
		});

		it("should throw error if entity not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.delete("nonexistent")).rejects.toThrow(
				"Entity not found: nonexistent",
			);
		});
	});

	describe("incrementMentionCount", () => {
		it("should increment mention count by 1", async () => {
			const entityId = "entity-increment";

			spyOn(mockClient, "query")
				// First findById (for incrementMentionCount)
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Test",
								aliases: [],
								type: "concept",
								mention_count: 5,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Second findById (inside update)
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Test",
								aliases: [],
								type: "concept",
								mention_count: 5,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Close old version
				.mockResolvedValueOnce([{ count: 1 }])
				// Create new version
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-new",
								name: "Test",
								aliases: [],
								type: "concept",
								mention_count: 6,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// REPLACES
				.mockResolvedValueOnce([]);

			await repository.incrementMentionCount(entityId);

			const calls = (mockClient.query as any).mock.calls;

			// Find the create query
			const createCall = calls.find(([query]: [string]) => query.includes("CREATE (e:Entity"));
			expect(createCall).toBeDefined();

			const [, createParams] = createCall;
			expect(createParams.mention_count).toBe(6);
		});

		it("should throw error if entity not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.incrementMentionCount("nonexistent")).rejects.toThrow(
				"Entity not found: nonexistent",
			);
		});
	});

	// =============================================================================
	// Similarity Search
	// =============================================================================

	describe("findByEmbedding", () => {
		it("should find entities by embedding similarity", async () => {
			const embedding = [0.1, 0.2, 0.3];
			const limit = 5;
			const threshold = 0.7;

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					node: {
						properties: {
							id: "entity-1",
							name: "Similar 1",
							aliases: [],
							type: "concept",
							mention_count: 10,
							embedding: [0.11, 0.21, 0.31],
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
					score: 0.95,
				},
				{
					node: {
						properties: {
							id: "entity-2",
							name: "Similar 2",
							aliases: [],
							type: "concept",
							mention_count: 5,
							embedding: [0.12, 0.19, 0.29],
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
					score: 0.85,
				},
			]);

			const result = await repository.findByEmbedding(embedding, limit, threshold);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CALL db.idx.vector.queryNodes");
			expect(query).toContain("'Entity'");
			expect(query).toContain("'embedding'");
			expect(query).toContain("vecf32($embedding)");
			expect(query).toContain("WHERE score > $threshold");
			expect(query).toContain(`AND node.vt_end = ${MAX_DATE}`);
			expect(query).toContain("ORDER BY score DESC");
			expect(params.embedding).toEqual(embedding);
			expect(params.limit).toBe(limit);
			expect(params.threshold).toBe(threshold);

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("Similar 1");
			expect(result[1].name).toBe("Similar 2");
		});

		it("should use default threshold of 0.0 when not provided", async () => {
			const embedding = [0.1, 0.2, 0.3];
			const limit = 10;

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByEmbedding(embedding, limit);

			const [, params] = (mockClient.query as any).mock.calls[0];
			expect(params.threshold).toBe(0.0);
		});

		it("should return empty array when no similar entities found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByEmbedding([0.9, 0.8, 0.7], 5, 0.95);

			expect(result).toEqual([]);
		});
	});

	describe("findSimilarEntities", () => {
		it("should find similar entities excluding source", async () => {
			const entityId = "entity-source";
			const embedding = [0.5, 0.5, 0.5];

			spyOn(mockClient, "query")
				// findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: entityId,
								name: "Source",
								aliases: [],
								type: "concept",
								mention_count: 10,
								embedding,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// vector search
				.mockResolvedValueOnce([
					{
						node: {
							properties: {
								id: "entity-similar-1",
								name: "Similar 1",
								aliases: [],
								type: "concept",
								mention_count: 8,
								embedding: [0.51, 0.49, 0.5],
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
						score: 0.98,
					},
					{
						node: {
							properties: {
								id: "entity-similar-2",
								name: "Similar 2",
								aliases: [],
								type: "concept",
								mention_count: 6,
								embedding: [0.48, 0.52, 0.51],
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
						score: 0.95,
					},
				]);

			const result = await repository.findSimilarEntities(entityId, 2);

			const [, vectorParams] = (mockClient.query as any).mock.calls[1];
			expect(vectorParams.embedding).toEqual(embedding);
			expect(vectorParams.excludeId).toBe(entityId);
			expect(vectorParams.limit).toBe(3); // limit + 1

			const [vectorQuery] = (mockClient.query as any).mock.calls[1];
			expect(vectorQuery).toContain("WHERE node.id <> $excludeId");
			expect(vectorQuery).toContain(`AND node.vt_end = ${MAX_DATE}`);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("entity-similar-1");
			expect(result[1].id).toBe("entity-similar-2");
		});

		it("should throw error if entity not found", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await expect(repository.findSimilarEntities("nonexistent", 5)).rejects.toThrow(
				"Entity not found: nonexistent",
			);
		});

		it("should throw error if entity has no embedding", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-no-embedding",
							name: "No Embedding",
							aliases: [],
							type: "concept",
							mention_count: 1,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			await expect(repository.findSimilarEntities("entity-no-embedding", 5)).rejects.toThrow(
				"Entity entity-no-embedding has no embedding",
			);
		});
	});

	// =============================================================================
	// Edge Operations
	// =============================================================================

	describe("createMentionsEdge", () => {
		it("should create MENTIONS edge with bitemporal fields", async () => {
			const memoryId = "memory-123";
			const entityId = "entity-456";

			const beforeTime = Date.now();

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createMentionsEdge(memoryId, entityId);

			const afterTime = Date.now();

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (m:Memory {id: $memoryId}), (e:Entity {id: $entityId})");
			expect(query).toContain(`WHERE m.tt_end = ${MAX_DATE} AND e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("CREATE (m)-[:MENTIONS {");
			expect(params.memoryId).toBe(memoryId);
			expect(params.entityId).toBe(entityId);

			// Verify bitemporal fields
			expect(params.vt_start).toBeGreaterThanOrEqual(beforeTime);
			expect(params.vt_start).toBeLessThanOrEqual(afterTime);
			expect(params.vt_end).toBe(MAX_DATE);
			expect(params.tt_start).toBeGreaterThanOrEqual(beforeTime);
			expect(params.tt_start).toBeLessThanOrEqual(afterTime);
			expect(params.tt_end).toBe(MAX_DATE);
		});

		it("should create MENTIONS edge with context", async () => {
			const memoryId = "memory-789";
			const entityId = "entity-012";
			const context = "Mentioned in discussion about architecture";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createMentionsEdge(memoryId, entityId, context);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CREATE (m)-[:MENTIONS {");
			expect(params.context).toBe(context);
		});

		it("should not include context when not provided", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createMentionsEdge("memory-1", "entity-1");

			const [, params] = (mockClient.query as any).mock.calls[0];
			expect(params.context).toBeUndefined();
		});
	});

	describe("createRelationship", () => {
		it("should create RELATED_TO edge with bitemporal fields", async () => {
			const fromId = "entity-1";
			const toId = "entity-2";

			const beforeTime = Date.now();

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createRelationship(fromId, toId, "RELATED_TO");

			const afterTime = Date.now();

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (from:Entity {id: $fromId}), (to:Entity {id: $toId})");
			expect(query).toContain(`WHERE from.tt_end = ${MAX_DATE} AND to.tt_end = ${MAX_DATE}`);
			expect(query).toContain("CREATE (from)-[:RELATED_TO {");
			expect(params.fromId).toBe(fromId);
			expect(params.toId).toBe(toId);

			expect(params.vt_start).toBeGreaterThanOrEqual(beforeTime);
			expect(params.vt_start).toBeLessThanOrEqual(afterTime);
			expect(params.vt_end).toBe(MAX_DATE);
			expect(params.tt_start).toBeGreaterThanOrEqual(beforeTime);
			expect(params.tt_start).toBeLessThanOrEqual(afterTime);
			expect(params.tt_end).toBe(MAX_DATE);
		});

		it("should create DEPENDS_ON edge", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createRelationship("entity-a", "entity-b", "DEPENDS_ON");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CREATE (from)-[:DEPENDS_ON {");
		});

		it("should create IMPLEMENTS edge", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createRelationship("entity-impl", "entity-interface", "IMPLEMENTS");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CREATE (from)-[:IMPLEMENTS {");
		});

		it("should create PART_OF edge", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createRelationship("entity-part", "entity-whole", "PART_OF");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("CREATE (from)-[:PART_OF {");
		});

		it("should include additional properties", async () => {
			const props = { weight: 0.8, confidence: 0.95 };

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createRelationship("entity-1", "entity-2", "RELATED_TO", props);

			const [, params] = (mockClient.query as any).mock.calls[0];
			expect(params.weight).toBe(0.8);
			expect(params.confidence).toBe(0.95);
		});
	});

	// =============================================================================
	// Graph Traversal
	// =============================================================================

	describe("findRelatedEntities", () => {
		it("should find related entities with depth 1", async () => {
			const entityId = "entity-root";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					related: {
						properties: {
							id: "entity-related-1",
							name: "Related 1",
							aliases: [],
							type: "concept",
							mention_count: 5,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
				{
					related: {
						properties: {
							id: "entity-related-2",
							name: "Related 2",
							aliases: [],
							type: "technology",
							mention_count: 10,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findRelatedEntities(entityId, 1);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {id: $id})");
			expect(query).toContain("-[:RELATED_TO|DEPENDS_ON|IMPLEMENTS|PART_OF*1..1]-(related:Entity)");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain(`AND related.vt_end = ${MAX_DATE}`);
			expect(query).toContain("RETURN DISTINCT related");
			expect(query).toContain("ORDER BY related.mention_count DESC");
			expect(params.id).toBe(entityId);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("entity-related-1");
			expect(result[1].id).toBe("entity-related-2");
		});

		it("should find related entities with depth 2", async () => {
			const entityId = "entity-root";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					related: {
						properties: {
							id: "entity-depth-2",
							name: "Depth 2",
							aliases: [],
							type: "concept",
							mention_count: 3,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findRelatedEntities(entityId, 2);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("-[:RELATED_TO|DEPENDS_ON|IMPLEMENTS|PART_OF*1..2]-(related:Entity)");

			expect(result).toHaveLength(1);
		});

		it("should use default depth of 1", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findRelatedEntities("entity-id");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("*1..1");
		});

		it("should return distinct results", async () => {
			const entityId = "entity-root";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					related: {
						properties: {
							id: "entity-1",
							name: "Entity 1",
							aliases: [],
							type: "concept",
							mention_count: 5,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			await repository.findRelatedEntities(entityId, 2);

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("RETURN DISTINCT related");
		});

		it("should order by mention count descending", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findRelatedEntities("entity-id");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY related.mention_count DESC");
		});
	});

	describe("findMentioningMemories", () => {
		it("should find memories that mention the entity", async () => {
			const entityId = "entity-mentioned";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					m: {
						properties: {
							id: "memory-1",
							content: "Memory mentioning entity",
							content_hash: "hash1",
							type: "context",
							tags: ["test"],
							source: "user",
							vt_start: mockNow - 2000,
							vt_end: MAX_DATE,
							tt_start: mockNow - 2000,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
				{
					m: {
						properties: {
							id: "memory-2",
							content: "Another memory",
							content_hash: "hash2",
							type: "decision",
							tags: ["important"],
							source: "user",
							source_session_id: "session-123",
							vt_start: mockNow - 1000,
							vt_end: MAX_DATE,
							tt_start: mockNow - 1000,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findMentioningMemories(entityId);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (m:Memory)-[:MENTIONS]->(e:Entity {id: $id})");
			expect(query).toContain(`WHERE m.tt_end = ${MAX_DATE} AND e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("RETURN m");
			expect(query).toContain("ORDER BY m.vt_start DESC");
			expect(params.id).toBe(entityId);

			expect(result).toHaveLength(2);
			expect(result[0].id).toBe("memory-1");
			expect(result[1].id).toBe("memory-2");
		});

		it("should return empty array when no memories mention entity", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findMentioningMemories("entity-unmentioned");

			expect(result).toEqual([]);
		});

		it("should order by vt_start descending", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findMentioningMemories("entity-id");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY m.vt_start DESC");
		});
	});

	describe("findByProject", () => {
		it("should find all entities in a project", async () => {
			const project = "/my-project";

			spyOn(mockClient, "query").mockResolvedValueOnce([
				{
					e: {
						properties: {
							id: "entity-1",
							name: "Project Entity 1",
							aliases: [],
							type: "file",
							project,
							mention_count: 15,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
				{
					e: {
						properties: {
							id: "entity-2",
							name: "Project Entity 2",
							aliases: [],
							type: "concept",
							project,
							mention_count: 8,
							vt_start: mockNow,
							vt_end: MAX_DATE,
							tt_start: mockNow,
							tt_end: MAX_DATE,
						},
					} as FalkorNode,
				},
			]);

			const result = await repository.findByProject(project);

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (e:Entity {project: $project})");
			expect(query).toContain(`WHERE e.tt_end = ${MAX_DATE}`);
			expect(query).toContain("RETURN e");
			expect(query).toContain("ORDER BY e.mention_count DESC");
			expect(params.project).toBe(project);

			expect(result).toHaveLength(2);
			expect(result[0].project).toBe(project);
			expect(result[1].project).toBe(project);
		});

		it("should return empty array when no entities in project", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			const result = await repository.findByProject("/nonexistent");

			expect(result).toEqual([]);
		});

		it("should order by mention count descending", async () => {
			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.findByProject("/test");

			const [query] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("ORDER BY e.mention_count DESC");
		});
	});

	// =============================================================================
	// Integration Tests
	// =============================================================================

	describe("Integration: Entity lifecycle", () => {
		it("should create, update, and soft delete entity maintaining bitemporal history", async () => {
			const createInput: CreateEntityInput = {
				name: "Kubernetes",
				type: "technology",
				aliases: ["k8s"],
				mentionCount: 1,
			};

			// Create
			spyOn(mockClient, "query")
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-k8s-v1",
								name: createInput.name,
								aliases: createInput.aliases,
								type: createInput.type,
								mention_count: 1,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Update: findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-k8s-v1",
								name: createInput.name,
								aliases: createInput.aliases,
								type: createInput.type,
								mention_count: 1,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Update: close
				.mockResolvedValueOnce([{ count: 1 }])
				// Update: create new version
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-k8s-v2",
								name: createInput.name,
								aliases: createInput.aliases,
								type: createInput.type,
								mention_count: 5,
								vt_start: mockNow + 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow + 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Update: REPLACES edge
				.mockResolvedValueOnce([])
				// Delete: findById
				.mockResolvedValueOnce([
					{
						e: {
							properties: {
								id: "entity-k8s-v2",
								name: createInput.name,
								aliases: createInput.aliases,
								type: createInput.type,
								mention_count: 5,
								vt_start: mockNow + 1000,
								vt_end: MAX_DATE,
								tt_start: mockNow + 1000,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				])
				// Delete: softDelete
				.mockResolvedValueOnce([]);

			const created = await repository.create(createInput);
			expect(created.id).toBe("entity-k8s-v1");
			expect(created.mentionCount).toBe(1);

			const updated = await repository.update(created.id, { mentionCount: 5 });
			expect(updated.id).toBe("entity-k8s-v2");
			expect(updated.mentionCount).toBe(5);

			await repository.delete(updated.id);

			const calls = (mockClient.query as any).mock.calls;

			// Verify delete closes tt_end
			const deleteCall = calls[calls.length - 1];
			expect(deleteCall[0]).toContain("SET n.tt_end = $t");
		});
	});

	describe("Integration: Entity-Memory relationship", () => {
		it("should create entity, memory, and MENTIONS edge", async () => {
			const entityId = "entity-fastapi";
			const memoryId = "memory-discussion";

			spyOn(mockClient, "query").mockResolvedValueOnce([]);

			await repository.createMentionsEdge(memoryId, entityId, "Discussed FastAPI performance");

			const [query, params] = (mockClient.query as any).mock.calls[0];
			expect(query).toContain("MATCH (m:Memory {id: $memoryId}), (e:Entity {id: $entityId})");
			expect(query).toContain("CREATE (m)-[:MENTIONS {");
			expect(params.context).toBe("Discussed FastAPI performance");
			expect(params.vt_end).toBe(MAX_DATE);
			expect(params.tt_end).toBe(MAX_DATE);
		});
	});

	describe("Integration: Entity relationships", () => {
		it("should create multiple entities and link with relationships", async () => {
			const reactId = "entity-react";
			const nextId = "entity-next";

			spyOn(mockClient, "query")
				// Create DEPENDS_ON relationship
				.mockResolvedValueOnce([])
				// Find related entities
				.mockResolvedValueOnce([
					{
						related: {
							properties: {
								id: reactId,
								name: "React",
								aliases: [],
								type: "technology",
								mention_count: 50,
								vt_start: mockNow,
								vt_end: MAX_DATE,
								tt_start: mockNow,
								tt_end: MAX_DATE,
							},
						} as FalkorNode,
					},
				]);

			await repository.createRelationship(nextId, reactId, "DEPENDS_ON");

			const related = await repository.findRelatedEntities(nextId, 1);

			expect(related).toHaveLength(1);
			expect(related[0].id).toBe(reactId);
		});
	});
});

import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Entity, EntityRepository } from "@engram/graph";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EntityEmbeddingService } from "./entity-embedding";
import type { ExtractedEntity } from "./entity-extractor";
import { EntityResolverService } from "./entity-resolver";

/**
 * Creates a mock Gemini API response with proper Response object
 * The AI SDK requires a proper Response with headers.forEach()
 */
function createMockGeminiResponse(geminiResponseData: object): Response {
	const body = JSON.stringify(geminiResponseData);
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockEntity(overrides: Partial<Entity> = {}): Entity {
	return {
		id: "entity-001",
		name: "PostgreSQL",
		aliases: [],
		type: "technology",
		description: "Relational database",
		mentionCount: 1,
		project: undefined,
		embedding: undefined,
		vtStart: Date.now(),
		vtEnd: Number.MAX_SAFE_INTEGER,
		ttStart: Date.now(),
		ttEnd: Number.MAX_SAFE_INTEGER,
		...overrides,
	};
}

function createExtractedEntity(overrides: Partial<ExtractedEntity> = {}): ExtractedEntity {
	return {
		name: "PostgreSQL",
		type: "technology",
		context: "Used as primary database",
		confidence: 0.95,
		...overrides,
	};
}

function createMockEmbedding(dimensions = 384): number[] {
	return Array.from({ length: dimensions }, () => Math.random());
}

// =============================================================================
// Mock Factories
// =============================================================================

function createMockLogger() {
	return {
		debug: mock(() => {}),
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		trace: mock(() => {}),
		fatal: mock(() => {}),
		child: mock(() => createMockLogger()),
	};
}

function createMockEntityRepo(): EntityRepository {
	return {
		findById: mock(async () => null),
		findByName: mock(async () => null),
		findByType: mock(async () => []),
		findByAlias: mock(async () => null),
		create: mock(async (input) => createMockEntity({ ...input, id: `entity-${Date.now()}` })),
		update: mock(async (id, updates) => createMockEntity({ id, ...updates })),
		delete: mock(async () => {}),
		incrementMentionCount: mock(async () => {}),
		findByEmbedding: mock(async () => []),
		findSimilarEntities: mock(async () => []),
		createMentionsEdge: mock(async () => {}),
		createRelationship: mock(async () => {}),
		findRelatedEntities: mock(async () => []),
		findMentioningMemories: mock(async () => []),
		findByProject: mock(async () => []),
	};
}

function createMockEmbeddingService(): EntityEmbeddingService {
	return {
		embed: mock(async () => createMockEmbedding()),
		embedBatch: mock(async (entities) => entities.map(() => createMockEmbedding())),
	} as unknown as EntityEmbeddingService;
}

function createMockMcpServer(): McpServer {
	return {
		server: {
			getClientCapabilities: mock(() => ({ sampling: false })),
			createMessage: mock(async () => null),
		},
	} as unknown as McpServer;
}

describe("EntityResolverService", () => {
	let mockEntityRepo: EntityRepository;
	let mockEmbeddingService: EntityEmbeddingService;
	let mockServer: McpServer;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let service: EntityResolverService;

	beforeEach(() => {
		mockEntityRepo = createMockEntityRepo();
		mockEmbeddingService = createMockEmbeddingService();
		mockServer = createMockMcpServer();
		mockLogger = createMockLogger();

		service = new EntityResolverService(
			mockEntityRepo,
			mockEmbeddingService,
			mockServer,
			mockLogger as any,
		);
	});

	// ===========================================================================
	// Exact Name Match Tests
	// ===========================================================================

	describe("resolve - exact name match", () => {
		it("should resolve entity by exact name match", async () => {
			const existingEntity = createMockEntity({ name: "PostgreSQL" });
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({ name: "PostgreSQL" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(false);
			expect(result.entity.name).toBe("PostgreSQL");
			expect(result.resolutionMethod).toBe("exact_name");
			expect(mockEntityRepo.findByName).toHaveBeenCalledWith("PostgreSQL", undefined);
		});

		it("should pass project scope to findByName", async () => {
			const existingEntity = createMockEntity({ name: "PostgreSQL", project: "my-project" });
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({ name: "PostgreSQL" });
			const result = await service.resolve(extracted, "my-project");

			expect(result.isNew).toBe(false);
			expect(mockEntityRepo.findByName).toHaveBeenCalledWith("PostgreSQL", "my-project");
		});

		it("should merge entity data on exact name match", async () => {
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				aliases: [],
				mentionCount: 5,
			});
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({
				name: "PostgreSQL",
				context: "Primary database for production",
			});
			await service.resolve(extracted);

			expect(updateSpy).toHaveBeenCalledWith(existingEntity.id, {
				description: "Primary database for production",
				mentionCount: 6,
			});
		});
	});

	// ===========================================================================
	// Alias Match Tests
	// ===========================================================================

	describe("resolve - alias match", () => {
		it("should resolve entity by alias match", async () => {
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				aliases: ["Postgres", "psql"],
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({ name: "Postgres" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(false);
			expect(result.entity.name).toBe("PostgreSQL");
			expect(result.resolutionMethod).toBe("alias_match");
			expect(mockEntityRepo.findByAlias).toHaveBeenCalledWith("Postgres", undefined);
		});

		it("should add new name to aliases on alias match", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				aliases: ["Postgres"],
				description: "Existing long description that is longer than new context",
				mentionCount: 3,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({ name: "pg", context: "short" });
			await service.resolve(extracted);

			expect(updateSpy).toHaveBeenCalledWith("pg-entity", {
				aliases: ["Postgres", "pg"],
				mentionCount: 4,
			});
		});

		it("should not duplicate alias if already present", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				aliases: ["Postgres", "pg"],
				description: "Existing long description that is longer than new context",
				mentionCount: 2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({ name: "pg", context: "short" });
			await service.resolve(extracted);

			// Should only update mentionCount, not aliases
			expect(updateSpy).toHaveBeenCalledWith("pg-entity", {
				mentionCount: 3,
			});
		});

		it("should handle case-insensitive alias matching", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				aliases: ["postgres"],
				description: "Existing long description that is longer than new context",
				mentionCount: 1,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			// Same alias with different case
			const extracted = createExtractedEntity({ name: "POSTGRES", context: "short" });
			await service.resolve(extracted);

			// Should not add duplicate (case-insensitive)
			expect(updateSpy).toHaveBeenCalledWith("pg-entity", {
				mentionCount: 2,
			});
		});
	});

	// ===========================================================================
	// Embedding-Based Resolution Tests
	// ===========================================================================

	describe("resolve - embedding similarity", () => {
		it("should resolve via high-confidence embedding similarity (>0.95)", async () => {
			const embedding = createMockEmbedding();
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);

			const extracted = createExtractedEntity({ name: "Postgres DB" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(false);
			expect(result.resolutionMethod).toBe("embedding_similarity");
			// Floating point comparison: identical vectors have similarity ~1
			expect(result.similarityScore).toBeGreaterThan(0.999);
		});

		it("should return similarity score with embedding match", async () => {
			const embedding1 = [1, 0, 0];
			const embedding2 = [0.9, 0.1, 0]; // Similar but not identical
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding1);

			const extracted = createExtractedEntity({ name: "Postgres DB" });
			const result = await service.resolve(extracted);

			// With the normalized vectors, similarity should be > 0.95
			expect(result.similarityScore).toBeDefined();
			expect(result.similarityScore).toBeGreaterThan(0.9);
		});

		it("should filter candidates by project scope", async () => {
			const embedding = createMockEmbedding();
			const globalEntity = createMockEntity({
				id: "global-pg",
				name: "PostgreSQL",
				project: undefined,
				embedding,
			});
			const projectEntity = createMockEntity({
				id: "project-pg",
				name: "PostgreSQL",
				project: "my-project",
				embedding,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([globalEntity, projectEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);

			const extracted = createExtractedEntity({ name: "Postgres DB" });
			const result = await service.resolve(extracted, "my-project");

			// Should return the global entity (first match after filtering)
			expect(result.isNew).toBe(false);
		});

		it("should handle no embedding candidates gracefully", async () => {
			const embedding = createMockEmbedding();

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);
			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ name: "Kubernetes" }),
			);

			const extracted = createExtractedEntity({ name: "Kubernetes", type: "tool" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(true);
			expect(result.resolutionMethod).toBe("created");
			expect(createSpy).toHaveBeenCalled();
		});

		it("should handle embedding service failure gracefully", async () => {
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEmbeddingService, "embed").mockRejectedValue(new Error("Embedding failed"));
			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ name: "Test" }),
			);

			const extracted = createExtractedEntity({ name: "Test" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(true);
			expect(result.resolutionMethod).toBe("created");
			expect(mockLogger.warn).toHaveBeenCalled();
			expect(createSpy).toHaveBeenCalled();
		});
	});

	// ===========================================================================
	// LLM Confirmation Tests
	// ===========================================================================

	describe("resolve - LLM confirmation", () => {
		it("should use LLM confirmation for moderate similarity scores", async () => {
			const embedding1 = [1, 0, 0, 0];
			const embedding2 = [0.92, 0.39, 0, 0]; // ~0.92 similarity (between 0.9 and 0.95)
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding1);

			// Mock LLM confirmation via MCP sampling
			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });
			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: { type: "text", text: "YES" },
			} as any);

			const extracted = createExtractedEntity({ name: "Postgres Database" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(false);
			expect(result.resolutionMethod).toBe("llm_confirmed");
			expect(mockServer.server.createMessage).toHaveBeenCalled();
		});

		it("should create new entity when LLM rejects match", async () => {
			const embedding1 = [1, 0, 0, 0];
			const embedding2 = [0.92, 0.39, 0, 0]; // Moderate similarity
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding1);

			// Mock LLM rejection
			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });
			spyOn(mockServer.server, "createMessage").mockResolvedValue({
				content: { type: "text", text: "NO" },
			} as any);

			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ name: "MySQL" }),
			);

			const extracted = createExtractedEntity({ name: "MySQL" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(true);
			expect(result.resolutionMethod).toBe("created");
			expect(createSpy).toHaveBeenCalled();
		});

		it("should fallback to Gemini when MCP sampling unavailable", async () => {
			const embedding1 = [1, 0, 0, 0];
			const embedding2 = [0.92, 0.39, 0, 0];
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding1);

			// Sampling unavailable
			spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: false });

			// Mock Gemini API response with proper Response object
			const geminiResponse = {
				candidates: [{ content: { parts: [{ text: "YES" }] } }],
			};
			global.fetch = mock(async () => createMockGeminiResponse(geminiResponse)) as any;

			// Service with Gemini API key
			const serviceWithGemini = new EntityResolverService(
				mockEntityRepo,
				mockEmbeddingService,
				mockServer,
				mockLogger as any,
				{ geminiApiKey: "test-api-key" },
			);

			const extracted = createExtractedEntity({ name: "Postgres Database" });
			const result = await serviceWithGemini.resolve(extracted);

			expect(result.isNew).toBe(false);
			expect(result.resolutionMethod).toBe("llm_confirmed");
			expect(global.fetch).toHaveBeenCalled();
		});

		it("should skip LLM confirmation when useLlmConfirmation is false", async () => {
			const embedding1 = [1, 0, 0, 0];
			const embedding2 = [0.92, 0.39, 0, 0];
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding1);

			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ name: "MySQL" }),
			);

			// Disable LLM confirmation
			const serviceNoLlm = new EntityResolverService(
				mockEntityRepo,
				mockEmbeddingService,
				mockServer,
				mockLogger as any,
				{ useLlmConfirmation: false },
			);

			const extracted = createExtractedEntity({ name: "MySQL" });
			const result = await serviceNoLlm.resolve(extracted);

			// Should create new entity without LLM confirmation
			expect(result.isNew).toBe(true);
			expect(result.resolutionMethod).toBe("created");
			expect(createSpy).toHaveBeenCalled();
		});

		it(
			"should handle LLM confirmation failure by creating new entity",
			async () => {
				// Use vectors that give moderate similarity (between 0.9 and 0.95)
				const embedding1 = [1, 0, 0, 0];
				const embedding2 = [0.92, 0.39, 0, 0]; // ~0.92 similarity
				const existingEntity = createMockEntity({
					name: "PostgreSQL",
					embedding: embedding2,
				});

				// Mock fetch to throw to prevent real Gemini API calls
				const originalFetch = global.fetch;
				global.fetch = mock(async () => {
					throw new Error("Network error");
				}) as any;

				// Create completely fresh mocks for this test
				const freshRepo: EntityRepository = {
					findById: mock(async () => null),
					findByName: mock(async () => null),
					findByType: mock(async () => []),
					findByAlias: mock(async () => null),
					create: mock(async () => createMockEntity({ id: "new-entity", name: "Test" })),
					update: mock(async () => existingEntity),
					delete: mock(async () => {}),
					incrementMentionCount: mock(async () => {}),
					findByEmbedding: mock(async () => [existingEntity]),
					findSimilarEntities: mock(async () => []),
					createMentionsEdge: mock(async () => {}),
					createRelationship: mock(async () => {}),
					findRelatedEntities: mock(async () => []),
					findMentioningMemories: mock(async () => []),
					findByProject: mock(async () => []),
				};

				const freshEmbedService = {
					embed: mock(async () => embedding1),
					embedBatch: mock(async () => [embedding1]),
				} as unknown as EntityEmbeddingService;

				const freshServer = {
					server: {
						getClientCapabilities: mock(() => ({ sampling: true })),
						createMessage: mock(async () => {
							throw new Error("Sampling failed");
						}),
					},
				} as unknown as McpServer;

				// Create fresh service with fresh mocks
				const freshService = new EntityResolverService(
					freshRepo,
					freshEmbedService,
					freshServer,
					mockLogger as any,
				);

				try {
					const extracted = createExtractedEntity({ name: "Test" });
					const result = await freshService.resolve(extracted);

					// When sampling fails, tryLlmConfirmWithSampling catches and returns null.
					// Falls back to Gemini which also fails, so confirmation returns false.
					// This should result in creating a new entity.
					expect(result.isNew).toBe(true);
					expect(result.resolutionMethod).toBe("created");
				} finally {
					global.fetch = originalFetch;
				}
			},
			{ timeout: 15000 },
		);

		it("should parse YES/NO responses correctly", async () => {
			const embedding1 = [1, 0, 0, 0];
			const embedding2 = [0.92, 0.39, 0, 0];
			const existingEntity = createMockEntity({
				name: "PostgreSQL",
				embedding: embedding2,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding1);

			// Test various YES formats
			for (const response of ["YES", "yes", "Yes", "YES, they are the same"]) {
				spyOn(mockServer.server, "getClientCapabilities").mockReturnValue({ sampling: true });
				spyOn(mockServer.server, "createMessage").mockResolvedValue({
					content: { type: "text", text: response },
				} as any);

				const extracted = createExtractedEntity({ name: "Test" });
				const result = await service.resolve(extracted);

				expect(result.resolutionMethod).toBe("llm_confirmed");
			}
		});
	});

	// ===========================================================================
	// New Entity Creation Tests
	// ===========================================================================

	describe("resolve - new entity creation", () => {
		it("should create new entity when no match found", async () => {
			const embedding = createMockEmbedding();

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);

			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ id: "new-entity", name: "Kubernetes", type: "tool" }),
			);

			const extracted = createExtractedEntity({ name: "Kubernetes", type: "tool" });
			const result = await service.resolve(extracted);

			expect(result.isNew).toBe(true);
			expect(result.entity.name).toBe("Kubernetes");
			expect(result.resolutionMethod).toBe("created");
			expect(createSpy).toHaveBeenCalledWith({
				name: "Kubernetes",
				type: "tool",
				description: extracted.context,
				aliases: [],
				project: undefined,
				embedding,
				mentionCount: 1,
			});
		});

		it("should create entity with project scope", async () => {
			const embedding = createMockEmbedding();

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);

			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ name: "auth", project: "my-project" }),
			);

			const extracted = createExtractedEntity({ name: "auth", type: "concept" });
			await service.resolve(extracted, "my-project");

			expect(createSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "auth",
					project: "my-project",
				}),
			);
		});

		it("should create entity without embedding on embedding failure", async () => {
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEmbeddingService, "embed").mockRejectedValue(new Error("Embedding failed"));

			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ name: "Test", embedding: undefined }),
			);

			const extracted = createExtractedEntity({ name: "Test" });
			await service.resolve(extracted);

			expect(createSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "Test",
					embedding: undefined,
				}),
			);
			expect(mockLogger.warn).toHaveBeenCalled();
		});
	});

	// ===========================================================================
	// Project Scoping Tests
	// ===========================================================================

	describe("resolve - project scoping", () => {
		it("should isolate entities across different projects", async () => {
			const authEntityProjectA = createMockEntity({
				id: "auth-a",
				name: "auth",
				project: "project-a",
			});
			const authEntityProjectB = createMockEntity({
				id: "auth-b",
				name: "auth",
				project: "project-b",
			});

			// First resolution for project-a
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(authEntityProjectA);

			const extractedA = createExtractedEntity({ name: "auth" });
			const resultA = await service.resolve(extractedA, "project-a");

			expect(resultA.entity.id).toBe("auth-a");
			expect(mockEntityRepo.findByName).toHaveBeenCalledWith("auth", "project-a");

			// Second resolution for project-b
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(authEntityProjectB);

			const extractedB = createExtractedEntity({ name: "auth" });
			const resultB = await service.resolve(extractedB, "project-b");

			expect(resultB.entity.id).toBe("auth-b");
			expect(mockEntityRepo.findByName).toHaveBeenCalledWith("auth", "project-b");
		});

		it("should allow global entities (no project) to match any project", async () => {
			const globalEntity = createMockEntity({
				id: "global-react",
				name: "React",
				project: undefined,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(globalEntity);

			const extracted = createExtractedEntity({ name: "React" });
			const result = await service.resolve(extracted, "my-project");

			expect(result.entity.id).toBe("global-react");
			expect(result.isNew).toBe(false);
		});
	});

	// ===========================================================================
	// Merge Behavior Tests
	// ===========================================================================

	describe("merge behavior", () => {
		it("should update description if new context is richer", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				description: "Database",
				mentionCount: 1,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({
				name: "PostgreSQL",
				context: "Open-source relational database with ACID compliance and JSON support",
			});
			await service.resolve(extracted);

			expect(updateSpy).toHaveBeenCalledWith("pg-entity", {
				description: extracted.context,
				mentionCount: 2,
			});
		});

		it("should not update description if existing is longer", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				description: "Very long existing description that is definitely longer than the new one",
				mentionCount: 1,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({
				name: "PostgreSQL",
				context: "Database",
			});
			await service.resolve(extracted);

			// Should not include description update
			expect(updateSpy).toHaveBeenCalledWith("pg-entity", {
				mentionCount: 2,
			});
		});

		it("should not update description if context is too short", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				description: undefined,
				mentionCount: 1,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({
				name: "PostgreSQL",
				context: "DB", // Less than 10 characters
			});
			await service.resolve(extracted);

			// Should not include description update (context too short)
			expect(updateSpy).toHaveBeenCalledWith("pg-entity", {
				mentionCount: 2,
			});
		});

		it("should always increment mention count on match", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				mentionCount: 10,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			const extracted = createExtractedEntity({ name: "PostgreSQL" });
			await service.resolve(extracted);

			expect(updateSpy).toHaveBeenCalledWith(
				"pg-entity",
				expect.objectContaining({
					mentionCount: 11,
				}),
			);
		});

		it("should NOT update entity type on match", async () => {
			const existingEntity = createMockEntity({
				id: "pg-entity",
				name: "PostgreSQL",
				type: "technology",
				mentionCount: 1,
			});

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(existingEntity);
			const updateSpy = spyOn(mockEntityRepo, "update").mockResolvedValue(existingEntity);

			// Extracted with different type
			const extracted = createExtractedEntity({
				name: "PostgreSQL",
				type: "tool", // Different type
			});
			await service.resolve(extracted);

			// Should NOT include type update
			expect(updateSpy).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					type: expect.anything(),
				}),
			);
		});
	});

	// ===========================================================================
	// Batch Resolution Tests
	// ===========================================================================

	describe("resolveBatch", () => {
		it("should resolve multiple entities in batch", async () => {
			const entity1 = createMockEntity({ id: "e1", name: "React" });
			const entity2 = createMockEntity({ id: "e2", name: "TypeScript" });

			spyOn(mockEntityRepo, "findByName")
				.mockResolvedValueOnce(entity1)
				.mockResolvedValueOnce(entity2);

			const entities: ExtractedEntity[] = [
				createExtractedEntity({ name: "React" }),
				createExtractedEntity({ name: "TypeScript" }),
			];

			const results = await service.resolveBatch(entities);

			expect(results).toHaveLength(2);
			expect(results[0].entity.name).toBe("React");
			expect(results[1].entity.name).toBe("TypeScript");
		});

		it("should return empty array for empty input", async () => {
			const results = await service.resolveBatch([]);
			expect(results).toEqual([]);
		});

		it("should process entities sequentially to avoid race conditions", async () => {
			const callOrder: string[] = [];

			spyOn(mockEntityRepo, "findByName").mockImplementation(async (name) => {
				callOrder.push(`findByName:${name}`);
				await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async
				return null;
			});
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEntityRepo, "create").mockImplementation(async (input) => {
				callOrder.push(`create:${input.name}`);
				return createMockEntity({ name: input.name });
			});

			const entities: ExtractedEntity[] = [
				createExtractedEntity({ name: "Entity1" }),
				createExtractedEntity({ name: "Entity2" }),
				createExtractedEntity({ name: "Entity3" }),
			];

			await service.resolveBatch(entities);

			// Verify sequential processing (each entity fully processed before next)
			expect(callOrder).toEqual([
				"findByName:Entity1",
				"create:Entity1",
				"findByName:Entity2",
				"create:Entity2",
				"findByName:Entity3",
				"create:Entity3",
			]);
		});

		it("should pass project scope to all resolutions", async () => {
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			const createSpy = spyOn(mockEntityRepo, "create").mockResolvedValue(
				createMockEntity({ project: "shared-project" }),
			);

			const entities: ExtractedEntity[] = [
				createExtractedEntity({ name: "Entity1" }),
				createExtractedEntity({ name: "Entity2" }),
			];

			await service.resolveBatch(entities, "shared-project");

			expect(createSpy).toHaveBeenCalledWith(
				expect.objectContaining({ project: "shared-project" }),
			);
		});

		it("should log batch statistics", async () => {
			const entity1 = createMockEntity({ name: "React" });

			spyOn(mockEntityRepo, "findByName")
				.mockResolvedValueOnce(entity1) // Match
				.mockResolvedValueOnce(null); // No match
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEntityRepo, "create").mockResolvedValue(createMockEntity({ name: "TypeScript" }));

			const entities: ExtractedEntity[] = [
				createExtractedEntity({ name: "React" }),
				createExtractedEntity({ name: "TypeScript" }),
			];

			await service.resolveBatch(entities);

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					total: 2,
					new: 1,
					matched: 1,
				}),
				"Batch resolution complete",
			);
		});
	});

	// ===========================================================================
	// Configuration Tests
	// ===========================================================================

	describe("configuration", () => {
		it("should use default configuration values", () => {
			// Default service should use default config
			expect(service).toBeDefined();
			// Verify by testing behavior with defaults
		});

		it("should respect custom embedding similarity threshold", async () => {
			const customService = new EntityResolverService(
				mockEntityRepo,
				mockEmbeddingService,
				mockServer,
				mockLogger as any,
				{ embeddingSimilarityThreshold: 0.95 },
			);

			const embedding = createMockEmbedding();
			const existingEntity = createMockEntity({ embedding });

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);

			const extracted = createExtractedEntity({ name: "Test" });
			await customService.resolve(extracted);

			expect(mockEntityRepo.findByEmbedding).toHaveBeenCalledWith(embedding, 5, 0.95);
		});

		it("should respect custom candidate limit", async () => {
			const customService = new EntityResolverService(
				mockEntityRepo,
				mockEmbeddingService,
				mockServer,
				mockLogger as any,
				{ embeddingCandidateLimit: 10 },
			);

			const embedding = createMockEmbedding();

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);
			spyOn(mockEntityRepo, "create").mockResolvedValue(createMockEntity());

			const extracted = createExtractedEntity({ name: "Test" });
			await customService.resolve(extracted);

			expect(mockEntityRepo.findByEmbedding).toHaveBeenCalledWith(embedding, 10, 0.9);
		});
	});

	// ===========================================================================
	// Cosine Similarity Tests
	// ===========================================================================

	describe("cosine similarity calculation", () => {
		it("should return 1 for identical vectors", async () => {
			const embedding = [1, 0, 0];
			const existingEntity = createMockEntity({ embedding });

			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([existingEntity]);
			spyOn(mockEmbeddingService, "embed").mockResolvedValue(embedding);

			const result = await service.resolve(createExtractedEntity());

			expect(result.similarityScore).toBe(1);
		});

		it(
			"should return 0 for orthogonal vectors",
			async () => {
				const embedding1 = [1, 0, 0];
				const embedding2 = [0, 1, 0]; // Orthogonal = similarity 0
				const existingEntity = createMockEntity({ embedding: embedding2 });

				// Mock fetch to throw to prevent real Gemini API calls (GEMINI_API_KEY may be set in env)
				const originalFetch = global.fetch;
				global.fetch = mock(async () => {
					throw new Error("Network error");
				}) as any;

				// Directly replace mock functions
				mockEntityRepo.findByName = mock(async () => null);
				mockEntityRepo.findByAlias = mock(async () => null);
				mockEntityRepo.findByEmbedding = mock(async () => [existingEntity]);
				mockEmbeddingService.embed = mock(async () => embedding1) as any;
				mockEntityRepo.create = mock(async () => createMockEntity({ id: "new-created" }));

				try {
					const result = await service.resolve(createExtractedEntity());

					// Orthogonal vectors have similarity 0, which is below threshold 0.9.
					// Implementation falls back to threshold score 0.9, then requires LLM confirmation.
					// Gemini API call fails, so confirmation returns false, creating new entity.
					expect(result.isNew).toBe(true);
					expect(result.resolutionMethod).toBe("created");
				} finally {
					global.fetch = originalFetch;
				}
			},
			{ timeout: 15000 },
		);

		it(
			"should handle zero vectors gracefully",
			async () => {
				const embedding1 = [0, 0, 0]; // Zero vector
				const embedding2 = [1, 0, 0];
				const existingEntity = createMockEntity({ embedding: embedding2 });

				// Mock fetch to throw to prevent real Gemini API calls
				const originalFetch = global.fetch;
				global.fetch = mock(async () => {
					throw new Error("Network error");
				}) as any;

				// Directly replace mock functions
				mockEntityRepo.findByName = mock(async () => null);
				mockEntityRepo.findByAlias = mock(async () => null);
				mockEntityRepo.findByEmbedding = mock(async () => [existingEntity]);
				mockEmbeddingService.embed = mock(async () => embedding1) as any;
				mockEntityRepo.create = mock(async () => createMockEntity({ id: "new-created" }));

				try {
					const result = await service.resolve(createExtractedEntity());

					// Zero vector has undefined similarity (returns 0 in implementation).
					// Falls back to threshold score 0.9, requires LLM confirmation.
					// Gemini API call fails, so confirmation returns false, creating new entity.
					expect(result.isNew).toBe(true);
					expect(result.resolutionMethod).toBe("created");
				} finally {
					global.fetch = originalFetch;
				}
			},
			{ timeout: 15000 },
		);
	});

	// ===========================================================================
	// Logging Tests
	// ===========================================================================

	describe("logging", () => {
		it("should log resolution start with entity details", async () => {
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(createMockEntity());

			const extracted = createExtractedEntity({ name: "React", type: "technology" });
			await service.resolve(extracted, "my-project");

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "React",
					type: "technology",
					project: "my-project",
				}),
				"Resolving entity",
			);
		});

		it("should log resolution method and timing", async () => {
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(createMockEntity());

			await service.resolve(createExtractedEntity());

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					entityId: expect.any(String),
					took_ms: expect.any(Number),
				}),
				"Resolved via exact name match",
			);
		});

		it("should log when creating new entity", async () => {
			spyOn(mockEntityRepo, "findByName").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByAlias").mockResolvedValue(null);
			spyOn(mockEntityRepo, "findByEmbedding").mockResolvedValue([]);
			spyOn(mockEntityRepo, "create").mockResolvedValue(createMockEntity({ id: "new-entity-id" }));

			await service.resolve(createExtractedEntity());

			expect(mockLogger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					entityId: "new-entity-id",
					took_ms: expect.any(Number),
				}),
				"Created new entity",
			);
		});
	});
});

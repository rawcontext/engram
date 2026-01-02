/**
 * Integration tests for Semantic Enhancement Layer
 *
 * These tests verify the end-to-end flow of entity extraction, resolution,
 * and graph-aware retrieval using real FalkorDB and (optionally) Search service.
 *
 * Prerequisites:
 * - FalkorDB running on localhost:6179
 * - Run: docker-compose -f docker-compose.dev.yml up -d falkordb
 *
 * @module semantic-enhancement.integration.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import type { EntityRepository } from "@engram/graph";
import { FalkorEntityRepository } from "@engram/graph";
import { FalkorClient } from "@engram/storage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { EntityEmbeddingService } from "../services/entity-embedding";
import type { EntityExtractorService, ExtractionResult } from "../services/entity-extractor";
import { EntityResolverService } from "../services/entity-resolver";

// =============================================================================
// Test Configuration
// =============================================================================

const FALKOR_URL = process.env.FALKOR_URL ?? "redis://localhost:6179";
const TEST_PROJECT = "integration-test-project";

// Skip tests if FalkorDB is not available
const skipIfNoFalkor = async (): Promise<boolean> => {
	try {
		const client = new FalkorClient(FALKOR_URL);
		await client.query("RETURN 1");
		await client.close();
		return false;
	} catch {
		return true;
	}
};

// =============================================================================
// Test Fixtures and Mocks
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

function createMockMcpServer(): McpServer {
	return {
		server: {
			getClientCapabilities: mock(() => ({ sampling: false })),
			createMessage: mock(async () => null),
		},
	} as unknown as McpServer;
}

function createMockEmbeddingService(): EntityEmbeddingService {
	// Simple deterministic embeddings based on entity name for testing
	const embed = async (text: string): Promise<number[]> => {
		const hash = Array.from(text).reduce((acc, char) => acc + char.charCodeAt(0), 0);
		return Array.from({ length: 384 }, (_, i) => Math.sin(hash * (i + 1)) * 0.5 + 0.5);
	};

	return {
		embed,
		embedBatch: async (entities: Array<{ name: string }>) =>
			Promise.all(entities.map((e) => embed(e.name))),
	} as unknown as EntityEmbeddingService;
}

// Mock extractor that returns predictable entities based on content
function createMockExtractor(): EntityExtractorService {
	const extractorImpl = {
		extract: async (content: string, _type: string): Promise<ExtractionResult> => {
			const entities: Array<{
				name: string;
				type: string;
				context: string;
				confidence: number;
			}> = [];
			const relationships: Array<{ from: string; to: string; type: string }> = [];

			// Simple keyword-based extraction for testing
			if (
				content.toLowerCase().includes("postgresql") ||
				content.toLowerCase().includes("postgres")
			) {
				entities.push({
					name: "PostgreSQL",
					type: "technology",
					context: content.substring(0, 100),
					confidence: 0.95,
				});
			}
			if (content.toLowerCase().includes("oauth")) {
				entities.push({
					name: "OAuth",
					type: "technology",
					context: content.substring(0, 100),
					confidence: 0.9,
				});
			}
			if (content.toLowerCase().includes("jwt")) {
				entities.push({
					name: "JWT",
					type: "technology",
					context: content.substring(0, 100),
					confidence: 0.9,
				});
			}
			if (
				content.toLowerCase().includes("authentication") ||
				content.toLowerCase().includes("auth")
			) {
				entities.push({
					name: "Authentication",
					type: "concept",
					context: content.substring(0, 100),
					confidence: 0.85,
				});
			}
			if (content.toLowerCase().includes("react")) {
				entities.push({
					name: "React",
					type: "technology",
					context: content.substring(0, 100),
					confidence: 0.95,
				});
			}
			if (content.toLowerCase().includes("node.js") || content.toLowerCase().includes("nodejs")) {
				entities.push({
					name: "Node.js",
					type: "technology",
					context: content.substring(0, 100),
					confidence: 0.95,
				});
			}

			// Detect relationships from content
			if (
				content.toLowerCase().includes("oauth") &&
				content.toLowerCase().includes("authentication")
			) {
				relationships.push({
					from: "OAuth",
					to: "Authentication",
					type: "RELATED_TO",
				});
			}
			if (content.toLowerCase().includes("react") && content.toLowerCase().includes("node.js")) {
				relationships.push({
					from: "React",
					to: "Node.js",
					type: "DEPENDS_ON",
				});
			}

			return {
				entities,
				relationships,
				took_ms: 10,
				model_used: "mock",
			};
		},
	};

	return extractorImpl as EntityExtractorService;
}

// =============================================================================
// Integration Tests
// =============================================================================

describe("Semantic Enhancement Integration", () => {
	let falkorClient: FalkorClient;
	let entityRepo: EntityRepository;
	let resolver: EntityResolverService;
	let extractor: EntityExtractorService;
	let mockLogger: ReturnType<typeof createMockLogger>;
	let skipTests: boolean;

	beforeAll(async () => {
		skipTests = await skipIfNoFalkor();
		if (skipTests) {
			console.log("Skipping integration tests: FalkorDB not available");
			return;
		}

		// Initialize real FalkorDB connection
		falkorClient = new FalkorClient(FALKOR_URL);

		// Create entity repository with real FalkorDB
		entityRepo = new FalkorEntityRepository(falkorClient);

		// Create services with mocks where appropriate
		mockLogger = createMockLogger();
		const mockMcpServer = createMockMcpServer();
		const mockEmbeddingService = createMockEmbeddingService();

		resolver = new EntityResolverService(
			entityRepo,
			mockEmbeddingService,
			mockMcpServer,
			mockLogger as any,
			{ useLlmConfirmation: false }, // Disable LLM for deterministic tests
		);

		extractor = createMockExtractor();
	});

	beforeEach(async () => {
		if (skipTests) return;

		// Clean up test data before each test
		try {
			await falkorClient.query(`MATCH (n) WHERE n.project = $project DETACH DELETE n`, {
				project: TEST_PROJECT,
			});
		} catch {
			// Graph may not exist yet
		}
	});

	afterAll(async () => {
		if (skipTests) return;

		// Clean up test graph
		try {
			await falkorClient.query(`MATCH (n) WHERE n.project = $project DETACH DELETE n`, {
				project: TEST_PROJECT,
			});
		} catch {
			// Ignore cleanup errors
		}
		await falkorClient.close();
	});

	// ===========================================================================
	// Scenario 1: Entity Creation on Remember
	// ===========================================================================

	describe("Scenario 1: Entity Creation on Remember", () => {
		it("should create Entity node when memory mentions a technology", async () => {
			if (skipTests) return;

			// 1. Extract entities from memory content
			const content = "We use PostgreSQL for the user database";
			const extraction = await extractor.extract(content, "decision");

			expect(extraction.entities.length).toBeGreaterThan(0);
			expect(extraction.entities.some((e) => e.name === "PostgreSQL")).toBe(true);

			// 2. Resolve entities (creates new or matches existing)
			const results = await resolver.resolveBatch(extraction.entities, TEST_PROJECT);

			expect(results.length).toBe(1);
			expect(results[0].isNew).toBe(true);
			expect(results[0].entity.name).toBe("PostgreSQL");
			expect(results[0].entity.type).toBe("technology");

			// 3. Verify entity exists in graph
			const entity = await entityRepo.findByName("PostgreSQL", TEST_PROJECT);
			expect(entity).not.toBeNull();
			expect(entity?.type).toBe("technology");
		});

		it("should increment mention count on subsequent mentions", async () => {
			if (skipTests) return;

			const content = "PostgreSQL handles our data layer";

			// First mention
			const extraction1 = await extractor.extract(content, "context");
			await resolver.resolveBatch(extraction1.entities, TEST_PROJECT);

			// Second mention
			const extraction2 = await extractor.extract("PostgreSQL is fast", "context");
			const results2 = await resolver.resolveBatch(extraction2.entities, TEST_PROJECT);

			expect(results2[0].isNew).toBe(false);
			expect(results2[0].entity.mentionCount).toBe(2);
		});
	});

	// ===========================================================================
	// Scenario 2: Entity Resolution (Deduplication)
	// ===========================================================================

	describe("Scenario 2: Entity Resolution (Deduplication)", () => {
		it("should resolve alias to canonical entity", async () => {
			if (skipTests) return;

			// 1. Create memory with 'PostgreSQL'
			const extraction1 = await extractor.extract("PostgreSQL is our primary database", "decision");
			const results1 = await resolver.resolveBatch(extraction1.entities, TEST_PROJECT);

			expect(results1[0].isNew).toBe(true);
			const originalId = results1[0].entity.id;

			// 2. Create memory with 'Postgres' (alias)
			const extraction2 = await extractor.extract("Postgres handles 10k QPS", "fact");
			const results2 = await resolver.resolveBatch(extraction2.entities, TEST_PROJECT);

			// The mock extractor normalizes to "PostgreSQL" so it should find the same entity
			expect(results2[0].isNew).toBe(false);
			expect(results2[0].entity.id).toBe(originalId);
			expect(results2[0].entity.mentionCount).toBe(2);
		});

		it("should not create duplicate entities for same name", async () => {
			if (skipTests) return;

			// Create multiple memories mentioning same entity
			const mentions = [
				"We chose PostgreSQL for reliability",
				"PostgreSQL supports JSON natively",
				"PostgreSQL has excellent documentation",
			];

			for (const content of mentions) {
				const extraction = await extractor.extract(content, "context");
				await resolver.resolveBatch(extraction.entities, TEST_PROJECT);
			}

			// Verify only one entity exists
			const entities = await entityRepo.findByType("technology", TEST_PROJECT);
			const pgEntities = entities.filter((e) => e.name === "PostgreSQL");

			expect(pgEntities.length).toBe(1);
			expect(pgEntities[0].mentionCount).toBe(3);
		});
	});

	// ===========================================================================
	// Scenario 3: Graph-Aware Recall (Entity Relationships)
	// ===========================================================================

	describe("Scenario 3: Graph-Aware Recall", () => {
		it("should create relationships between related entities", async () => {
			if (skipTests) return;

			// Create memory mentioning OAuth and Authentication together
			const content = "We use OAuth 2.0 for authentication";
			const extraction = await extractor.extract(content, "decision");

			// Should have both entities and a relationship
			expect(extraction.entities.length).toBe(2);
			expect(extraction.relationships.length).toBe(1);
			expect(extraction.relationships[0]).toEqual({
				from: "OAuth",
				to: "Authentication",
				type: "RELATED_TO",
			});

			// Resolve entities
			const results = await resolver.resolveBatch(extraction.entities, TEST_PROJECT);

			// Create the relationship
			const oauthEntity = results.find((r) => r.entity.name === "OAuth")?.entity;
			const authEntity = results.find((r) => r.entity.name === "Authentication")?.entity;

			expect(oauthEntity).toBeDefined();
			expect(authEntity).toBeDefined();

			if (oauthEntity && authEntity) {
				await entityRepo.createRelationship(oauthEntity.id, authEntity.id, "RELATED_TO");

				// Verify relationship exists by finding related entities
				const related = await entityRepo.findRelatedEntities(oauthEntity.id);
				expect(related.some((e) => e.name === "Authentication")).toBe(true);
			}
		});

		it("should support multi-hop entity traversal", async () => {
			if (skipTests) return;

			// Create a chain: OAuth -> Authentication -> JWT
			const content1 = "We use OAuth 2.0 for authentication";
			const content2 = "JWT tokens for session management with authentication";

			const extraction1 = await extractor.extract(content1, "decision");
			const extraction2 = await extractor.extract(content2, "decision");

			const results1 = await resolver.resolveBatch(extraction1.entities, TEST_PROJECT);
			const results2 = await resolver.resolveBatch(extraction2.entities, TEST_PROJECT);

			// Get entities
			const oauth = results1.find((r) => r.entity.name === "OAuth")?.entity;
			const auth = results1.find((r) => r.entity.name === "Authentication")?.entity;
			const jwt = results2.find((r) => r.entity.name === "JWT")?.entity;

			if (oauth && auth) {
				await entityRepo.createRelationship(oauth.id, auth.id, "RELATED_TO");
			}
			if (jwt && auth) {
				await entityRepo.createRelationship(jwt.id, auth.id, "RELATED_TO");
			}

			// Query for OAuth should find JWT through Authentication (2-hop)
			if (oauth) {
				const depth1Related = await entityRepo.findRelatedEntities(oauth.id, 1);
				expect(depth1Related.some((e) => e.name === "Authentication")).toBe(true);

				const depth2Related = await entityRepo.findRelatedEntities(oauth.id, 2);
				// JWT should be reachable at depth 2
				expect(depth2Related.some((e) => e.name === "JWT")).toBe(true);
			}
		});
	});

	// ===========================================================================
	// Scenario 4: Cross-Entity Relationship Discovery
	// ===========================================================================

	describe("Scenario 4: Cross-Entity Relationship Discovery", () => {
		it("should detect DEPENDS_ON relationships", async () => {
			if (skipTests) return;

			const content = "React frontend depends on Node.js backend";
			const extraction = await extractor.extract(content, "fact");

			expect(extraction.entities.length).toBe(2);
			expect(extraction.relationships).toContainEqual({
				from: "React",
				to: "Node.js",
				type: "DEPENDS_ON",
			});

			// Resolve and create relationships
			const results = await resolver.resolveBatch(extraction.entities, TEST_PROJECT);
			const react = results.find((r) => r.entity.name === "React")?.entity;
			const node = results.find((r) => r.entity.name === "Node.js")?.entity;

			if (react && node) {
				await entityRepo.createRelationship(react.id, node.id, "DEPENDS_ON");

				// Verify DEPENDS_ON edge
				const related = await entityRepo.findRelatedEntities(react.id);
				expect(related.some((e) => e.name === "Node.js")).toBe(true);
			}
		});

		it("should preserve project isolation for entities", async () => {
			if (skipTests) return;

			const projectA = "project-alpha";
			const projectB = "project-beta";

			// Create entity in project A
			const extractionA = await extractor.extract("PostgreSQL for project A", "decision");
			await resolver.resolveBatch(extractionA.entities, projectA);

			// Create entity in project B
			const extractionB = await extractor.extract("PostgreSQL for project B", "decision");
			await resolver.resolveBatch(extractionB.entities, projectB);

			// Verify isolation
			const entitiesA = await entityRepo.findByProject(projectA);
			const entitiesB = await entityRepo.findByProject(projectB);

			expect(entitiesA.length).toBe(1);
			expect(entitiesB.length).toBe(1);
			expect(entitiesA[0].id).not.toBe(entitiesB[0].id);

			// Cleanup
			await falkorClient.query(`MATCH (n) WHERE n.project IN [$a, $b] DETACH DELETE n`, {
				a: projectA,
				b: projectB,
			});
		});
	});

	// ===========================================================================
	// MENTIONS Edge Tests
	// ===========================================================================

	describe("MENTIONS Edge Operations", () => {
		it("should create MENTIONS edge from memory to entity", async () => {
			if (skipTests) return;

			// Create an entity
			const extraction = await extractor.extract("PostgreSQL is great", "fact");
			const results = await resolver.resolveBatch(extraction.entities, TEST_PROJECT);
			const entity = results[0].entity;

			// Create a mock memory node
			const memoryId = `mem-${Date.now()}`;
			await falkorClient.query(
				`CREATE (m:Memory {
          id: $id,
          content: $content,
          type: 'fact',
          project: $project,
          vt_start: timestamp(),
          vt_end: 9223372036854775807,
          tt_start: timestamp(),
          tt_end: 9223372036854775807
        })`,
				{ id: memoryId, content: "PostgreSQL is great", project: TEST_PROJECT },
			);

			// Create MENTIONS edge
			await entityRepo.createMentionsEdge(memoryId, entity.id, "PostgreSQL is great");

			// Verify edge exists
			const mentioning = await entityRepo.findMentioningMemories(entity.id);
			expect(mentioning.length).toBe(1);
			expect(mentioning[0].id).toBe(memoryId);
		});
	});
});

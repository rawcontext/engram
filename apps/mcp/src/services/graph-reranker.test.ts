import type { Entity, EntityRepository, Memory } from "@engram/graph";
import { createNodeLogger } from "@engram/logger";
import { describe, expect, mock, test } from "bun:test";
import type {
	EntityExtractionResult,
	EntityExtractorService,
	ExtractedEntity,
} from "./entity-extractor";
import { GraphRerankerService } from "./graph-reranker";
import type { RecallResult } from "./interfaces";

// Mock logger (silent for tests)
const logger = createNodeLogger({ service: "test", level: "silent" });

// Mock entity repository
function createMockEntityRepository(options: {
	entities?: Entity[];
	memories?: Memory[];
	relatedEntities?: Entity[];
}): EntityRepository {
	const { entities = [], memories = [], relatedEntities = [] } = options;

	return {
		findById: mock(async (id: string) => entities.find((e) => e.id === id) ?? null),
		findByName: mock(
			async (name: string) =>
				entities.find((e) => e.name.toLowerCase() === name.toLowerCase()) ?? null,
		),
		findByAlias: mock(
			async (alias: string) => entities.find((e) => e.aliases?.includes(alias)) ?? null,
		),
		findByType: mock(async () => []),
		create: mock(async () => entities[0] ?? ({} as Entity)),
		update: mock(async () => entities[0] ?? ({} as Entity)),
		delete: mock(async () => {}),
		incrementMentionCount: mock(async () => {}),
		findByEmbedding: mock(async () => []),
		findSimilarEntities: mock(async () => []),
		createMentionsEdge: mock(async () => {}),
		createRelationship: mock(async () => {}),
		findRelatedEntities: mock(async () => relatedEntities),
		findMentioningMemories: mock(async (entityId: string) => {
			// Return memories that "mention" this entity
			return memories.filter((m) => (m as any).mentionedEntities?.includes(entityId));
		}),
		findByProject: mock(async () => entities),
	};
}

// Mock entity extractor
function createMockEntityExtractor(extractedEntities: ExtractedEntity[]): EntityExtractorService {
	return {
		extract: mock(
			async (): Promise<EntityExtractionResult> => ({
				entities: extractedEntities,
				relationships: [],
				extractionMethod: "sampling",
			}),
		),
		enabled: true,
	} as unknown as EntityExtractorService;
}

// Helper to create test data
function createTestEntity(id: string, name: string, mentionCount = 5): Entity {
	const now = Date.now();
	return {
		id,
		name,
		aliases: [],
		type: "concept",
		mentionCount,
		vtStart: now,
		vtEnd: 253402300799000,
		ttStart: now,
		ttEnd: 253402300799000,
	};
}

function createTestMemory(
	id: string,
	content: string,
	mentionedEntities: string[] = [],
): Memory & { mentionedEntities: string[] } {
	const now = Date.now();
	return {
		id,
		labels: ["Memory"],
		content,
		content_hash: "hash",
		type: "context",
		tags: [],
		source: "user",
		vt_start: now,
		vt_end: 253402300799000,
		tt_start: now,
		tt_end: 253402300799000,
		access_count: 0,
		decay_score: 1.0,
		pinned: false,
		mentionedEntities, // Custom field for testing
	};
}

function createTestRecallResult(id: string, content: string, score: number): RecallResult {
	return {
		id,
		content,
		score,
		type: "context",
		created_at: new Date().toISOString(),
	};
}

describe("GraphRerankerService", () => {
	describe("rerank", () => {
		test("returns vector-only results when no entities extracted", async () => {
			const entityRepo = createMockEntityRepository({});
			const entityExtractor = createMockEntityExtractor([]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			const results: RecallResult[] = [
				createTestRecallResult("mem1", "Content 1", 0.9),
				createTestRecallResult("mem2", "Content 2", 0.8),
			];

			const scored = await reranker.rerank("test query", results);

			expect(scored).toHaveLength(2);
			expect(scored[0].source).toBe("vector");
			expect(scored[1].source).toBe("vector");
			// Scores should be unchanged
			expect(scored[0].score).toBe(0.9);
			expect(scored[1].score).toBe(0.8);
		});

		test("returns vector-only results when no matching entities in graph", async () => {
			const entityRepo = createMockEntityRepository({ entities: [] });
			const entityExtractor = createMockEntityExtractor([
				{ name: "TypeScript", type: "technology", confidence: 0.9, context: "" },
			]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			const results: RecallResult[] = [createTestRecallResult("mem1", "Content 1", 0.9)];

			const scored = await reranker.rerank("TypeScript query", results);

			expect(scored).toHaveLength(1);
			expect(scored[0].source).toBe("vector");
		});

		test("applies graph scoring when entities are connected", async () => {
			const entity = createTestEntity("entity1", "TypeScript", 10);
			const memory = createTestMemory("mem1", "TypeScript content", ["entity1"]);

			const entityRepo = createMockEntityRepository({
				entities: [entity],
				memories: [memory],
			});
			const entityExtractor = createMockEntityExtractor([
				{ name: "TypeScript", type: "technology", confidence: 0.9, context: "" },
			]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			const results: RecallResult[] = [
				createTestRecallResult("mem1", "TypeScript content", 0.8),
				createTestRecallResult("mem2", "Unrelated content", 0.9),
			];

			const scored = await reranker.rerank("TypeScript query", results);

			// Memory connected to entity should have graph metadata
			const graphResult = scored.find((r) => r.id === "mem1");
			expect(graphResult?.source).toBe("graph");
			expect(graphResult?.graphDistance).toBe(1);
			expect(graphResult?.graphScore).toBeDefined();

			// Unconnected memory should remain vector
			const vectorResult = scored.find((r) => r.id === "mem2");
			expect(vectorResult?.source).toBe("vector");
		});

		test("reorders results based on graph scores", async () => {
			const entity = createTestEntity("entity1", "TypeScript", 100);
			const memory = createTestMemory("mem2", "TypeScript content", ["entity1"]);

			const entityRepo = createMockEntityRepository({
				entities: [entity],
				memories: [memory],
			});
			const entityExtractor = createMockEntityExtractor([
				{ name: "TypeScript", type: "technology", confidence: 0.9, context: "" },
			]);
			// Use very high graph weight and low vector scores to ensure reordering
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger, {
				graphWeight: 0.9,
			});

			const results: RecallResult[] = [
				createTestRecallResult("mem1", "Higher score but no graph connection", 0.6),
				createTestRecallResult("mem2", "Lower score but graph connected", 0.3),
			];

			const scored = await reranker.rerank("TypeScript query", results);

			// With very high graph weight (0.9) and a perfect graph score (~1.0 for direct mention),
			// mem2 should rank higher: 0.3 * 0.1 + graphScore * 0.9 > 0.6 * 0.1 + 0 * 0.9
			// mem2: 0.03 + ~0.65 * 0.9 = 0.03 + 0.585 = 0.615
			// mem1: 0.06 + 0 = 0.06
			expect(scored[0].id).toBe("mem2");
		});

		test("handles empty results", async () => {
			const entityRepo = createMockEntityRepository({});
			const entityExtractor = createMockEntityExtractor([]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			const scored = await reranker.rerank("test query", []);

			expect(scored).toHaveLength(0);
		});

		test("gracefully handles extraction errors", async () => {
			const entityRepo = createMockEntityRepository({});
			const entityExtractor = {
				extract: mock(async () => {
					throw new Error("Extraction failed");
				}),
				enabled: true,
			} as unknown as EntityExtractorService;
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			const results: RecallResult[] = [createTestRecallResult("mem1", "Content", 0.9)];

			// Should not throw, should return vector results
			const scored = await reranker.rerank("test query", results);

			expect(scored).toHaveLength(1);
			expect(scored[0].source).toBe("vector");
		});
	});

	describe("configuration", () => {
		test("uses default configuration", () => {
			const entityRepo = createMockEntityRepository({});
			const entityExtractor = createMockEntityExtractor([]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			const config = reranker.getConfig();

			expect(config.graphWeight).toBe(0.3);
			expect(config.maxDepth).toBe(2);
			expect(config.entitySimilarityThreshold).toBe(0.8);
		});

		test("accepts custom configuration", () => {
			const entityRepo = createMockEntityRepository({});
			const entityExtractor = createMockEntityExtractor([]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger, {
				graphWeight: 0.5,
				maxDepth: 3,
			});

			const config = reranker.getConfig();

			expect(config.graphWeight).toBe(0.5);
			expect(config.maxDepth).toBe(3);
		});

		test("allows runtime configuration updates", () => {
			const entityRepo = createMockEntityRepository({});
			const entityExtractor = createMockEntityExtractor([]);
			const reranker = new GraphRerankerService(entityRepo, entityExtractor, logger);

			reranker.updateConfig({ graphWeight: 0.8 });

			const config = reranker.getConfig();
			expect(config.graphWeight).toBe(0.8);
		});
	});

	describe("scoring formula", () => {
		test("applies correct weight formula", async () => {
			const entity = createTestEntity("entity1", "TypeScript", 10);
			const memory = createTestMemory("mem1", "TypeScript content", ["entity1"]);

			const entityRepo = createMockEntityRepository({
				entities: [entity],
				memories: [memory],
			});
			const entityExtractor = createMockEntityExtractor([
				{ name: "TypeScript", type: "technology", confidence: 0.9, context: "" },
			]);

			// Test with 0 graph weight - should keep original score
			const rerankerZero = new GraphRerankerService(entityRepo, entityExtractor, logger, {
				graphWeight: 0,
			});

			const results: RecallResult[] = [createTestRecallResult("mem1", "TypeScript content", 0.8)];

			const scoredZero = await rerankerZero.rerank("TypeScript query", results);
			expect(scoredZero[0].score).toBeCloseTo(0.8, 2);

			// Test with 1.0 graph weight - should use only graph score
			const rerankerFull = new GraphRerankerService(entityRepo, entityExtractor, logger, {
				graphWeight: 1.0,
			});

			const scoredFull = await rerankerFull.rerank("TypeScript query", results);
			// Score should be the pure graph score (not the original vector score)
			expect(scoredFull[0].score).not.toBeCloseTo(0.8, 2);
		});
	});
});

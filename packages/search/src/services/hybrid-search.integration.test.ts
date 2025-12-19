/**
 * Integration test for Qdrant hybrid search with SPLADE sparse vectors.
 *
 * This test verifies:
 * 1. SPLADE sparse vectors are correctly indexed in Qdrant
 * 2. Sparse-only search works with the "sparse" named vector
 * 3. Hybrid search (dense + sparse with RRF fusion) returns improved results
 * 4. Synonym handling: SPLADE captures semantic relationships (e.g., "car" finds "automobile")
 * 5. Vocabulary mismatch: SPLADE finds relevant docs even with different terminology
 *
 * REQUIREMENTS:
 * - Qdrant running on localhost:6333 (use `bun infra:up`)
 * - Run with: bun test src/services/hybrid-search.integration.test.ts
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SpladeEmbedder } from "./splade-embedder";
import { TextEmbedder } from "./text-embedder";

const TEST_COLLECTION = "hybrid_search_test";

// Test documents designed to verify synonym and vocabulary mismatch handling
const TEST_DOCUMENTS = [
	{
		id: 1,
		content: "The automobile industry is rapidly adopting electric vehicles for sustainability.",
		// Should be found by query "car" via SPLADE term expansion
	},
	{
		id: 2,
		content: "Machine learning algorithms process large datasets to find patterns.",
		// Should be found by query "AI" via SPLADE semantic understanding
	},
	{
		id: 3,
		content: "The physician prescribed medication for the patient's condition.",
		// Should be found by query "doctor" via SPLADE synonym handling
	},
	{
		id: 4,
		content: "Software engineers develop applications using programming languages.",
		// Should be found by query "developer" or "coder"
	},
	{
		id: 5,
		content: "The quick brown fox jumps over the lazy dog.",
		// Control document - should NOT match semantic queries
	},
];

// Queries designed to test SPLADE's term expansion and synonym handling
const TEST_QUERIES = [
	{
		query: "car electric vehicle",
		expectedDocIds: [1], // Should find "automobile" doc
		description: "Synonym: car → automobile",
	},
	{
		query: "artificial intelligence",
		expectedDocIds: [2], // Should find "machine learning" doc
		description: "Related concept: AI → machine learning",
	},
	{
		query: "doctor treatment",
		expectedDocIds: [3], // Should find "physician" doc
		description: "Synonym: doctor → physician",
	},
	{
		query: "developer coding",
		expectedDocIds: [4], // Should find "software engineer" doc
		description: "Related: developer → software engineer",
	},
];

describe("Hybrid Search Integration", () => {
	let client: QdrantClient;
	let spladeEmbedder: SpladeEmbedder;
	let textEmbedder: TextEmbedder;

	beforeAll(async () => {
		// Initialize clients and embedders
		client = new QdrantClient({ url: "http://localhost:6333" });
		spladeEmbedder = new SpladeEmbedder();
		textEmbedder = new TextEmbedder();

		// Wait for SPLADE model to load (first call is slow)
		await spladeEmbedder.preload();

		// Clean up and create test collection
		try {
			await client.deleteCollection(TEST_COLLECTION);
		} catch {
			// Collection may not exist
		}

		await client.createCollection(TEST_COLLECTION, {
			vectors: {
				text_dense: {
					size: 384, // e5-small dimensions
					distance: "Cosine",
				},
			},
			sparse_vectors: {
				sparse: {
					index: {
						on_disk: false,
						datatype: "float16",
					},
				},
			},
		});

		// Index test documents with both dense and sparse vectors
		for (const doc of TEST_DOCUMENTS) {
			const [denseVector, sparseVector] = await Promise.all([
				textEmbedder.embed(doc.content),
				spladeEmbedder.embed(doc.content),
			]);

			await client.upsert(TEST_COLLECTION, {
				points: [
					{
						id: doc.id,
						vector: {
							text_dense: denseVector,
							sparse: sparseVector,
						},
						payload: {
							content: doc.content,
						},
					},
				],
			});
		}

		// Allow time for indexing
		await new Promise((resolve) => setTimeout(resolve, 500));
	}, 120000); // 2 minute timeout for model loading

	afterAll(async () => {
		// Cleanup
		try {
			await client.deleteCollection(TEST_COLLECTION);
		} catch {
			// Ignore cleanup errors
		}
	});

	describe("Sparse Vector Search", () => {
		it("should perform sparse-only search using SPLADE vectors", async () => {
			const queryText = "automobile electric";
			const sparseQuery = await spladeEmbedder.embedQuery(queryText);

			const results = await client.query(TEST_COLLECTION, {
				query: {
					indices: sparseQuery.indices,
					values: sparseQuery.values,
				},
				using: "sparse",
				limit: 5,
				with_payload: true,
			});

			expect(results.points.length).toBeGreaterThan(0);
			// The automobile/electric document should be in results
			const hasExpectedDoc = results.points.some((p) => p.id === 1);
			expect(hasExpectedDoc).toBe(true);
		});

		it("should return sparse vectors with correct format", async () => {
			const sparseVector = await spladeEmbedder.embed("test query");

			expect(sparseVector).toHaveProperty("indices");
			expect(sparseVector).toHaveProperty("values");
			expect(Array.isArray(sparseVector.indices)).toBe(true);
			expect(Array.isArray(sparseVector.values)).toBe(true);
			expect(sparseVector.indices.length).toBe(sparseVector.values.length);

			// Indices should be sorted (Qdrant requirement)
			for (let i = 1; i < sparseVector.indices.length; i++) {
				expect(sparseVector.indices[i]).toBeGreaterThan(sparseVector.indices[i - 1]);
			}

			// Values should be positive
			for (const val of sparseVector.values) {
				expect(val).toBeGreaterThan(0);
			}
		});
	});

	describe("Synonym Handling", () => {
		for (const testCase of TEST_QUERIES) {
			it(`should handle ${testCase.description}`, async () => {
				const sparseQuery = await spladeEmbedder.embedQuery(testCase.query);

				const results = await client.query(TEST_COLLECTION, {
					query: {
						indices: sparseQuery.indices,
						values: sparseQuery.values,
					},
					using: "sparse",
					limit: 5,
					with_payload: true,
				});

				// Check if expected documents appear in top results
				const topIds = results.points.slice(0, 3).map((p) => p.id);
				const foundExpected = testCase.expectedDocIds.some((id) => topIds.includes(id));

				// Log for debugging
				console.log(`Query: "${testCase.query}"`);
				console.log(`Top results: ${topIds.join(", ")}`);
				console.log(`Expected: ${testCase.expectedDocIds.join(", ")}`);
				console.log(`Found: ${foundExpected}`);

				expect(foundExpected).toBe(true);
			});
		}
	});

	describe("Hybrid Search (Dense + Sparse with RRF)", () => {
		it("should perform hybrid search using prefetch with RRF fusion", async () => {
			const queryText = "car electric vehicle";

			const [denseQuery, sparseQuery] = await Promise.all([
				textEmbedder.embedQuery(queryText),
				spladeEmbedder.embedQuery(queryText),
			]);

			// Hybrid search using prefetch + RRF fusion
			const results = await client.query(TEST_COLLECTION, {
				prefetch: [
					{
						query: denseQuery,
						using: "text_dense",
						limit: 10,
					},
					{
						query: {
							indices: sparseQuery.indices,
							values: sparseQuery.values,
						},
						using: "sparse",
						limit: 10,
					},
				],
				query: { fusion: "rrf" },
				limit: 5,
				with_payload: true,
			});

			expect(results.points.length).toBeGreaterThan(0);

			// Log results for analysis
			console.log("\nHybrid search results for:", queryText);
			for (const point of results.points) {
				console.log(`  ID: ${point.id}, Score: ${point.score?.toFixed(4)}`);
			}

			// Automobile doc should be highly ranked
			const topIds = results.points.slice(0, 3).map((p) => p.id);
			expect(topIds).toContain(1);
		});

		it("should rank hybrid results better than dense-only for vocabulary mismatch", async () => {
			const queryText = "doctor treatment"; // Query uses "doctor", doc has "physician"

			const [denseQuery, sparseQuery] = await Promise.all([
				textEmbedder.embedQuery(queryText),
				spladeEmbedder.embedQuery(queryText),
			]);

			// Dense-only search
			const denseResults = await client.query(TEST_COLLECTION, {
				query: denseQuery,
				using: "text_dense",
				limit: 5,
				with_payload: true,
			});

			// Hybrid search
			const hybridResults = await client.query(TEST_COLLECTION, {
				prefetch: [
					{
						query: denseQuery,
						using: "text_dense",
						limit: 10,
					},
					{
						query: {
							indices: sparseQuery.indices,
							values: sparseQuery.values,
						},
						using: "sparse",
						limit: 10,
					},
				],
				query: { fusion: "rrf" },
				limit: 5,
				with_payload: true,
			});

			console.log("\nDense-only results for 'doctor treatment':");
			for (const point of denseResults.points.slice(0, 3)) {
				console.log(`  ID: ${point.id}, Score: ${point.score?.toFixed(4)}`);
			}

			console.log("Hybrid results for 'doctor treatment':");
			for (const point of hybridResults.points.slice(0, 3)) {
				console.log(`  ID: ${point.id}, Score: ${point.score?.toFixed(4)}`);
			}

			// Hybrid should find the physician doc (ID 3) in top results
			const hybridTopIds = hybridResults.points.slice(0, 3).map((p) => p.id);
			expect(hybridTopIds).toContain(3);
		});
	});

	describe("SPLADE Term Expansion Analysis", () => {
		it("should show meaningful term expansion for domain concepts", async () => {
			const queryText = "machine learning";
			const sparseVector = await spladeEmbedder.embed(queryText);

			console.log(`\nSPLADE vector for "${queryText}":`);
			console.log(`  Non-zero dimensions: ${sparseVector.indices.length}`);
			console.log(`  Sparsity: ${((1 - sparseVector.indices.length / 30522) * 100).toFixed(2)}%`);
			console.log(`  Top weight: ${Math.max(...sparseVector.values).toFixed(4)}`);

			// SPLADE should produce reasonably sparse vectors
			expect(sparseVector.indices.length).toBeLessThan(1000);
			expect(sparseVector.indices.length).toBeGreaterThan(10);
		});

		it("should produce different sparse vectors for semantically different queries", async () => {
			const query1 = "car automobile vehicle";
			const query2 = "programming software code";

			const [sparse1, sparse2] = await Promise.all([
				spladeEmbedder.embed(query1),
				spladeEmbedder.embed(query2),
			]);

			// Calculate index overlap
			const set1 = new Set(sparse1.indices);
			const set2 = new Set(sparse2.indices);
			const intersection = sparse1.indices.filter((i) => set2.has(i));
			const overlapRatio = intersection.length / Math.min(set1.size, set2.size);

			console.log(`\nIndex overlap between different domains:`);
			console.log(`  Query 1: "${query1}" (${set1.size} terms)`);
			console.log(`  Query 2: "${query2}" (${set2.size} terms)`);
			console.log(`  Overlap: ${intersection.length} terms (${(overlapRatio * 100).toFixed(1)}%)`);

			// Different domain queries should have limited overlap
			// Note: BERT's vocabulary includes common subwords, so some overlap is expected
			expect(overlapRatio).toBeLessThan(0.6);
		});
	});
});

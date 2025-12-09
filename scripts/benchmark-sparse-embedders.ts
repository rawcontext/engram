/**
 * Benchmark: SPLADE vs BM25Sparse
 *
 * Compares latency, sparsity, and output characteristics between
 * SPLADE (learned sparse) and BM25Sparse (traditional) embedders.
 */

import { TextEmbedder } from "../packages/search-core/src/services/text-embedder";

// Test documents - mix of technical and general content
const testDocuments = [
	"Machine learning is a subset of artificial intelligence that enables systems to learn from data",
	"TypeScript is a typed superset of JavaScript that compiles to plain JavaScript",
	"The quick brown fox jumps over the lazy dog",
	"Vector databases like Qdrant enable semantic search using embeddings",
	"Hybrid search combines dense and sparse vectors for better retrieval",
	"GraphQL provides a more efficient alternative to REST APIs",
	"Docker containers package applications with their dependencies",
	"Kubernetes orchestrates containerized applications at scale",
	"Neural networks consist of layers of interconnected nodes",
	"Natural language processing enables computers to understand human language",
];

// Test queries
const testQueries = [
	"What is machine learning?",
	"TypeScript vs JavaScript",
	"semantic search",
	"container orchestration",
	"NLP applications",
];

interface BenchmarkResult {
	embedder: string;
	avgLatencyMs: number;
	minLatencyMs: number;
	maxLatencyMs: number;
	avgNonZeroDims: number;
	avgSparsity: number;
	totalDims: number;
}

async function benchmarkEmbedder(
	embedder: TextEmbedder,
	name: string,
	texts: string[],
	warmupRuns = 2,
): Promise<BenchmarkResult> {
	const vocabSize = 30522; // BERT vocabulary size
	const latencies: number[] = [];
	const nonZeroCounts: number[] = [];

	// Warmup runs
	console.log(`  Warming up ${name}...`);
	for (let i = 0; i < warmupRuns; i++) {
		await embedder.embedSparse(texts[0]);
	}

	// Benchmark runs
	console.log(`  Running benchmark for ${name}...`);
	for (const text of texts) {
		const start = performance.now();
		const sparse = await embedder.embedSparse(text);
		const elapsed = performance.now() - start;

		latencies.push(elapsed);
		nonZeroCounts.push(sparse.indices.length);
	}

	const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
	const avgNonZero = nonZeroCounts.reduce((a, b) => a + b, 0) / nonZeroCounts.length;

	return {
		embedder: name,
		avgLatencyMs: Math.round(avgLatency * 100) / 100,
		minLatencyMs: Math.round(Math.min(...latencies) * 100) / 100,
		maxLatencyMs: Math.round(Math.max(...latencies) * 100) / 100,
		avgNonZeroDims: Math.round(avgNonZero),
		avgSparsity: Math.round((1 - avgNonZero / vocabSize) * 10000) / 100,
		totalDims: vocabSize,
	};
}

async function analyzeOverlap(
	spladeEmbedder: TextEmbedder,
	bm25Embedder: TextEmbedder,
	texts: string[],
): Promise<void> {
	console.log("\n📊 Index Overlap Analysis");
	console.log("=".repeat(50));

	for (const text of texts.slice(0, 3)) {
		const splade = await spladeEmbedder.embedSparse(text);
		const bm25 = await bm25Embedder.embedSparse(text);

		const spladeSet = new Set(splade.indices);
		const bm25Set = new Set(bm25.indices);

		let overlap = 0;
		for (const idx of spladeSet) {
			if (bm25Set.has(idx)) overlap++;
		}

		const jaccardSimilarity =
			overlap / (spladeSet.size + bm25Set.size - overlap);

		console.log(`\nText: "${text.substring(0, 50)}..."`);
		console.log(`  SPLADE indices: ${spladeSet.size}`);
		console.log(`  BM25 indices: ${bm25Set.size}`);
		console.log(`  Overlap: ${overlap}`);
		console.log(`  Jaccard similarity: ${(jaccardSimilarity * 100).toFixed(1)}%`);
	}
}

async function analyzeQueryDocSimilarity(
	embedder: TextEmbedder,
	name: string,
	query: string,
	docs: string[],
): Promise<void> {
	const queryVec = await embedder.embedSparseQuery(query);
	const queryIndices = new Set(queryVec.indices);
	const queryWeights = new Map(queryVec.indices.map((idx, i) => [idx, queryVec.values[i]]));

	console.log(`\n${name} - Query: "${query}"`);

	const scores: Array<{ doc: string; score: number }> = [];

	for (const doc of docs) {
		const docVec = await embedder.embedSparse(doc);
		// Dot product between sparse vectors
		let score = 0;
		for (let i = 0; i < docVec.indices.length; i++) {
			const idx = docVec.indices[i];
			if (queryIndices.has(idx)) {
				score += docVec.values[i] * (queryWeights.get(idx) || 0);
			}
		}
		scores.push({ doc: doc.substring(0, 40), score });
	}

	scores.sort((a, b) => b.score - a.score);
	console.log("  Top 3 matches:");
	for (const { doc, score } of scores.slice(0, 3)) {
		console.log(`    ${score.toFixed(3)} - "${doc}..."`);
	}
}

async function main() {
	console.log("🔬 SPLADE vs BM25Sparse Benchmark\n");
	console.log("=".repeat(50));

	// Create embedders
	const spladeEmbedder = new TextEmbedder("splade");
	const bm25Embedder = new TextEmbedder("bm25");

	// Preload SPLADE model
	console.log("\n⏳ Loading SPLADE model...");
	const loadStart = performance.now();
	await spladeEmbedder.preloadSparse();
	console.log(`   Model loaded in ${((performance.now() - loadStart) / 1000).toFixed(2)}s`);

	// Run benchmarks
	console.log("\n📈 Latency & Sparsity Benchmarks");
	console.log("=".repeat(50));

	const spladeResult = await benchmarkEmbedder(spladeEmbedder, "SPLADE", testDocuments);
	const bm25Result = await benchmarkEmbedder(bm25Embedder, "BM25", testDocuments);

	// Print results table
	console.log("\n┌─────────────────────────────────────────────────────────────┐");
	console.log("│                    Benchmark Results                        │");
	console.log("├──────────┬────────────┬────────────┬────────────┬───────────┤");
	console.log("│ Embedder │ Avg (ms)   │ Min (ms)   │ Max (ms)   │ Non-zero  │");
	console.log("├──────────┼────────────┼────────────┼────────────┼───────────┤");

	for (const r of [spladeResult, bm25Result]) {
		console.log(
			`│ ${r.embedder.padEnd(8)} │ ${r.avgLatencyMs.toString().padStart(10)} │ ${r.minLatencyMs.toString().padStart(10)} │ ${r.maxLatencyMs.toString().padStart(10)} │ ${r.avgNonZeroDims.toString().padStart(9)} │`,
		);
	}

	console.log("└──────────┴────────────┴────────────┴────────────┴───────────┘");

	console.log("\n┌─────────────────────────────────────────┐");
	console.log("│           Sparsity Summary              │");
	console.log("├──────────┬──────────────┬───────────────┤");
	console.log("│ Embedder │ Sparsity (%) │ Vocab Size    │");
	console.log("├──────────┼──────────────┼───────────────┤");

	for (const r of [spladeResult, bm25Result]) {
		console.log(
			`│ ${r.embedder.padEnd(8)} │ ${r.avgSparsity.toString().padStart(12)} │ ${r.totalDims.toString().padStart(13)} │`,
		);
	}

	console.log("└──────────┴──────────────┴───────────────┘");

	// Analyze overlap between embedders
	await analyzeOverlap(spladeEmbedder, bm25Embedder, testDocuments);

	// Analyze retrieval quality
	console.log("\n🎯 Retrieval Quality (Sparse Dot Product)");
	console.log("=".repeat(50));

	for (const query of testQueries.slice(0, 2)) {
		await analyzeQueryDocSimilarity(spladeEmbedder, "SPLADE", query, testDocuments);
		await analyzeQueryDocSimilarity(bm25Embedder, "BM25", query, testDocuments);
	}

	// Summary
	console.log("\n📋 Summary");
	console.log("=".repeat(50));
	console.log(`SPLADE is ${(bm25Result.avgLatencyMs / spladeResult.avgLatencyMs).toFixed(1)}x ${spladeResult.avgLatencyMs < bm25Result.avgLatencyMs ? "faster" : "slower"} than BM25`);
	console.log(`SPLADE produces ${spladeResult.avgNonZeroDims} non-zero dims vs BM25's ${bm25Result.avgNonZeroDims}`);
	console.log(`SPLADE sparsity: ${spladeResult.avgSparsity}% vs BM25: ${bm25Result.avgSparsity}%`);
}

main().catch(console.error);

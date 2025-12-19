#!/usr/bin/env bun

/**
 * Quality evaluation script for reranker.
 *
 * This script computes standard information retrieval metrics:
 * - NDCG@k (Normalized Discounted Cumulative Gain)
 * - MRR (Mean Reciprocal Rank)
 *
 * Usage:
 *   bun run packages/search-core/scripts/evaluate-reranker.ts
 *
 * The script uses test queries with known relevance judgments to evaluate
 * the reranker's quality. It compares results with and without reranking.
 */

import type { RerankerTier } from "../src/models/schema";
import { BatchedReranker, type DocumentCandidate } from "../src/services/batched-reranker";

// =============================================================================
// Test Data
// =============================================================================

interface RelevanceJudgment {
	query: string;
	/** Document IDs ordered by relevance (most relevant first) */
	relevant_docs: string[];
	/** Document content */
	documents: Record<string, string>;
}

/**
 * Test dataset with known relevance judgments.
 * Each query has a list of relevant documents in order of relevance.
 */
const TEST_QUERIES: RelevanceJudgment[] = [
	{
		query: "What is machine learning?",
		relevant_docs: ["ml1", "ml2", "ml3", "ai1"],
		documents: {
			ml1: "Machine learning is a subset of artificial intelligence that enables systems to learn from data without being explicitly programmed.",
			ml2: "Machine learning algorithms use statistical techniques to give computers the ability to learn and improve from experience.",
			ml3: "Machine learning models are trained on data to make predictions or decisions without being explicitly programmed for the task.",
			ai1: "Artificial intelligence is a broad field that encompasses machine learning, natural language processing, and computer vision.",
			weather1: "The weather today is sunny with a high of 75 degrees.",
			food1: "Pizza is a popular Italian dish made with dough, sauce, and cheese.",
			sports1: "Basketball is a team sport played on a court with a hoop at each end.",
		},
	},
	{
		query: "neural networks deep learning",
		relevant_docs: ["nn1", "nn2", "dl1", "ml1"],
		documents: {
			nn1: "Neural networks are computational models inspired by biological neural systems, consisting of interconnected nodes that process information.",
			nn2: "Artificial neural networks use layers of neurons to learn patterns in data through backpropagation and gradient descent.",
			dl1: "Deep learning uses neural networks with multiple hidden layers to learn hierarchical representations of data.",
			ml1: "Machine learning is the foundation for deep learning and neural network architectures.",
			stats1:
				"Statistical analysis involves collecting, organizing, and interpreting data to find patterns.",
			bio1: "The human brain contains billions of neurons connected by synapses.",
			history1: "World War II was a global conflict that lasted from 1939 to 1945.",
		},
	},
	{
		query: "How do transformers work in NLP?",
		relevant_docs: ["trans1", "trans2", "attn1", "nlp1"],
		documents: {
			trans1:
				"Transformers are neural network architectures that use self-attention mechanisms to process sequential data in parallel.",
			trans2:
				"The Transformer architecture revolutionized NLP by replacing recurrent layers with multi-head attention.",
			attn1:
				"Self-attention allows the model to weigh the importance of different words in a sequence when processing each word.",
			nlp1: "Natural language processing uses machine learning to understand and generate human language.",
			rnn1: "Recurrent neural networks process sequences one element at a time, maintaining hidden state.",
			cv1: "Computer vision uses neural networks to analyze and understand images.",
			music1: "Music theory encompasses the study of harmony, melody, and rhythm.",
		},
	},
	{
		query: "function to sort array in Python",
		relevant_docs: ["py1", "py2", "algo1"],
		documents: {
			py1: "In Python, you can sort a list using the sorted() function or the list.sort() method.",
			py2: "my_list.sort() sorts the list in-place, while sorted(my_list) returns a new sorted list.",
			algo1:
				"Common sorting algorithms include quicksort, mergesort, and heapsort with different time complexities.",
			js1: "In JavaScript, use array.sort() to sort an array in place.",
			java1: "Java provides Arrays.sort() and Collections.sort() for sorting arrays and lists.",
			ml1: "Machine learning models can be trained to predict sorted orders from data.",
			book1: "The Lord of the Rings is a fantasy novel by J.R.R. Tolkien.",
		},
	},
];

// =============================================================================
// Metrics
// =============================================================================

/**
 * Compute Discounted Cumulative Gain at k.
 *
 * DCG@k = sum_{i=1}^{k} (rel_i / log2(i + 1))
 *
 * where rel_i is the relevance of the document at position i.
 * For binary relevance: rel_i = 1 if relevant, 0 otherwise.
 * For graded relevance: rel_i = position in relevant_docs (inverted).
 */
function computeDCG(ranked: string[], relevant: string[], k: number): number {
	let dcg = 0;

	for (let i = 0; i < Math.min(k, ranked.length); i++) {
		const docId = ranked[i];
		const relevanceIdx = relevant.indexOf(docId);

		// Graded relevance: most relevant doc gets highest score
		const relevance = relevanceIdx === -1 ? 0 : relevant.length - relevanceIdx;

		// Logarithmic discount (i+2 because i is 0-indexed and we use log2(i+1))
		dcg += relevance / Math.log2(i + 2);
	}

	return dcg;
}

/**
 * Compute Normalized Discounted Cumulative Gain at k.
 *
 * NDCG@k = DCG@k / IDCG@k
 *
 * where IDCG@k is the ideal DCG (DCG of the perfect ranking).
 */
function computeNDCG(ranked: string[], relevant: string[], k: number): number {
	const dcg = computeDCG(ranked, relevant, k);
	const idcg = computeDCG(relevant, relevant, k); // Perfect ranking

	if (idcg === 0) {
		return 0; // No relevant documents
	}

	return dcg / idcg;
}

/**
 * Compute Mean Reciprocal Rank.
 *
 * MRR = 1 / rank_of_first_relevant_doc
 *
 * Returns 0 if no relevant document is found.
 */
function computeMRR(ranked: string[], relevant: string[]): number {
	for (let i = 0; i < ranked.length; i++) {
		if (relevant.includes(ranked[i])) {
			return 1 / (i + 1); // i+1 because ranks start at 1
		}
	}
	return 0; // No relevant document found
}

/**
 * Compute Precision at k.
 *
 * P@k = (number of relevant docs in top k) / k
 */
function computePrecisionAtK(ranked: string[], relevant: string[], k: number): number {
	const topK = ranked.slice(0, k);
	const relevantInTopK = topK.filter((id) => relevant.includes(id)).length;
	return relevantInTopK / k;
}

/**
 * Compute Recall at k.
 *
 * R@k = (number of relevant docs in top k) / (total relevant docs)
 */
function computeRecallAtK(ranked: string[], relevant: string[], k: number): number {
	if (relevant.length === 0) {
		return 0;
	}

	const topK = ranked.slice(0, k);
	const relevantInTopK = topK.filter((id) => relevant.includes(id)).length;
	return relevantInTopK / relevant.length;
}

// =============================================================================
// Evaluation
// =============================================================================

interface EvaluationResult {
	tier: RerankerTier;
	ndcg_at_3: number;
	ndcg_at_5: number;
	ndcg_at_10: number;
	mrr: number;
	precision_at_3: number;
	recall_at_3: number;
	precision_at_5: number;
	recall_at_5: number;
}

/**
 * Evaluate a reranker tier on the test queries.
 */
async function evaluateTier(tier: RerankerTier): Promise<EvaluationResult> {
	const reranker = BatchedReranker.forTier(tier);

	// Warm up the model
	console.log(`[${tier}] Loading model...`);
	await reranker.warmup();
	console.log(`[${tier}] Model loaded.`);

	const metrics = {
		ndcg_at_3: [] as number[],
		ndcg_at_5: [] as number[],
		ndcg_at_10: [] as number[],
		mrr: [] as number[],
		precision_at_3: [] as number[],
		recall_at_3: [] as number[],
		precision_at_5: [] as number[],
		recall_at_5: [] as number[],
	};

	for (const testCase of TEST_QUERIES) {
		const { query, relevant_docs, documents } = testCase;

		// Create candidates from all documents
		const candidates: DocumentCandidate[] = Object.entries(documents).map(([id, content]) => ({
			id,
			content,
			score: Math.random(), // Random initial scores
		}));

		// Shuffle to avoid positional bias
		candidates.sort(() => Math.random() - 0.5);

		// Rerank
		const results = await reranker.rerank(query, candidates, 10);

		// Extract ranked doc IDs
		const rankedIds = results.map((r) => String(r.id));

		// Compute metrics
		metrics.ndcg_at_3.push(computeNDCG(rankedIds, relevant_docs, 3));
		metrics.ndcg_at_5.push(computeNDCG(rankedIds, relevant_docs, 5));
		metrics.ndcg_at_10.push(computeNDCG(rankedIds, relevant_docs, 10));
		metrics.mrr.push(computeMRR(rankedIds, relevant_docs));
		metrics.precision_at_3.push(computePrecisionAtK(rankedIds, relevant_docs, 3));
		metrics.recall_at_3.push(computeRecallAtK(rankedIds, relevant_docs, 3));
		metrics.precision_at_5.push(computePrecisionAtK(rankedIds, relevant_docs, 5));
		metrics.recall_at_5.push(computeRecallAtK(rankedIds, relevant_docs, 5));

		console.log(
			`[${tier}] Query: "${query.slice(0, 40)}..." | NDCG@5: ${metrics.ndcg_at_5[metrics.ndcg_at_5.length - 1].toFixed(3)} | MRR: ${metrics.mrr[metrics.mrr.length - 1].toFixed(3)}`,
		);
	}

	// Average metrics
	const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

	return {
		tier,
		ndcg_at_3: avg(metrics.ndcg_at_3),
		ndcg_at_5: avg(metrics.ndcg_at_5),
		ndcg_at_10: avg(metrics.ndcg_at_10),
		mrr: avg(metrics.mrr),
		precision_at_3: avg(metrics.precision_at_3),
		recall_at_3: avg(metrics.recall_at_3),
		precision_at_5: avg(metrics.precision_at_5),
		recall_at_5: avg(metrics.recall_at_5),
	};
}

/**
 * Print evaluation results in a formatted table.
 */
function printResults(results: EvaluationResult[]): void {
	console.log(`\n${"=".repeat(80)}`);
	console.log("RERANKER QUALITY EVALUATION RESULTS");
	console.log("=".repeat(80));
	console.log();

	// Header
	console.log(
		`${"Tier".padEnd(12)} | ${"NDCG@3".padEnd(8)} | ${"NDCG@5".padEnd(8)} | ${"NDCG@10".padEnd(8)} | ${"MRR".padEnd(8)} | ${"P@3".padEnd(8)} | ${"R@3".padEnd(8)} | ${"P@5".padEnd(8)} | ${"R@5".padEnd(8)}`,
	);
	console.log("-".repeat(120));

	// Results
	for (const result of results) {
		console.log(
			`${result.tier.padEnd(12)} | ${result.ndcg_at_3.toFixed(4).padEnd(8)} | ${result.ndcg_at_5.toFixed(4).padEnd(8)} | ${result.ndcg_at_10.toFixed(4).padEnd(8)} | ${result.mrr.toFixed(4).padEnd(8)} | ${result.precision_at_3.toFixed(4).padEnd(8)} | ${result.recall_at_3.toFixed(4).padEnd(8)} | ${result.precision_at_5.toFixed(4).padEnd(8)} | ${result.recall_at_5.toFixed(4).padEnd(8)}`,
		);
	}

	console.log();
	console.log("=".repeat(80));
	console.log("Legend:");
	console.log("  NDCG@k: Normalized Discounted Cumulative Gain at k (higher is better)");
	console.log("  MRR: Mean Reciprocal Rank (higher is better)");
	console.log("  P@k: Precision at k (higher is better)");
	console.log("  R@k: Recall at k (higher is better)");
	console.log("=".repeat(80));
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	console.log("Starting reranker quality evaluation...\n");

	const tiers: RerankerTier[] = ["fast", "accurate", "code"];
	const results: EvaluationResult[] = [];

	for (const tier of tiers) {
		console.log(`\nEvaluating tier: ${tier}`);
		console.log("-".repeat(80));

		try {
			const result = await evaluateTier(tier);
			results.push(result);
		} catch (error) {
			console.error(`[${tier}] Evaluation failed:`, error);
		}
	}

	// Print results
	printResults(results);

	// Find best tier for each metric
	console.log("\nBest performing tier by metric:");
	const metrics: (keyof Omit<EvaluationResult, "tier">)[] = [
		"ndcg_at_5",
		"mrr",
		"precision_at_5",
		"recall_at_5",
	];

	for (const metric of metrics) {
		const best = results.reduce((prev, current) =>
			current[metric] > prev[metric] ? current : prev,
		);
		console.log(`  ${metric}: ${best.tier} (${best[metric].toFixed(4)})`);
	}

	console.log("\nEvaluation complete!");
}

// Run if executed directly
if (import.meta.main) {
	main().catch(console.error);
}

// Export for testing
export { computeNDCG, computeMRR, computePrecisionAtK, computeRecallAtK };

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger } from "@engram/logger";
import type { BatchedReranker } from "../src/services/batched-reranker";

const logger = createLogger({ component: "RerankerEvaluation" });

/**
 * Relevance judgment for a single query-document pair.
 */
export interface RelevanceJudgment {
	category: string;
	query: string;
	documents: Array<{
		id: string;
		content: string;
		relevance: number; // 0-3 scale
	}>;
}

/**
 * Dataset of relevance judgments.
 */
export interface JudgmentDataset {
	version: string;
	description: string;
	judgments: RelevanceJudgment[];
}

/**
 * Evaluation metrics for reranker performance.
 */
export interface RerankerEvaluationMetrics {
	/** Normalized Discounted Cumulative Gain (measures ranking quality) */
	ndcg: number;
	/** Mean Average Precision (measures precision across all positions) */
	map: number;
	/** Precision at specific positions */
	precision: {
		at1: number; // Precision at position 1
		at5: number; // Precision at position 5
		at10: number; // Precision at position 10
	};
	/** Mean Reciprocal Rank (average of reciprocal ranks of first relevant item) */
	mrr: number;
	/** Per-category breakdown */
	byCategory: {
		[category: string]: {
			ndcg: number;
			map: number;
			precision: { at1: number; at5: number; at10: number };
			mrr: number;
			queryCount: number;
		};
	};
}

/**
 * Load relevance judgments from JSON file.
 *
 * @param filePath - Path to relevance judgments JSON file
 * @returns Parsed judgment dataset
 */
export function loadJudgments(filePath: string): JudgmentDataset {
	const content = readFileSync(filePath, "utf-8");
	return JSON.parse(content);
}

/**
 * Calculate Discounted Cumulative Gain at position k.
 *
 * DCG = rel[0] + sum(rel[i] / log2(i+1) for i=1 to k-1)
 */
function calculateDCG(relevanceScores: number[], k: number): number {
	let dcg = 0;

	for (let i = 0; i < Math.min(k, relevanceScores.length); i++) {
		const relevance = relevanceScores[i];
		if (i === 0) {
			dcg += relevance;
		} else {
			dcg += relevance / Math.log2(i + 1);
		}
	}

	return dcg;
}

/**
 * Calculate Normalized Discounted Cumulative Gain at position k.
 *
 * NDCG normalizes DCG by the ideal DCG (DCG of perfect ranking).
 * Returns value between 0 and 1, where 1 is perfect ranking.
 */
function calculateNDCG(actualRelevance: number[], idealRelevance: number[], k: number): number {
	const dcg = calculateDCG(actualRelevance, k);
	const idcg = calculateDCG(idealRelevance, k);

	if (idcg === 0) {
		return 0;
	}

	return dcg / idcg;
}

/**
 * Calculate Precision at k.
 *
 * Precision@k = (number of relevant items in top k) / k
 */
function calculatePrecisionAtK(relevanceScores: number[], k: number): number {
	const topK = relevanceScores.slice(0, k);
	const relevantCount = topK.filter((score) => score >= 2).length; // 2+ is relevant
	return relevantCount / k;
}

/**
 * Calculate Average Precision for a single query.
 *
 * AP = sum(Precision@k * rel[k]) / number of relevant items
 */
function calculateAveragePrecision(relevanceScores: number[]): number {
	const relevantCount = relevanceScores.filter((score) => score >= 2).length;

	if (relevantCount === 0) {
		return 0;
	}

	let sumPrecision = 0;

	for (let k = 1; k <= relevanceScores.length; k++) {
		const relevance = relevanceScores[k - 1];
		if (relevance >= 2) {
			// Item is relevant
			const precision = calculatePrecisionAtK(relevanceScores, k);
			sumPrecision += precision;
		}
	}

	return sumPrecision / relevantCount;
}

/**
 * Calculate Mean Reciprocal Rank for a single query.
 *
 * MRR = 1 / rank of first relevant item
 */
function calculateReciprocalRank(relevanceScores: number[]): number {
	for (let i = 0; i < relevanceScores.length; i++) {
		if (relevanceScores[i] >= 2) {
			// First relevant item
			return 1 / (i + 1);
		}
	}
	return 0; // No relevant items found
}

/**
 * Evaluate reranker performance on a dataset of relevance judgments.
 *
 * @param reranker - The BatchedReranker instance to evaluate
 * @param judgments - Array of relevance judgments
 * @returns Evaluation metrics including NDCG, MAP, Precision@k, and MRR
 */
export async function evaluateReranker(
	reranker: BatchedReranker,
	judgments: RelevanceJudgment[],
): Promise<RerankerEvaluationMetrics> {
	logger.info({
		msg: "Starting reranker evaluation",
		queryCount: judgments.length,
		model: reranker.getModel(),
	});

	const allNDCG: number[] = [];
	const allAP: number[] = [];
	const allP1: number[] = [];
	const allP5: number[] = [];
	const allP10: number[] = [];
	const allRR: number[] = [];

	// Per-category metrics
	const categoryMetrics: {
		[category: string]: {
			ndcg: number[];
			ap: number[];
			p1: number[];
			p5: number[];
			p10: number[];
			rr: number[];
		};
	} = {};

	for (const judgment of judgments) {
		const { category, query, documents } = judgment;

		// Prepare candidates
		const candidates = documents.map((doc) => ({
			id: doc.id,
			content: doc.content,
		}));

		// Ground truth: sorted by relevance (highest first)
		const groundTruth = [...documents].sort((a, b) => b.relevance - a.relevance);
		const idealRelevance = groundTruth.map((doc) => doc.relevance);

		// Rerank
		const results = await reranker.rerank(query, candidates, documents.length);

		// Get actual relevance scores in reranked order
		const actualRelevance = results.map((result) => {
			const doc = documents.find((d) => d.id === result.id);
			return doc?.relevance ?? 0;
		});

		// Calculate metrics for this query
		const ndcg = calculateNDCG(actualRelevance, idealRelevance, documents.length);
		const ap = calculateAveragePrecision(actualRelevance);
		const p1 = calculatePrecisionAtK(actualRelevance, 1);
		const p5 = calculatePrecisionAtK(actualRelevance, 5);
		const p10 = calculatePrecisionAtK(actualRelevance, 10);
		const rr = calculateReciprocalRank(actualRelevance);

		// Aggregate overall metrics
		allNDCG.push(ndcg);
		allAP.push(ap);
		allP1.push(p1);
		allP5.push(p5);
		allP10.push(p10);
		allRR.push(rr);

		// Aggregate per-category metrics
		if (!categoryMetrics[category]) {
			categoryMetrics[category] = {
				ndcg: [],
				ap: [],
				p1: [],
				p5: [],
				p10: [],
				rr: [],
			};
		}
		categoryMetrics[category].ndcg.push(ndcg);
		categoryMetrics[category].ap.push(ap);
		categoryMetrics[category].p1.push(p1);
		categoryMetrics[category].p5.push(p5);
		categoryMetrics[category].p10.push(p10);
		categoryMetrics[category].rr.push(rr);

		logger.debug({
			msg: "Query evaluated",
			query: query.substring(0, 50),
			ndcg: ndcg.toFixed(3),
			ap: ap.toFixed(3),
		});
	}

	// Calculate mean metrics
	const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

	const overallMetrics: RerankerEvaluationMetrics = {
		ndcg: mean(allNDCG),
		map: mean(allAP),
		precision: {
			at1: mean(allP1),
			at5: mean(allP5),
			at10: mean(allP10),
		},
		mrr: mean(allRR),
		byCategory: {},
	};

	// Calculate per-category means
	for (const [category, metrics] of Object.entries(categoryMetrics)) {
		overallMetrics.byCategory[category] = {
			ndcg: mean(metrics.ndcg),
			map: mean(metrics.ap),
			precision: {
				at1: mean(metrics.p1),
				at5: mean(metrics.p5),
				at10: mean(metrics.p10),
			},
			mrr: mean(metrics.rr),
			queryCount: metrics.ndcg.length,
		};
	}

	logger.info({
		msg: "Reranker evaluation completed",
		ndcg: overallMetrics.ndcg.toFixed(3),
		map: overallMetrics.map.toFixed(3),
		mrr: overallMetrics.mrr.toFixed(3),
		p1: overallMetrics.precision.at1.toFixed(3),
		p5: overallMetrics.precision.at5.toFixed(3),
		p10: overallMetrics.precision.at10.toFixed(3),
	});

	return overallMetrics;
}

/**
 * Run evaluation from command line.
 *
 * Usage:
 *   bun run test/evaluate-reranker.ts [judgments-file] [tier]
 *
 * Example:
 *   bun run test/evaluate-reranker.ts test/fixtures/relevance-judgments.json fast
 */
export async function main() {
	const args = process.argv.slice(2);

	const judgmentsFile = args[0] || join(__dirname, "fixtures", "relevance-judgments.json");
	const tier = (args[1] || "fast") as "fast" | "accurate" | "code";

	logger.info({
		msg: "Loading judgments",
		file: judgmentsFile,
		tier,
	});

	// Load judgments
	const dataset = loadJudgments(judgmentsFile);

	logger.info({
		msg: "Dataset loaded",
		version: dataset.version,
		queryCount: dataset.judgments.length,
	});

	// Import BatchedReranker
	const { BatchedReranker } = await import("../src/services/batched-reranker");

	// Create reranker for specified tier
	const reranker = BatchedReranker.forTier(tier);

	// Run evaluation
	const metrics = await evaluateReranker(reranker, dataset.judgments);

	// Print results
	console.log("\n=== Reranker Evaluation Results ===\n");
	console.log(`Model: ${reranker.getModel()}`);
	console.log(`Tier: ${tier}`);
	console.log(`Queries: ${dataset.judgments.length}\n`);

	console.log("Overall Metrics:");
	console.log(`  NDCG:       ${(metrics.ndcg * 100).toFixed(2)}%`);
	console.log(`  MAP:        ${(metrics.map * 100).toFixed(2)}%`);
	console.log(`  MRR:        ${(metrics.mrr * 100).toFixed(2)}%`);
	console.log(`  P@1:        ${(metrics.precision.at1 * 100).toFixed(2)}%`);
	console.log(`  P@5:        ${(metrics.precision.at5 * 100).toFixed(2)}%`);
	console.log(`  P@10:       ${(metrics.precision.at10 * 100).toFixed(2)}%\n`);

	console.log("By Category:");
	for (const [category, categoryMetrics] of Object.entries(metrics.byCategory)) {
		console.log(`  ${category} (n=${categoryMetrics.queryCount}):`);
		console.log(`    NDCG: ${(categoryMetrics.ndcg * 100).toFixed(2)}%`);
		console.log(`    MAP:  ${(categoryMetrics.map * 100).toFixed(2)}%`);
		console.log(`    MRR:  ${(categoryMetrics.mrr * 100).toFixed(2)}%`);
	}

	console.log("\n=== Evaluation Complete ===\n");
}

// Run if called directly
if (require.main === module) {
	main().catch((error) => {
		console.error("Evaluation failed:", error);
		process.exit(1);
	});
}

import type { LLMProvider } from "./reader.js";
import type {
	AbilityMetrics,
	AbstentionMetrics,
	BenchmarkResult,
	EvaluatedResult,
	EvaluationMetrics,
	MemoryAbility,
	ParsedInstance,
	RetrievalMetrics,
} from "./types.js";

/**
 * Configuration for evaluation
 */
export interface EvaluatorConfig {
	/** Whether to use LLM-based evaluation (more accurate, higher cost) */
	useLLMEvaluation: boolean;
	/** Use GPT-4o style evaluation prompt (LongMemEval methodology) */
	useGPT4oPrompt: boolean;
	/** Strict string matching for non-LLM evaluation */
	strictMatching: boolean;
	/** K values for recall and NDCG computation */
	kValues: number[];
}

/**
 * Default evaluator configuration
 */
export const DEFAULT_EVALUATOR_CONFIG: EvaluatorConfig = {
	useLLMEvaluation: false,
	useGPT4oPrompt: true,
	strictMatching: false,
	kValues: [1, 5, 10],
};

/**
 * Per-instance retrieval data for metrics computation
 */
export interface RetrievalData {
	questionId: string;
	/** IDs of retrieved documents in ranked order */
	retrievedIds: string[];
	/** Relevance scores for retrieved documents */
	scores: number[];
	/** IDs of ground truth evidence documents */
	evidenceIds: string[];
}

/**
 * Evaluator class for computing benchmark metrics
 *
 * Implements Milestone 4 enhancements:
 * - GPT-4o style evaluation (97% human agreement per LongMemEval)
 * - NDCG@K metrics for retrieval quality
 * - Abstention precision/recall metrics
 */
export class Evaluator {
	private config: EvaluatorConfig;
	private llm?: LLMProvider;

	constructor(config?: Partial<EvaluatorConfig>, llm?: LLMProvider) {
		this.config = { ...DEFAULT_EVALUATOR_CONFIG, ...config };
		this.llm = llm;
	}

	/**
	 * Evaluate a single result against ground truth
	 */
	async evaluateOne(
		result: BenchmarkResult,
		instance: ParsedInstance,
		_abstained?: boolean,
	): Promise<EvaluatedResult> {
		const correct =
			this.config.useLLMEvaluation && this.llm
				? await this.llmJudge(result.hypothesis, instance.answer, instance.question)
				: this.stringMatch(result.hypothesis, instance.answer);

		return {
			...result,
			answer: instance.answer,
			questionType: instance.questionType,
			memoryAbility: instance.memoryAbility,
			correct,
		};
	}

	/**
	 * Evaluate all results and compute aggregate metrics
	 */
	async evaluateAll(
		results: BenchmarkResult[],
		instances: ParsedInstance[],
		retrievalData?: RetrievalData[],
		abstentionFlags?: Map<string, boolean>,
	): Promise<{
		evaluated: EvaluatedResult[];
		metrics: EvaluationMetrics;
	}> {
		// Create lookup map for instances
		const instanceMap = new Map(instances.map((i) => [i.questionId, i]));

		// Evaluate each result
		const evaluated: EvaluatedResult[] = [];
		for (const result of results) {
			const instance = instanceMap.get(result.questionId);
			if (!instance) {
				console.warn(`No instance found for question: ${result.questionId}`);
				continue;
			}

			const abstained = abstentionFlags?.get(result.questionId);
			const evalResult = await this.evaluateOne(result, instance, abstained);
			evaluated.push(evalResult);
		}

		// Compute metrics
		const metrics = this.computeMetrics(evaluated);

		// Compute retrieval metrics if data provided
		if (retrievalData && retrievalData.length > 0) {
			metrics.retrieval = this.computeRetrievalMetrics(retrievalData);
		}

		// Compute abstention metrics if flags provided
		if (abstentionFlags) {
			metrics.abstention = this.computeAbstentionMetrics(evaluated, abstentionFlags);
		}

		return { evaluated, metrics };
	}

	/**
	 * String-based matching (baseline evaluation)
	 */
	private stringMatch(hypothesis: string, answer: string): boolean {
		const normalizedHyp = this.normalize(hypothesis);
		const normalizedAns = this.normalize(answer);

		if (this.config.strictMatching) {
			return normalizedHyp === normalizedAns;
		}

		// Fuzzy matching: check if answer is contained in hypothesis
		// or if they share significant overlap
		if (normalizedHyp.includes(normalizedAns)) {
			return true;
		}

		if (normalizedAns.includes(normalizedHyp)) {
			return true;
		}

		// Check word overlap
		const hypWords = new Set(normalizedHyp.split(/\s+/));
		const ansWords = normalizedAns.split(/\s+/);

		const overlap = ansWords.filter((w) => hypWords.has(w)).length;
		const overlapRatio = overlap / ansWords.length;

		return overlapRatio >= 0.7;
	}

	/**
	 * Normalize text for comparison
	 */
	private normalize(text: string): string {
		return text
			.toLowerCase()
			.replace(/[^\w\s]/g, "") // Remove punctuation
			.replace(/\s+/g, " ") // Normalize whitespace
			.trim();
	}

	/**
	 * LLM-based evaluation using GPT-4o style prompt
	 * Based on LongMemEval's methodology (97% human agreement)
	 */
	private async llmJudge(hypothesis: string, answer: string, question: string): Promise<boolean> {
		if (!this.llm) {
			throw new Error("LLM provider required for LLM evaluation");
		}

		const prompt = this.config.useGPT4oPrompt
			? this.buildGPT4oPrompt(hypothesis, answer, question)
			: this.buildBasicPrompt(hypothesis, answer, question);

		const response = await this.llm.complete(prompt, {
			temperature: 0,
			maxTokens: 50,
		});

		return this.parseJudgment(response.text);
	}

	/**
	 * GPT-4o style evaluation prompt (LongMemEval methodology)
	 * Achieves 97% agreement with human evaluation
	 */
	private buildGPT4oPrompt(hypothesis: string, answer: string, question: string): string {
		return `You are an expert evaluator for a memory-augmented AI system. Your task is to determine if a generated answer correctly addresses a question when compared to a ground-truth reference answer.

## Evaluation Criteria

A generated answer is CORRECT if:
1. It contains the essential information from the reference answer
2. The factual claims match the reference (dates, names, numbers, etc.)
3. Minor phrasing differences or additional context are acceptable
4. Partial answers are correct if they include the key facts

A generated answer is INCORRECT if:
1. It contradicts the reference answer
2. It contains factually wrong information
3. It is completely unrelated to the question
4. It is a refusal/abstention when the information is available

Special cases:
- Abstention answers ("I don't know", "No information available") are CORRECT only if the reference indicates the question is unanswerable
- Numeric answers must match exactly or be semantically equivalent (e.g., "3" = "three")
- Date formats can vary as long as they refer to the same date

## Question
${question}

## Reference Answer (Ground Truth)
${answer}

## Generated Answer
${hypothesis}

## Your Judgment
Analyze the generated answer against the reference. Consider semantic equivalence, not just string matching.

Output ONLY one of these two words on a single line:
CORRECT
INCORRECT`;
	}

	/**
	 * Basic evaluation prompt (fallback)
	 */
	private buildBasicPrompt(hypothesis: string, answer: string, question: string): string {
		return `You are evaluating whether a generated answer correctly addresses a question compared to a reference answer.

## Question
${question}

## Reference Answer
${answer}

## Generated Answer
${hypothesis}

## Task
Determine if the generated answer is correct. Consider:
1. The generated answer captures the key information from the reference
2. Minor differences in wording are acceptable
3. Additional correct information is acceptable
4. Incorrect or contradictory information is NOT acceptable
5. "I don't know" type answers are only correct if the reference also indicates unknown

Respond with ONLY "CORRECT" or "INCORRECT" on a single line.`;
	}

	/**
	 * Parse LLM judgment response
	 */
	private parseJudgment(text: string): boolean {
		const upper = text.trim().toUpperCase();
		// Look for CORRECT not preceded by IN
		if (upper.includes("INCORRECT")) {
			return false;
		}
		return upper.includes("CORRECT");
	}

	/**
	 * Compute aggregate metrics from evaluated results
	 */
	private computeMetrics(evaluated: EvaluatedResult[]): EvaluationMetrics {
		const total = evaluated.length;
		const correct = evaluated.filter((e) => e.correct).length;

		// Initialize per-ability metrics
		const byAbility: Record<MemoryAbility, AbilityMetrics> = {
			IE: { total: 0, correct: 0, accuracy: 0 },
			MR: { total: 0, correct: 0, accuracy: 0 },
			TR: { total: 0, correct: 0, accuracy: 0 },
			KU: { total: 0, correct: 0, accuracy: 0 },
			ABS: { total: 0, correct: 0, accuracy: 0 },
		};

		// Aggregate by ability
		for (const result of evaluated) {
			const ability = result.memoryAbility;
			byAbility[ability].total++;
			if (result.correct) {
				byAbility[ability].correct++;
			}
		}

		// Compute accuracy per ability
		for (const ability of Object.keys(byAbility) as MemoryAbility[]) {
			const metrics = byAbility[ability];
			metrics.accuracy = metrics.total > 0 ? metrics.correct / metrics.total : 0;
		}

		return {
			overall: {
				total,
				correct,
				accuracy: total > 0 ? correct / total : 0,
			},
			byAbility,
		};
	}

	/**
	 * Compute retrieval metrics including NDCG
	 */
	private computeRetrievalMetrics(retrievalData: RetrievalData[]): RetrievalMetrics {
		const recallAtK: Record<number, number> = {};
		const ndcgAtK: Record<number, number> = {};

		// Initialize for each K value
		for (const k of this.config.kValues) {
			recallAtK[k] = 0;
			ndcgAtK[k] = 0;
		}

		let totalTurnRecall = 0;
		let totalSessionRecall = 0;
		let totalMRR = 0;

		for (const data of retrievalData) {
			const evidenceSet = new Set(data.evidenceIds);

			// Compute recall at K
			for (const k of this.config.kValues) {
				const topK = data.retrievedIds.slice(0, k);
				const retrieved = topK.filter((id) => evidenceSet.has(id)).length;
				const recall = evidenceSet.size > 0 ? retrieved / evidenceSet.size : 1;
				recallAtK[k] += recall;
			}

			// Compute NDCG at K
			for (const k of this.config.kValues) {
				ndcgAtK[k] += this.computeNDCG(data.retrievedIds.slice(0, k), evidenceSet);
			}

			// Turn recall (all retrieved)
			const allRetrieved = data.retrievedIds.filter((id) => evidenceSet.has(id)).length;
			totalTurnRecall += evidenceSet.size > 0 ? allRetrieved / evidenceSet.size : 1;

			// Session recall (simplified - treat as same for now)
			totalSessionRecall += evidenceSet.size > 0 ? allRetrieved / evidenceSet.size : 1;

			// MRR - reciprocal rank of first relevant document
			totalMRR += this.computeReciprocalRank(data.retrievedIds, evidenceSet);
		}

		const n = retrievalData.length || 1;

		// Average across all instances
		for (const k of this.config.kValues) {
			recallAtK[k] /= n;
			ndcgAtK[k] /= n;
		}

		return {
			turnRecall: totalTurnRecall / n,
			sessionRecall: totalSessionRecall / n,
			recallAtK,
			ndcgAtK,
			mrr: totalMRR / n,
		};
	}

	/**
	 * Compute NDCG (Normalized Discounted Cumulative Gain)
	 *
	 * NDCG measures the quality of a ranking by comparing to ideal ranking.
	 * Uses binary relevance (1 if in evidence set, 0 otherwise).
	 */
	private computeNDCG(rankedIds: string[], evidenceSet: Set<string>): number {
		if (rankedIds.length === 0 || evidenceSet.size === 0) {
			return evidenceSet.size === 0 ? 1 : 0;
		}

		// DCG: sum of relevance / log2(rank + 1)
		let dcg = 0;
		for (let i = 0; i < rankedIds.length; i++) {
			const relevance = evidenceSet.has(rankedIds[i]) ? 1 : 0;
			dcg += relevance / Math.log2(i + 2); // i+2 because log2(1) = 0
		}

		// IDCG: ideal DCG (all relevant items at top)
		const idealRanking = Math.min(evidenceSet.size, rankedIds.length);
		let idcg = 0;
		for (let i = 0; i < idealRanking; i++) {
			idcg += 1 / Math.log2(i + 2);
		}

		return idcg > 0 ? dcg / idcg : 0;
	}

	/**
	 * Compute reciprocal rank (1/rank of first relevant item)
	 */
	private computeReciprocalRank(rankedIds: string[], evidenceSet: Set<string>): number {
		for (let i = 0; i < rankedIds.length; i++) {
			if (evidenceSet.has(rankedIds[i])) {
				return 1 / (i + 1);
			}
		}
		return 0;
	}

	/**
	 * Compute abstention-specific metrics
	 *
	 * For abstention questions (ABS), we want to measure:
	 * - Precision: Of all abstentions, how many were correct?
	 * - Recall: Of questions requiring abstention, how many abstained?
	 */
	private computeAbstentionMetrics(
		evaluated: EvaluatedResult[],
		abstentionFlags: Map<string, boolean>,
	): AbstentionMetrics {
		let truePositives = 0; // Correctly abstained on ABS questions
		let falsePositives = 0; // Incorrectly abstained on non-ABS questions
		let falseNegatives = 0; // Should have abstained but didn't
		let trueNegatives = 0; // Correctly answered non-ABS questions

		for (const result of evaluated) {
			const didAbstain = abstentionFlags.get(result.questionId) ?? false;
			const shouldAbstain = result.memoryAbility === "ABS";

			if (shouldAbstain && didAbstain) {
				truePositives++;
			} else if (!shouldAbstain && didAbstain) {
				falsePositives++;
			} else if (shouldAbstain && !didAbstain) {
				falseNegatives++;
			} else {
				trueNegatives++;
			}
		}

		const precision =
			truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;

		const recall =
			truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;

		const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

		return {
			truePositives,
			falsePositives,
			falseNegatives,
			trueNegatives,
			precision,
			recall,
			f1,
		};
	}
}

/**
 * Format metrics as a human-readable report
 */
export function formatMetricsReport(metrics: EvaluationMetrics): string {
	const lines: string[] = [
		"# LongMemEval Benchmark Results",
		"",
		"## Overall",
		`- Total: ${metrics.overall.total}`,
		`- Correct: ${metrics.overall.correct}`,
		`- Accuracy: ${(metrics.overall.accuracy * 100).toFixed(1)}%`,
		"",
		"## By Memory Ability",
		"",
		"| Ability | Total | Correct | Accuracy |",
		"|:--------|------:|--------:|---------:|",
	];

	const abilityNames: Record<MemoryAbility, string> = {
		IE: "Information Extraction",
		MR: "Multi-Session Reasoning",
		TR: "Temporal Reasoning",
		KU: "Knowledge Update",
		ABS: "Abstention",
	};

	for (const [ability, name] of Object.entries(abilityNames) as [MemoryAbility, string][]) {
		const m = metrics.byAbility[ability];
		lines.push(
			`| ${name} (${ability}) | ${m.total} | ${m.correct} | ${(m.accuracy * 100).toFixed(1)}% |`,
		);
	}

	if (metrics.retrieval) {
		lines.push("");
		lines.push("## Retrieval Metrics");
		lines.push("");
		lines.push(`- Turn Recall: ${((metrics.retrieval.turnRecall ?? 0) * 100).toFixed(1)}%`);
		lines.push(`- Session Recall: ${((metrics.retrieval.sessionRecall ?? 0) * 100).toFixed(1)}%`);
		if (metrics.retrieval.mrr !== undefined) {
			lines.push(`- MRR: ${metrics.retrieval.mrr.toFixed(3)}`);
		}
		lines.push("");
		lines.push("### Recall@K");
		lines.push("");
		lines.push("| K | Recall |");
		lines.push("|--:|-------:|");
		if (metrics.retrieval.recallAtK) {
			for (const [k, recall] of Object.entries(metrics.retrieval.recallAtK)) {
				lines.push(`| ${k} | ${((recall ?? 0) * 100).toFixed(1)}% |`);
			}
		}
		if (metrics.retrieval.ndcgAtK) {
			lines.push("");
			lines.push("### NDCG@K");
			lines.push("");
			lines.push("| K | NDCG |");
			lines.push("|--:|-----:|");
			for (const [k, ndcg] of Object.entries(metrics.retrieval.ndcgAtK)) {
				lines.push(`| ${k} | ${(ndcg ?? 0).toFixed(3)} |`);
			}
		}
	}

	if (metrics.abstention) {
		lines.push("");
		lines.push("## Abstention Metrics");
		lines.push("");
		lines.push(`- Precision: ${(metrics.abstention.precision * 100).toFixed(1)}%`);
		lines.push(`- Recall: ${(metrics.abstention.recall * 100).toFixed(1)}%`);
		lines.push(`- F1 Score: ${(metrics.abstention.f1 * 100).toFixed(1)}%`);
		lines.push("");
		lines.push("### Confusion Matrix");
		lines.push("");
		lines.push("|  | Abstained | Answered |");
		lines.push("|:--|----------:|---------:|");
		lines.push(
			`| Should Abstain | ${metrics.abstention.truePositives} (TP) | ${metrics.abstention.falseNegatives} (FN) |`,
		);
		lines.push(
			`| Should Answer | ${metrics.abstention.falsePositives} (FP) | ${metrics.abstention.trueNegatives} (TN) |`,
		);
	}

	return lines.join("\n");
}

/**
 * Save results to JSONL format (LongMemEval output format)
 */
export function resultsToJsonl(results: BenchmarkResult[]): string {
	return results
		.map((r) => JSON.stringify({ question_id: r.questionId, hypothesis: r.hypothesis }))
		.join("\n");
}

/**
 * Parse results from JSONL format
 */
export function parseJsonlResults(jsonl: string): BenchmarkResult[] {
	return jsonl
		.trim()
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const parsed = JSON.parse(line);
			return {
				questionId: parsed.question_id,
				hypothesis: parsed.hypothesis,
			};
		});
}

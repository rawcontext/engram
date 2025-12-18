import type {
	AbilityMetrics,
	BenchmarkResult,
	EvaluatedResult,
	EvaluationMetrics,
	MemoryAbility,
	ParsedInstance,
} from "./types.js";
import type { LLMProvider } from "./reader.js";

/**
 * Configuration for evaluation
 */
export interface EvaluatorConfig {
	/** Whether to use LLM-based evaluation (more accurate, higher cost) */
	useLLMEvaluation: boolean;
	/** Strict string matching for non-LLM evaluation */
	strictMatching: boolean;
}

/**
 * Default evaluator configuration
 */
export const DEFAULT_EVALUATOR_CONFIG: EvaluatorConfig = {
	useLLMEvaluation: false,
	strictMatching: false,
};

/**
 * Evaluator class for computing benchmark metrics
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
	async evaluateOne(result: BenchmarkResult, instance: ParsedInstance): Promise<EvaluatedResult> {
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

			const evalResult = await this.evaluateOne(result, instance);
			evaluated.push(evalResult);
		}

		// Compute metrics
		const metrics = this.computeMetrics(evaluated);

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
	 * LLM-based evaluation (more accurate)
	 * Based on LongMemEval's methodology using GPT-4o
	 */
	private async llmJudge(hypothesis: string, answer: string, question: string): Promise<boolean> {
		if (!this.llm) {
			throw new Error("LLM provider required for LLM evaluation");
		}

		const prompt = `You are evaluating whether a generated answer correctly addresses a question compared to a reference answer.

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

		const response = await this.llm.complete(prompt, {
			temperature: 0,
			maxTokens: 10,
		});

		return response.text.trim().toUpperCase().includes("CORRECT");
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
		lines.push(`- Turn Recall: ${(metrics.retrieval.turnRecall * 100).toFixed(1)}%`);
		lines.push(`- Session Recall: ${(metrics.retrieval.sessionRecall * 100).toFixed(1)}%`);
		lines.push("");
		lines.push("### Recall@K");
		for (const [k, recall] of Object.entries(metrics.retrieval.recallAtK)) {
			lines.push(`- Recall@${k}: ${(recall * 100).toFixed(1)}%`);
		}
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

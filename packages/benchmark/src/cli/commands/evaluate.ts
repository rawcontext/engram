import { readFile, writeFile } from "node:fs/promises";
import { loadDataset } from "../../longmemeval/loader.js";
import { Evaluator, formatMetricsReport, parseJsonlResults } from "../../longmemeval/evaluator.js";

interface EvaluateOptions {
	hypothesis: string;
	groundTruth: string;
	output?: string;
	llmEval: boolean;
}

export async function evaluateCommand(options: EvaluateOptions): Promise<void> {
	console.log("📊 Evaluating benchmark results");
	console.log("");
	console.log(`  Hypothesis file: ${options.hypothesis}`);
	console.log(`  Ground truth: ${options.groundTruth}`);
	console.log(`  LLM evaluation: ${options.llmEval}`);
	console.log("");

	try {
		// Load hypothesis results
		console.log("Loading hypothesis file...");
		const hypothesisContent = await readFile(options.hypothesis, "utf-8");
		const results = parseJsonlResults(hypothesisContent);
		console.log(`  Loaded ${results.length} results`);

		// Load ground truth
		console.log("Loading ground truth dataset...");
		const { instances } = await loadDataset({ datasetPath: options.groundTruth });
		console.log(`  Loaded ${instances.length} instances`);

		// Evaluate
		console.log("Evaluating...");

		// TODO: Add LLM provider for LLM-based evaluation
		if (options.llmEval) {
			console.warn("⚠️  LLM evaluation requested but no LLM provider configured");
			console.warn("   Falling back to string matching");
		}

		const evaluator = new Evaluator({ useLLMEvaluation: false });
		const { evaluated, metrics } = await evaluator.evaluateAll(results, instances);

		// Print report
		console.log("");
		console.log("=".repeat(60));
		console.log(formatMetricsReport(metrics));
		console.log("=".repeat(60));

		// Save metrics if output path specified
		if (options.output) {
			const outputData = {
				metrics,
				evaluated: evaluated.map((e) => ({
					questionId: e.questionId,
					questionType: e.questionType,
					memoryAbility: e.memoryAbility,
					correct: e.correct,
				})),
			};
			await writeFile(options.output, JSON.stringify(outputData, null, 2), "utf-8");
			console.log(`\n✅ Metrics saved to: ${options.output}`);
		}

		// Exit with appropriate code
		const accuracy = metrics.overall.accuracy;
		if (accuracy >= 0.7) {
			console.log("\n✅ Benchmark passed (accuracy >= 70%)");
		} else if (accuracy >= 0.5) {
			console.log("\n⚠️  Benchmark marginal (50% <= accuracy < 70%)");
		} else {
			console.log("\n❌ Benchmark needs improvement (accuracy < 50%)");
		}
	} catch (error) {
		console.error("\n❌ Evaluation failed:", error);
		process.exit(1);
	}
}

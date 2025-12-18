import { writeFile } from "node:fs/promises";
import { BenchmarkPipeline, type PipelineProgress } from "../../longmemeval/pipeline.js";
import { StubEmbeddingProvider, StubLLMProvider } from "../../longmemeval/reader.js";
import type { DatasetVariant } from "../../longmemeval/types.js";

interface RunOptions {
	dataset: string;
	variant: string;
	output?: string;
	limit?: number;
	topK: number;
	retriever: string;
	chainOfNote: boolean;
	timeAware: boolean;
	verbose: boolean;
}

export async function runCommand(benchmark: string, options: RunOptions): Promise<void> {
	if (benchmark !== "longmemeval") {
		console.error(`Unknown benchmark: ${benchmark}`);
		console.error("Available benchmarks: longmemeval");
		process.exit(1);
	}

	console.log("🚀 Starting LongMemEval benchmark");
	console.log("");
	console.log("Configuration:");
	console.log(`  Dataset: ${options.dataset}`);
	console.log(`  Variant: ${options.variant}`);
	console.log(`  Top-K: ${options.topK}`);
	console.log(`  Retriever: ${options.retriever}`);
	console.log(`  Chain-of-Note: ${options.chainOfNote}`);
	console.log(`  Time-Aware: ${options.timeAware}`);
	if (options.limit) {
		console.log(`  Limit: ${options.limit} instances`);
	}
	console.log("");

	// TODO: Replace with real embedding and LLM providers
	console.log("⚠️  Using stub providers (no real embeddings/LLM configured)");
	console.log("   For accurate results, configure real providers.");
	console.log("");

	const embeddings = new StubEmbeddingProvider();
	const llm = new StubLLMProvider();

	const pipeline = new BenchmarkPipeline(embeddings, llm, {
		loader: {
			datasetPath: options.dataset,
			variant: options.variant as DatasetVariant,
			limit: options.limit,
		},
		retriever: {
			method: options.retriever as "dense" | "bm25" | "hybrid",
			topK: options.topK,
			timeAwareExpansion: options.timeAware,
		},
		reader: {
			chainOfNote: options.chainOfNote,
		},
		onProgress: (progress: PipelineProgress) => {
			if (options.verbose) {
				console.log(
					`[${progress.stage}] ${progress.current}/${progress.total} - ${progress.message}`,
				);
			} else {
				// Simple progress bar
				const pct = Math.round((progress.current / progress.total) * 100);
				process.stdout.write(`\r${progress.stage}: ${pct}%`);
			}
		},
	});

	try {
		const result = await pipeline.run();

		console.log("\n");
		console.log("=".repeat(60));
		console.log(result.report);
		console.log("=".repeat(60));

		// Save results if output path specified
		if (options.output) {
			await writeFile(options.output, result.jsonl, "utf-8");
			console.log(`\n✅ Results saved to: ${options.output}`);
		}

		// Save detailed report
		const reportPath = options.output
			? options.output.replace(".jsonl", "-report.md")
			: "longmemeval-report.md";
		await writeFile(reportPath, result.report, "utf-8");
		console.log(`📊 Report saved to: ${reportPath}`);
	} catch (error) {
		console.error("\n❌ Benchmark failed:", error);
		process.exit(1);
	}
}

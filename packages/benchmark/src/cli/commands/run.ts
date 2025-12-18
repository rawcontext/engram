import { writeFile } from "node:fs/promises";
import { BenchmarkPipeline, type PipelineProgress } from "../../longmemeval/pipeline.js";
import { StubEmbeddingProvider, StubLLMProvider } from "../../longmemeval/reader.js";
import { QdrantEmbeddingProvider } from "../../longmemeval/providers/qdrant-provider.js";
import {
	AnthropicProvider,
	OllamaProvider,
	OpenAICompatibleProvider,
} from "../../longmemeval/providers/anthropic-provider.js";
import type { EmbeddingProvider } from "../../longmemeval/retriever.js";
import type { LLMProvider } from "../../longmemeval/reader.js";
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
	// Provider options
	embeddings: string;
	llm: string;
	qdrantUrl?: string;
	ollamaUrl?: string;
	ollamaModel?: string;
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
	console.log(`  Embeddings: ${options.embeddings}`);
	console.log(`  LLM: ${options.llm}`);
	if (options.limit) {
		console.log(`  Limit: ${options.limit} instances`);
	}
	console.log("");

	// Initialize providers
	const embeddings = createEmbeddingProvider(options);
	const llm = createLLMProvider(options);

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

/**
 * Create embedding provider based on options
 */
function createEmbeddingProvider(options: RunOptions): EmbeddingProvider {
	switch (options.embeddings) {
		case "qdrant":
		case "e5":
			console.log("📦 Using Qdrant/E5 embeddings (HuggingFace transformers)");
			return new QdrantEmbeddingProvider({
				url: options.qdrantUrl ?? "http://localhost:6333",
			});

		case "stub":
		default:
			console.log("⚠️  Using stub embeddings (random vectors)");
			return new StubEmbeddingProvider();
	}
}

/**
 * Create LLM provider based on options
 */
function createLLMProvider(options: RunOptions): LLMProvider {
	switch (options.llm) {
		case "anthropic":
		case "claude":
			if (!process.env.ANTHROPIC_API_KEY) {
				console.error("❌ ANTHROPIC_API_KEY environment variable required for Claude");
				process.exit(1);
			}
			console.log("🤖 Using Anthropic Claude for answer generation");
			return new AnthropicProvider();

		case "openai":
		case "gpt":
			if (!process.env.OPENAI_API_KEY) {
				console.error("❌ OPENAI_API_KEY environment variable required for OpenAI");
				process.exit(1);
			}
			console.log("🤖 Using OpenAI GPT for answer generation");
			return new OpenAICompatibleProvider();

		case "ollama":
			console.log(`🤖 Using Ollama (${options.ollamaModel ?? "llama3.2"}) for answer generation`);
			return new OllamaProvider({
				baseUrl: options.ollamaUrl ?? "http://localhost:11434",
				model: options.ollamaModel ?? "llama3.2",
			});

		case "stub":
		default:
			console.log("⚠️  Using stub LLM (no real generation)");
			return new StubLLMProvider();
	}
}

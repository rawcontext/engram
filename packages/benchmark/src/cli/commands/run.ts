import { writeFile } from "node:fs/promises";
import {
	BenchmarkPipeline,
	type CustomRetriever,
	type PipelineProgress,
	type RetrievalDebugInfo,
} from "../../longmemeval/pipeline.js";
import {
	AnthropicProvider,
	GeminiProvider,
	OllamaProvider,
	OpenAICompatibleProvider,
} from "../../longmemeval/providers/anthropic-provider.js";
import { EngramRetriever } from "../../longmemeval/providers/engram-provider.js";
import { QdrantEmbeddingProvider } from "../../longmemeval/providers/qdrant-provider.js";
import type { LLMProvider } from "../../longmemeval/reader.js";
import { StubEmbeddingProvider, StubLLMProvider } from "../../longmemeval/reader.js";
import type { EmbeddingProvider } from "../../longmemeval/retriever.js";
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
	// Gemini options
	geminiModel?: string;
	// Milestone 2 optimizations
	keyExpansion: boolean;
	temporalAnalysis: boolean;
	// Engram full pipeline options
	rerank: boolean;
	rerankTier: string;
	rerankDepth: number;
	hybridSearch: boolean;
	// Learned fusion options
	learnedFusion: boolean;
	fusionModel: string;
	// Multi-query retrieval options
	multiQuery: boolean;
	multiQueryVariations: number;
	// Abstention detection options
	abstention: boolean;
	abstentionThreshold: number;
	abstentionHedging: boolean;
	abstentionNli: boolean;
	abstentionNliThreshold: number;
	// Session-aware retrieval options
	sessionAware: boolean;
	topSessions: number;
	turnsPerSession: number;
	// Temporal query parsing options
	temporalAware: boolean;
	temporalConfidenceThreshold: number;
	// Embedding model options
	embeddingModel: string;
	// Debug options
	debugRetrieval: boolean;
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
	console.log(`  Key Expansion: ${options.keyExpansion}`);
	console.log(`  Temporal Analysis: ${options.temporalAnalysis}`);
	if (options.embeddings === "engram") {
		console.log(`  Hybrid Search: ${options.hybridSearch}`);
		console.log(`  Learned Fusion: ${options.learnedFusion}`);
		if (options.learnedFusion) {
			console.log(`  Fusion Model: ${options.fusionModel}`);
		}
		console.log(`  Rerank: ${options.rerank}`);
		if (options.rerank) {
			console.log(`  Rerank Tier: ${options.rerankTier}`);
			console.log(`  Rerank Depth: ${options.rerankDepth}`);
		}
		console.log(`  Multi-Query: ${options.multiQuery}`);
		if (options.multiQuery) {
			console.log(`  Multi-Query Variations: ${options.multiQueryVariations}`);
		}
		console.log(`  Abstention Detection: ${options.abstention}`);
		if (options.abstention) {
			console.log(`  Abstention Threshold: ${options.abstentionThreshold}`);
			console.log(`  Abstention Hedging (Layer 3): ${options.abstentionHedging}`);
			console.log(`  Abstention NLI (Layer 2): ${options.abstentionNli}`);
			if (options.abstentionNli) {
				console.log(`  Abstention NLI Threshold: ${options.abstentionNliThreshold}`);
			}
		}
		console.log(`  Session-Aware Retrieval: ${options.sessionAware}`);
		if (options.sessionAware) {
			console.log(`  Top Sessions (Stage 1): ${options.topSessions}`);
			console.log(`  Turns Per Session (Stage 2): ${options.turnsPerSession}`);
		}
		console.log(`  Temporal Query Parsing: ${options.temporalAware}`);
		if (options.temporalAware) {
			console.log(`  Temporal Confidence Threshold: ${options.temporalConfidenceThreshold}`);
		}
		console.log(`  Embedding Model: ${options.embeddingModel}`);
	}
	if (options.limit) {
		console.log(`  Limit: ${options.limit} instances`);
	}
	console.log("");

	// Initialize providers
	const embeddings = createEmbeddingProvider(options);
	const llm = createLLMProvider(options);
	const customRetriever = createCustomRetriever(options);

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
			// Enable abstention detection in Reader if --abstention-hedging or --abstention-nli
			abstentionDetection:
				options.abstention && (options.abstentionHedging || options.abstentionNli),
			abstentionNLI: options.abstentionNli,
			abstentionNLIThreshold: options.abstentionNliThreshold,
		},
		// Milestone 2 optimizations
		keyExpansion: {
			enabled: options.keyExpansion,
			types: ["keyphrase", "userfact"],
		},
		temporal: {
			enabled: options.temporalAnalysis,
		},
		// Custom retriever for Engram full pipeline
		customRetriever,
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
		// Debug retrieval callback
		onRetrievalDebug: options.debugRetrieval ? logRetrievalDebug : undefined,
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

		// ONNX runtime has threading issues that cause ugly errors at exit
		// Suppress stderr briefly and force exit
		const originalStderr = process.stderr.write.bind(process.stderr);
		process.stderr.write = () => true; // Suppress ONNX mutex errors
		setTimeout(() => {
			process.stderr.write = originalStderr;
			process.exit(0);
		}, 100);
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
		case "engram":
			// Engram uses custom retriever, but we still need a stub for pipeline init
			console.log("🚀 Using Engram full pipeline (search-core)");
			console.log("   - Dense: E5-small (384d)");
			if (options.hybridSearch) {
				console.log("   - Sparse: SPLADE");
				console.log("   - Fusion: RRF");
			}
			if (options.rerank) {
				console.log(`   - Reranker: ${options.rerankTier} tier`);
			}
			return new StubEmbeddingProvider(); // Pipeline uses customRetriever instead

		case "qdrant":
		case "e5":
			console.log("📦 Using Qdrant/E5 embeddings (HuggingFace transformers)");
			return new QdrantEmbeddingProvider({
				url: options.qdrantUrl ?? "http://localhost:6333",
			});
		default:
			console.log("⚠️  Using stub embeddings (random vectors)");
			return new StubEmbeddingProvider();
	}
}

/**
 * Create custom retriever for Engram full pipeline
 */
function createCustomRetriever(options: RunOptions): CustomRetriever | undefined {
	if (options.embeddings !== "engram") {
		return undefined;
	}

	return new EngramRetriever({
		qdrantUrl: options.qdrantUrl ?? "http://localhost:6333",
		hybridSearch: options.hybridSearch,
		learnedFusion: options.learnedFusion,
		fusionModel: options.fusionModel,
		rerank: options.rerank,
		rerankTier: options.rerankTier as "fast" | "accurate" | "code" | "colbert",
		rerankDepth: options.rerankDepth,
		topK: options.topK,
		multiQuery: options.multiQuery,
		multiQueryVariations: options.multiQueryVariations,
		abstention: options.abstention,
		abstentionThreshold: options.abstentionThreshold,
		sessionAware: options.sessionAware,
		topSessions: options.topSessions,
		turnsPerSession: options.turnsPerSession,
		temporalAware: options.temporalAware,
		temporalConfidenceThreshold: options.temporalConfidenceThreshold,
		embeddingModel: options.embeddingModel as
			| "e5-small"
			| "e5-base"
			| "e5-large"
			| "gte-base"
			| "gte-large"
			| "bge-small"
			| "bge-base"
			| "bge-large",
	});
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
			if (!options.ollamaModel) {
				console.error("❌ --ollama-model is required when using Ollama");
				process.exit(1);
			}
			console.log(`🤖 Using Ollama (${options.ollamaModel}) for answer generation`);
			return new OllamaProvider({
				baseUrl: options.ollamaUrl ?? "http://localhost:11434",
				model: options.ollamaModel,
			});

		case "gemini":
		case "google":
			if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
				console.error("❌ GOOGLE_GENERATIVE_AI_API_KEY environment variable required for Gemini");
				process.exit(1);
			}
			console.log(
				`🤖 Using Google Gemini (${options.geminiModel ?? "gemini-3-flash-preview"}) for answer generation`,
			);
			return new GeminiProvider({
				model: options.geminiModel ?? "gemini-3-flash-preview",
			});
		default:
			console.log("⚠️  Using stub LLM (no real generation)");
			return new StubLLMProvider();
	}
}

/**
 * Log retrieval debug info to console
 */
function logRetrievalDebug(debug: RetrievalDebugInfo): void {
	const truncate = (s: string, len: number) => (s.length > len ? `${s.slice(0, len)}...` : s);

	console.log(`\n${"─".repeat(80)}`);
	console.log(`📋 RETRIEVAL DEBUG: ${debug.questionId}`);
	console.log("─".repeat(80));

	console.log(`\n❓ Question: ${debug.question}`);
	console.log(`✅ Expected Answer: ${debug.expectedAnswer}`);
	console.log(`📊 Recall: ${(debug.recall * 100).toFixed(1)}%`);

	console.log(`\n🎯 EXPECTED EVIDENCE (${debug.evidenceDocs.length} docs):`);
	for (const doc of debug.evidenceDocs) {
		const found = debug.retrievedDocs.some((r) => r.id === doc.id);
		const status = found ? "✅" : "❌";
		console.log(`  ${status} [${doc.sessionId}] ${truncate(doc.content, 100)}`);
	}

	console.log(`\n🔍 RETRIEVED (${debug.retrievedDocs.length} docs):`);
	for (let i = 0; i < debug.retrievedDocs.length; i++) {
		const doc = debug.retrievedDocs[i];
		const marker = doc.isEvidence ? "🎯" : "  ";
		console.log(
			`  ${i + 1}. ${marker} [score=${doc.score.toFixed(3)}] ${truncate(doc.content, 80)}`,
		);
	}

	console.log(`${"─".repeat(80)}\n`);
}

#!/usr/bin/env node
import { Command } from "commander";
import { evaluateCommand } from "./commands/evaluate.js";
import { runCommand } from "./commands/run.js";
import {
	DEFAULT_DENSE_STEPS,
	DEFAULT_SPARSE_STEPS,
	trainFusionCommand,
} from "./commands/train-fusion.js";
import { validateCommand } from "./commands/validate.js";

const program = new Command();

program
	.name("engram-benchmark")
	.description("Benchmark Engram memory system against industry benchmarks")
	.version("0.0.1");

// Run benchmark command
program
	.command("run")
	.description("Run a benchmark against Engram")
	.argument("<benchmark>", "Benchmark to run (longmemeval)")
	.requiredOption("-d, --dataset <path>", "Path to dataset file or directory")
	.option("-v, --variant <variant>", "Dataset variant (s, m, oracle)", "s")
	.option("-o, --output <path>", "Output file for results (JSONL)")
	.option("-l, --limit <n>", "Limit number of instances", Number.parseInt)
	.option("-k, --top-k <n>", "Number of documents to retrieve", Number.parseInt, 10)
	.option("--retriever <method>", "Retrieval method (dense, bm25, hybrid)", "dense")
	.option("--chain-of-note", "Enable Chain-of-Note reading", false)
	.option("--time-aware", "Enable time-aware query expansion", false)
	.option("--verbose", "Show detailed progress", false)
	// Provider options
	.option("--embeddings <provider>", "Embedding provider (stub, qdrant, e5, engram)", "stub")
	.option("--llm <provider>", "LLM provider (stub, anthropic, openai, ollama, gemini)", "stub")
	.option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
	.option("--ollama-url <url>", "Ollama server URL", "http://localhost:11434")
	.option("--ollama-model <model>", "Ollama model name")
	.option("--gemini-model <model>", "Gemini model name", "gemini-3-flash")
	// Milestone 2 optimizations
	.option("--key-expansion", "Enable key expansion with fact extraction (+9% recall)", false)
	.option("--temporal-analysis", "Enable improved temporal query analysis (+7-11% on TR)", false)
	// Engram full pipeline options (when --embeddings engram)
	.option("--rerank", "Enable reranking (requires --embeddings engram)", true)
	.option("--rerank-tier <tier>", "Reranker tier: fast, accurate, code, colbert", "fast")
	.option("--rerank-depth <n>", "Candidates to fetch before reranking", Number.parseInt, 30)
	.option("--hybrid-search", "Enable hybrid search with RRF (requires --embeddings engram)", true)
	// Learned fusion options
	.option("--learned-fusion", "Use learned fusion weights instead of fixed RRF", false)
	.option("--fusion-model <path>", "Path to fusion MLP ONNX model", "models/fusion_mlp.onnx")
	// Multi-query retrieval options
	.option("--multi-query", "Enable multi-query expansion with RRF fusion", false)
	.option(
		"--multi-query-variations <n>",
		"Number of query variations to generate",
		Number.parseInt,
		3,
	)
	// Abstention detection options
	.option("--abstention", "Enable retrieval confidence abstention detection (Layer 1)", false)
	.option(
		"--abstention-threshold <n>",
		"Minimum retrieval score to proceed (0-1)",
		Number.parseFloat,
		0.3,
	)
	.option(
		"--abstention-hedging",
		"Enable hedging pattern detection (Layer 3) - requires --abstention",
		false,
	)
	.option(
		"--abstention-nli",
		"Enable NLI answer grounding check (Layer 2) - requires --abstention",
		false,
	)
	.option(
		"--abstention-nli-threshold <n>",
		"NLI entailment threshold for abstention (0-1)",
		Number.parseFloat,
		0.7,
	)
	// Session-aware retrieval options
	.option("--session-aware", "Enable session-aware hierarchical retrieval", false)
	.option("--top-sessions <n>", "Number of sessions to retrieve in stage 1", Number.parseInt, 5)
	.option("--turns-per-session <n>", "Number of turns per session in stage 2", Number.parseInt, 3)
	// Temporal query parsing options
	.option("--temporal-aware", "Enable temporal query parsing with chrono-node", false)
	.option(
		"--temporal-confidence-threshold <n>",
		"Minimum confidence to apply temporal filter (0-1)",
		Number.parseFloat,
		0.5,
	)
	// Embedding model options
	.option(
		"--embedding-model <model>",
		"Embedding model: e5-small, e5-base, e5-large, gte-base, gte-large, bge-small, bge-base, bge-large",
		"e5-small",
	)
	.action(runCommand);

// Evaluate results command
program
	.command("evaluate")
	.description("Evaluate benchmark results against ground truth")
	.requiredOption("-h, --hypothesis <path>", "Path to hypothesis JSONL file")
	.requiredOption("-g, --ground-truth <path>", "Path to ground truth dataset")
	.option("-o, --output <path>", "Output file for metrics (JSON)")
	.option("--llm-eval", "Use LLM-based evaluation (more accurate)", false)
	.action(evaluateCommand);

// Validate dataset command
program
	.command("validate")
	.description("Validate a benchmark dataset file")
	.argument("<path>", "Path to dataset file")
	.action(validateCommand);

// Train fusion weights command
program
	.command("train-fusion")
	.description("Generate training data for learned fusion weights via grid search")
	.requiredOption("-d, --dataset <path>", "Path to dataset file or directory")
	.requiredOption("-o, --output <path>", "Output file for training data (JSONL)")
	.option("-v, --variant <variant>", "Dataset variant (s, m, oracle)", "s")
	.option("-l, --limit <n>", "Limit number of instances", Number.parseInt)
	.option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
	.option("--verbose", "Show detailed progress", false)
	.option(
		"--dense-steps <values>",
		"Comma-separated dense weight values to try",
		(v) => v.split(",").map(Number),
		DEFAULT_DENSE_STEPS,
	)
	.option(
		"--sparse-steps <values>",
		"Comma-separated sparse weight values to try",
		(v) => v.split(",").map(Number),
		DEFAULT_SPARSE_STEPS,
	)
	.action(trainFusionCommand);

program.parse();

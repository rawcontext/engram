#!/usr/bin/env node
import { Command } from "commander";
import { evaluateCommand } from "./commands/evaluate.js";
import { runCommand } from "./commands/run.js";
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
	.option("--llm <provider>", "LLM provider (stub, anthropic, openai, ollama)", "stub")
	.option("--qdrant-url <url>", "Qdrant server URL", "http://localhost:6333")
	.option("--ollama-url <url>", "Ollama server URL", "http://localhost:11434")
	.option("--ollama-model <model>", "Ollama model name", "llama3.2")
	// Milestone 2 optimizations
	.option("--key-expansion", "Enable key expansion with fact extraction (+9% recall)", false)
	.option("--temporal-analysis", "Enable improved temporal query analysis (+7-11% on TR)", false)
	// Engram full pipeline options (when --embeddings engram)
	.option("--rerank", "Enable reranking (requires --embeddings engram)", true)
	.option("--rerank-tier <tier>", "Reranker tier: fast, accurate, code, colbert", "fast")
	.option("--rerank-depth <n>", "Candidates to fetch before reranking", Number.parseInt, 30)
	.option("--hybrid-search", "Enable hybrid search with RRF (requires --embeddings engram)", true)
	// Multi-query retrieval options
	.option("--multi-query", "Enable multi-query expansion with RRF fusion", false)
	.option(
		"--multi-query-variations <n>",
		"Number of query variations to generate",
		Number.parseInt,
		3,
	)
	// Abstention detection options
	.option("--abstention", "Enable retrieval confidence abstention detection", false)
	.option(
		"--abstention-threshold <n>",
		"Minimum retrieval score to proceed (0-1)",
		Number.parseFloat,
		0.3,
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

program.parse();

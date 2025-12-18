#!/usr/bin/env node
import { Command } from "commander";
import { runCommand } from "./commands/run.js";
import { evaluateCommand } from "./commands/evaluate.js";
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

#!/usr/bin/env tsx
/**
 * Engram Tuner CLI
 *
 * Commands for hyperparameter optimization workflows
 */

import { Command } from "commander";
import { bestCommand } from "./commands/best.js";
import { listCommand } from "./commands/list.js";
import { optimizeCommand } from "./commands/optimize.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
	.name("engram-tuner")
	.description("Hyperparameter optimization for Engram search")
	.version("0.1.0");

program
	.command("optimize")
	.description("Start a new optimization study or continue an existing one")
	.requiredOption("-d, --dataset <path>", "Path to evaluation dataset")
	.option("-n, --name <name>", "Study name", "engram-study")
	.option("-t, --trials <n>", "Number of trials to run", parseInt, 100)
	.option("--objective <type>", "Objective: quality | latency | balanced | pareto", "balanced")
	.option("--sampler <type>", "Sampler: tpe | gp | random | nsgaii | qmc", "tpe")
	.option("--pruner <type>", "Pruner: hyperband | median | none", "hyperband")
	.option("--preset <name>", "Search space preset: quick | standard | full", "standard")
	.option("--service-url <url>", "Tuner service URL", "http://localhost:8000/api/v1")
	.option("--continue", "Continue existing study instead of creating new", false)
	// Benchmark options
	.option("-l, --limit <n>", "Limit number of evaluation instances", parseInt)
	.option("--llm <provider>", "LLM provider: stub | anthropic | openai | ollama", "stub")
	.option("--qdrant-url <url>", "Qdrant URL", "http://localhost:6333")
	// Cache options
	.option("--cache", "Enable evaluation caching", true)
	.option("--no-cache", "Disable evaluation caching")
	.option("--cache-dir <dir>", "Cache directory", ".tuner-cache")
	.action(optimizeCommand);

program
	.command("status")
	.description("Check optimization study status")
	.argument("<study>", "Study name")
	.option("--service-url <url>", "Tuner service URL", "http://localhost:8000/api/v1")
	.option("--format <type>", "Output format: table | json", "table")
	.action(statusCommand);

program
	.command("best")
	.description("Get best parameters from a study")
	.argument("<study>", "Study name")
	.option("--service-url <url>", "Tuner service URL", "http://localhost:8000/api/v1")
	.option("--export <path>", "Export to .env file")
	.option("--format <type>", "Output format: table | json | env", "table")
	.action(bestCommand);

program
	.command("list")
	.description("List all studies")
	.option("--service-url <url>", "Tuner service URL", "http://localhost:8000/api/v1")
	.option("--format <type>", "Output format: table | json", "table")
	.action(listCommand);

program.parse();

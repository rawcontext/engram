#!/usr/bin/env bun

/**
 * Code Generation CLI
 *
 * Standalone CLI for manually triggering code generation from the schema.
 * Useful during development, CI/CD pipelines, and when the build plugin
 * isn't being used.
 *
 * @example
 * ```bash
 * # Basic usage
 * bun run packages/graph/src/codegen/cli.ts
 *
 * # With options
 * bun run packages/graph/src/codegen/cli.ts --dry-run
 * bun run packages/graph/src/codegen/cli.ts --output ./custom-output
 *
 * # Via package.json script
 * bun run generate
 * ```
 */

import { parseArgs } from "node:util";
import type { Schema } from "../schema/schema";
import type { EdgeDefinition } from "../schema/edge";
import type { NodeDefinition } from "../schema/node";
import type { Tool, ToolCollection } from "../schema/mcp";
import { generate, type GenerateOptions } from "./generator";

// =============================================================================
// CLI Configuration
// =============================================================================

const HELP_TEXT = `
Engram Schema Code Generator

Usage:
  bun run cli.ts [options]

Options:
  --dry-run         Preview generated files without writing
  --output <dir>    Output directory (default: src/generated)
  --schema <path>   Path to schema file (default: ../schema/engram-schema.ts)
  --tools <path>    Path to MCP tools file (optional)
  --no-types        Skip types generation
  --no-validators   Skip validators generation
  --no-repositories Skip repositories generation
  --no-query-builders Skip query builders generation
  --no-mcp          Skip MCP tools generation
  --quiet           Suppress output
  -h, --help        Show this help message
  -v, --version     Show version

Examples:
  # Generate all code with defaults
  bun run cli.ts

  # Preview what would be generated
  bun run cli.ts --dry-run

  # Custom output directory
  bun run cli.ts --output ./src/generated

  # Minimal generation (types only)
  bun run cli.ts --no-validators --no-repositories --no-query-builders
`;

const VERSION = "1.0.0";

// =============================================================================
// Types
// =============================================================================

interface CliOptions {
	dryRun: boolean;
	output: string;
	schemaPath: string | undefined;
	toolsPath: string | undefined;
	generateTypes: boolean;
	generateValidators: boolean;
	generateRepositories: boolean;
	generateQueryBuilders: boolean;
	generateMcp: boolean;
	quiet: boolean;
	help: boolean;
	version: boolean;
}

// =============================================================================
// Argument Parsing
// =============================================================================

function parseCliArgs(): CliOptions {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			"dry-run": { type: "boolean", default: false },
			output: { type: "string", default: "src/generated" },
			schema: { type: "string" },
			tools: { type: "string" },
			"no-types": { type: "boolean", default: false },
			"no-validators": { type: "boolean", default: false },
			"no-repositories": { type: "boolean", default: false },
			"no-query-builders": { type: "boolean", default: false },
			"no-mcp": { type: "boolean", default: false },
			quiet: { type: "boolean", short: "q", default: false },
			help: { type: "boolean", short: "h", default: false },
			version: { type: "boolean", short: "v", default: false },
		},
		allowPositionals: false,
	});

	return {
		dryRun: values["dry-run"] ?? false,
		output: values.output ?? "src/generated",
		schemaPath: values.schema,
		toolsPath: values.tools,
		generateTypes: !(values["no-types"] ?? false),
		generateValidators: !(values["no-validators"] ?? false),
		generateRepositories: !(values["no-repositories"] ?? false),
		generateQueryBuilders: !(values["no-query-builders"] ?? false),
		generateMcp: !(values["no-mcp"] ?? false),
		quiet: values.quiet ?? false,
		help: values.help ?? false,
		version: values.version ?? false,
	};
}

// =============================================================================
// Schema Loading
// =============================================================================

async function loadSchema(
	schemaPath: string | undefined,
): Promise<Schema<Record<string, NodeDefinition<any, any>>, Record<string, EdgeDefinition<any>>>> {
	// Default to looking for schema in standard locations
	const possiblePaths = schemaPath
		? [schemaPath]
		: [
				"./src/schema/engram-schema.ts",
				"./src/schema/index.ts",
				"../schema/engram-schema.ts",
				"../schema/index.ts",
			];

	for (const path of possiblePaths) {
		try {
			const module = await import(path);
			// Look for common export names
			const schema = module.engramSchema ?? module.schema ?? module.default;
			if (schema && typeof schema === "object" && "nodes" in schema && "edges" in schema) {
				return schema;
			}
		} catch {
			// Continue to next path
		}
	}

	throw new Error(
		`Could not find schema. Tried: ${possiblePaths.join(", ")}\n` +
			"Please specify the schema path with --schema or export 'engramSchema' from the file.",
	);
}

async function loadTools(
	toolsPath: string | undefined,
): Promise<ToolCollection<Record<string, Tool>> | undefined> {
	if (!toolsPath) {
		return undefined;
	}

	try {
		const module = await import(toolsPath);
		const tools = module.tools ?? module.mcpTools ?? module.default;
		if (tools && typeof tools === "object") {
			return tools;
		}
	} catch (error) {
		console.error(`Failed to load tools from ${toolsPath}:`, error);
	}

	return undefined;
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	return `${(ms / 1000).toFixed(2)}s`;
}

function printBanner(): void {
	console.log("\n🔧 Engram Schema Code Generator\n");
}

function printSummary(
	result: Awaited<ReturnType<typeof generate>>,
	duration: number,
	dryRun: boolean,
): void {
	const { summary, files } = result;

	console.log(dryRun ? "📋 Dry run complete!" : "✨ Code generation complete!");
	console.log("");
	console.log(`   Duration:        ${formatDuration(duration)}`);
	console.log(`   Files:           ${summary.totalFiles}`);
	console.log(`   Node types:      ${summary.nodeTypes}`);
	console.log(`   Edge types:      ${summary.edgeTypes}`);
	console.log(`   Query builders:  ${summary.queryBuilders}`);
	console.log(`   Repositories:    ${summary.repositories}`);
	if (summary.mcpTools > 0) {
		console.log(`   MCP tools:       ${summary.mcpTools}`);
	}
	console.log("");

	if (dryRun) {
		console.log("   Would generate:");
		for (const file of files) {
			console.log(`     - ${file.path}`);
		}
		console.log("");
	}
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	const options = parseCliArgs();

	// Handle help/version
	if (options.help) {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	if (options.version) {
		console.log(`engram-codegen v${VERSION}`);
		process.exit(0);
	}

	if (!options.quiet) {
		printBanner();
	}

	// Load schema
	if (!options.quiet) {
		console.log("Loading schema...");
	}

	const schema = await loadSchema(options.schemaPath);

	// Load tools if specified
	const tools = await loadTools(options.toolsPath);

	if (!options.quiet) {
		console.log(`Found ${Object.keys(schema.nodes).length} node types`);
		console.log(`Found ${Object.keys(schema.edges).length} edge types`);
		if (tools) {
			console.log(`Found ${Object.keys(tools).length} MCP tools`);
		}
		console.log("");
	}

	// Run generation
	const startTime = Date.now();

	const generateOptions: GenerateOptions = {
		schema,
		tools: options.generateMcp ? tools : undefined,
		outputDir: options.output,
		dryRun: options.dryRun,
	};

	const result = await generate(generateOptions);
	const duration = Date.now() - startTime;

	// Print results
	if (!options.quiet) {
		printSummary(result, duration, options.dryRun);
	}

	// Exit with success
	process.exit(0);
}

// Run CLI
main().catch((error) => {
	console.error("\n❌ Code generation failed:\n");
	console.error(error instanceof Error ? error.message : String(error));
	console.error("");
	process.exit(1);
});

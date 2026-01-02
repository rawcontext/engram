/**
 * Main Code Generation Entry Point
 *
 * Orchestrates all code generation from the schema. Coordinates the types,
 * query builders, repositories, validators, and MCP generators to produce
 * a complete set of generated files.
 *
 * @example
 * ```typescript
 * import { generate } from '@engram/graph/codegen';
 * import { engramSchema } from '@engram/graph/schema';
 *
 * const result = await generate({
 *   schema: engramSchema,
 *   outputDir: 'src/generated',
 * });
 *
 * console.log(`Generated ${result.files.length} files`);
 * ```
 */

import type { EdgeDefinition } from "../schema/edge";
import type { Tool, ToolCollection } from "../schema/mcp";
import type { NodeDefinition } from "../schema/node";
import type { Schema } from "../schema/schema";
import type { Field } from "../schema/types";
import { generateMcpTools, type McpGeneratorConfig } from "./mcp-generator";
import { generateQueryBuilders, type QueryBuilderGeneratorConfig } from "./query-builder-generator";
import { generateRepositories, type RepositoryGeneratorConfig } from "./repository-generator";
import { generateTypes, type TypeGeneratorOptions } from "./types-generator";
import {
	generateValidators,
	type GeneratorConfig as ValidatorGeneratorConfig,
} from "./validators-generator";

// =============================================================================
// Types
// =============================================================================

/**
 * A generated file with path and content.
 */
export interface GeneratedFile {
	/**
	 * Relative path from output directory.
	 */
	path: string;

	/**
	 * Generated TypeScript source code.
	 */
	content: string;
}

/**
 * Summary of what was generated.
 */
export interface GenerationSummary {
	/**
	 * Number of node types generated.
	 */
	nodeTypes: number;

	/**
	 * Number of edge types generated.
	 */
	edgeTypes: number;

	/**
	 * Number of query builders generated.
	 */
	queryBuilders: number;

	/**
	 * Number of repositories generated.
	 */
	repositories: number;

	/**
	 * Number of MCP tools generated (if tools provided).
	 */
	mcpTools: number;

	/**
	 * Total files generated.
	 */
	totalFiles: number;
}

/**
 * Options for code generation.
 */
export interface GenerateOptions {
	/**
	 * The schema to generate code from.
	 */
	schema: Schema<Record<string, NodeDefinition<any, any>>, Record<string, EdgeDefinition<any>>>;

	/**
	 * Optional MCP tool collection to generate.
	 */
	tools?: ToolCollection<Record<string, Tool>>;

	/**
	 * Output directory for generated files.
	 * @default 'src/generated'
	 */
	outputDir?: string;

	/**
	 * Whether to skip file writing (for testing).
	 * @default false
	 */
	dryRun?: boolean;

	/**
	 * Options for the types generator.
	 */
	typesOptions?: Partial<TypeGeneratorOptions>;

	/**
	 * Options for the query builder generator.
	 */
	queryBuilderOptions?: Partial<QueryBuilderGeneratorConfig>;

	/**
	 * Options for the repository generator.
	 */
	repositoryOptions?: Partial<RepositoryGeneratorConfig>;

	/**
	 * Options for the validator generator.
	 */
	validatorOptions?: Partial<ValidatorGeneratorConfig>;

	/**
	 * Options for the MCP generator.
	 */
	mcpOptions?: Partial<McpGeneratorConfig>;
}

/**
 * Result of code generation.
 */
export interface GeneratedCode {
	/**
	 * All generated files with their content.
	 */
	files: GeneratedFile[];

	/**
	 * Summary of what was generated.
	 */
	summary: GenerationSummary;
}

// =============================================================================
// Barrel Export Generation
// =============================================================================

/**
 * Generate a barrel export file that re-exports all generated modules.
 */
function generateBarrelExport(
	hasTypes: boolean,
	hasQueryBuilders: boolean,
	hasRepositories: boolean,
	hasValidators: boolean,
	hasMcpTools: boolean,
): string {
	const lines: string[] = [];
	const timestamp = new Date().toISOString();

	lines.push("// AUTO-GENERATED FILE - DO NOT EDIT");
	lines.push(`// Generated at ${timestamp}`);
	lines.push("// Run 'bun run codegen' to regenerate");
	lines.push("");

	if (hasTypes) {
		lines.push('export * from "./types";');
	}
	if (hasQueryBuilders) {
		lines.push('export * from "./query-builders";');
	}
	if (hasRepositories) {
		lines.push('export * from "./repositories";');
	}
	if (hasValidators) {
		lines.push('export * from "./validators";');
	}
	if (hasMcpTools) {
		lines.push('export * from "./mcp-tools";');
	}

	lines.push("");

	return lines.join("\n");
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate all code from a schema definition.
 *
 * This is the main entry point for code generation. It coordinates all
 * individual generators to produce a complete set of TypeScript files.
 *
 * @param options - Generation options including schema and output configuration
 * @returns Generated files and summary
 *
 * @example
 * ```typescript
 * import { generate } from '@engram/graph/codegen';
 * import { engramSchema } from '@engram/graph/schema';
 *
 * // Generate with dry run (no file writes)
 * const result = await generate({
 *   schema: engramSchema,
 *   dryRun: true,
 * });
 *
 * console.log(result.summary);
 * // { nodeTypes: 5, edgeTypes: 3, queryBuilders: 5, repositories: 5, mcpTools: 0, totalFiles: 5 }
 *
 * // Generate and write files
 * await generate({
 *   schema: engramSchema,
 *   outputDir: 'src/generated',
 * });
 * ```
 */
export async function generate(options: GenerateOptions): Promise<GeneratedCode> {
	const {
		schema,
		tools,
		outputDir = "src/generated",
		dryRun = false,
		typesOptions = {},
		queryBuilderOptions = {},
		repositoryOptions = {},
		validatorOptions = {},
		mcpOptions = {},
	} = options;

	const files: GeneratedFile[] = [];
	const nodeCount = Object.keys(schema.nodes).length;
	const edgeCount = Object.keys(schema.edges).length;
	const toolCount = tools ? Object.keys(tools).length : 0;

	// Generate types
	const typesContent = generateTypes(schema, typesOptions);
	files.push({ path: "types.ts", content: typesContent });

	// Generate query builders
	const queryBuildersContent = generateQueryBuilders(schema, queryBuilderOptions);
	files.push({ path: "query-builders.ts", content: queryBuildersContent });

	// Generate repositories
	const repositoriesContent = generateRepositories(schema, repositoryOptions);
	files.push({ path: "repositories.ts", content: repositoriesContent });

	// Generate validators
	const validatorsContent = generateValidators(schema, validatorOptions);
	files.push({ path: "validators.ts", content: validatorsContent });

	// Generate MCP tools if provided
	if (tools) {
		const mcpContent = generateMcpTools(tools, mcpOptions);
		files.push({ path: "mcp-tools.ts", content: mcpContent });
	}

	// Generate barrel export
	const barrelContent = generateBarrelExport(true, true, true, true, !!tools);
	files.push({ path: "index.ts", content: barrelContent });

	// Write files if not dry run
	if (!dryRun) {
		for (const file of files) {
			const fullPath = `${outputDir}/${file.path}`;
			await Bun.write(fullPath, file.content);
		}
	}

	return {
		files,
		summary: {
			nodeTypes: nodeCount,
			edgeTypes: edgeCount,
			queryBuilders: nodeCount,
			repositories: nodeCount,
			mcpTools: toolCount,
			totalFiles: files.length,
		},
	};
}

/**
 * Generate code from a schema and return only the summary.
 * Useful for quick validation without needing the full output.
 */
export async function generateSummary(
	options: Omit<GenerateOptions, "dryRun">,
): Promise<GenerationSummary> {
	const result = await generate({ ...options, dryRun: true });
	return result.summary;
}

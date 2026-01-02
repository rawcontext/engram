/**
 * Bun Build Plugin for Engram Schema Code Generation
 *
 * This plugin integrates schema-driven code generation into the Bun build process.
 * It generates TypeScript code from the schema on build start and optionally
 * validates raw Cypher queries in source files during module loading.
 *
 * @example
 * ```typescript
 * import { engramSchemaPlugin } from '@engram/graph/codegen';
 * import { engramSchema } from './schema';
 *
 * await Bun.build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [engramSchemaPlugin({ schema: engramSchema })],
 * });
 * ```
 */

import type { BunPlugin } from "bun";
import type { EdgeDefinition } from "../schema/edge";
import type { NodeDefinition } from "../schema/node";
import type { Schema } from "../schema/schema";
import { type GenerateOptions, generate } from "./generator";

// =============================================================================
// Types
// =============================================================================

/**
 * Options for the Engram schema plugin.
 */
export interface EngramPluginOptions {
	/**
	 * The schema to generate code from.
	 */
	schema: Schema<Record<string, NodeDefinition<any, any>>, Record<string, EdgeDefinition<any>>>;

	/**
	 * Output directory for generated files.
	 * @default 'src/generated'
	 */
	outputDir?: string;

	/**
	 * Whether to validate Cypher queries in source files.
	 * @default true
	 */
	validateQueries?: boolean;

	/**
	 * File pattern to check for Cypher queries.
	 * @default /\.tsx?$/
	 */
	queryFilePattern?: RegExp;

	/**
	 * Whether to log generation progress.
	 * @default true
	 */
	verbose?: boolean;

	/**
	 * Additional options passed to the generator.
	 */
	generatorOptions?: Omit<GenerateOptions, "schema" | "outputDir" | "dryRun">;
}

/**
 * Result of Cypher query validation.
 */
interface ValidationError {
	message: string;
	line: number;
	column: number;
	query: string;
}

// =============================================================================
// Cypher Query Validation
// =============================================================================

/**
 * Pattern to match Cypher queries in source files.
 * Matches:
 * - falkor.query(`...`)
 * - falkor.query("...")
 * - client.query(`...`)
 * - graph.query(`...`)
 */
const CYPHER_QUERY_PATTERN = /(?:falkor|client|graph)\.query\(\s*[`"']([^`"']+)[`"']/g;

/**
 * Pattern to extract node labels from Cypher.
 * Matches: (n:Label), (:Label), (node:Label:OtherLabel)
 */
const NODE_LABEL_PATTERN = /\(\s*\w*\s*:(\w+)(?:\s*:\w+)*\s*\)/g;

/**
 * Pattern to extract relationship types from Cypher.
 * Matches: -[:TYPE]-, -[r:TYPE]-, -[:TYPE*]->
 */
const RELATIONSHIP_PATTERN = /-\[\s*\w*\s*:(\w+)(?:\s*\*\s*\d*\.?\.\d*)?\s*\]-/g;

/**
 * Pattern to extract property accesses from Cypher.
 * Matches: n.propertyName, node.property
 */
const _PROPERTY_PATTERN = /(\w+)\.(\w+)/g;

/**
 * Validate a Cypher query against the schema.
 */
function validateCypherQuery(
	query: string,
	schema: Schema<Record<string, NodeDefinition<any, any>>, Record<string, EdgeDefinition<any>>>,
): string[] {
	const errors: string[] = [];
	const nodeNames = new Set(Object.keys(schema.nodes));
	const edgeNames = new Set(Object.keys(schema.edges));

	// Check node labels
	let match: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: Standard regex iteration pattern
	while ((match = NODE_LABEL_PATTERN.exec(query)) !== null) {
		const label = match[1];
		if (!nodeNames.has(label)) {
			const suggestions = findSimilar(label, nodeNames);
			const suggestionText =
				suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
			errors.push(`Unknown node label '${label}'.${suggestionText}`);
		}
	}

	// Reset regex state
	NODE_LABEL_PATTERN.lastIndex = 0;

	// Check relationship types
	// biome-ignore lint/suspicious/noAssignInExpressions: Standard regex iteration pattern
	while ((match = RELATIONSHIP_PATTERN.exec(query)) !== null) {
		const relType = match[1];
		if (!edgeNames.has(relType)) {
			const suggestions = findSimilar(relType, edgeNames);
			const suggestionText =
				suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
			errors.push(`Unknown relationship type '${relType}'.${suggestionText}`);
		}
	}

	// Reset regex state
	RELATIONSHIP_PATTERN.lastIndex = 0;

	return errors;
}

/**
 * Find similar strings using Levenshtein distance.
 */
function findSimilar(target: string, candidates: Set<string>, maxDistance = 2): string[] {
	const similar: string[] = [];
	const targetLower = target.toLowerCase();

	for (const candidate of candidates) {
		const candidateLower = candidate.toLowerCase();
		const distance = levenshteinDistance(targetLower, candidateLower);
		if (distance <= maxDistance && distance > 0) {
			similar.push(candidate);
		}
	}

	return similar.slice(0, 3); // Return at most 3 suggestions
}

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
	const matrix: number[][] = [];

	for (let i = 0; i <= a.length; i++) {
		matrix[i] = [i];
	}

	for (let j = 0; j <= b.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1, // deletion
				matrix[i][j - 1] + 1, // insertion
				matrix[i - 1][j - 1] + cost, // substitution
			);
		}
	}

	return matrix[a.length][b.length];
}

/**
 * Find all Cypher queries in a source file and validate them.
 */
function validateFileQueries(
	contents: string,
	_filePath: string,
	schema: Schema<Record<string, NodeDefinition<any, any>>, Record<string, EdgeDefinition<any>>>,
): ValidationError[] {
	const errors: ValidationError[] = [];
	let match: RegExpExecArray | null;

	// Reset pattern state
	CYPHER_QUERY_PATTERN.lastIndex = 0;

	// biome-ignore lint/suspicious/noAssignInExpressions: Standard regex iteration pattern
	while ((match = CYPHER_QUERY_PATTERN.exec(contents)) !== null) {
		const query = match[1];
		const queryErrors = validateCypherQuery(query, schema);

		if (queryErrors.length > 0) {
			// Calculate line and column
			const beforeMatch = contents.substring(0, match.index);
			const lines = beforeMatch.split("\n");
			const line = lines.length;
			const column = (lines[lines.length - 1]?.length ?? 0) + 1;

			for (const error of queryErrors) {
				errors.push({
					message: error,
					line,
					column,
					query: query.length > 50 ? `${query.substring(0, 50)}...` : query,
				});
			}
		}
	}

	return errors;
}

/**
 * Format validation errors as a readable error message.
 */
function formatValidationErrors(errors: ValidationError[], filePath: string): string {
	const lines = [`Cypher validation errors in ${filePath}:`, ""];

	for (const error of errors) {
		lines.push(`  ${filePath}:${error.line}:${error.column}`);
		lines.push(`    ${error.message}`);
		lines.push(`    Query: ${error.query}`);
		lines.push("");
	}

	return lines.join("\n");
}

// =============================================================================
// Plugin Factory
// =============================================================================

/**
 * Create an Engram schema plugin for Bun.build().
 *
 * This plugin:
 * 1. Generates TypeScript code from the schema on build start
 * 2. Optionally validates Cypher queries in source files during loading
 *
 * @param options - Plugin configuration options
 * @returns A Bun plugin
 *
 * @example
 * ```typescript
 * import { engramSchemaPlugin } from '@engram/graph/codegen';
 * import { engramSchema } from './schema';
 *
 * // Basic usage
 * await Bun.build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [engramSchemaPlugin({ schema: engramSchema })],
 * });
 *
 * // With custom options
 * await Bun.build({
 *   entrypoints: ['./src/index.ts'],
 *   plugins: [
 *     engramSchemaPlugin({
 *       schema: engramSchema,
 *       outputDir: 'src/generated',
 *       validateQueries: true,
 *       verbose: true,
 *     }),
 *   ],
 * });
 * ```
 */
export function engramSchemaPlugin(options: EngramPluginOptions): BunPlugin {
	const {
		schema,
		outputDir = "src/generated",
		validateQueries = true,
		queryFilePattern = /\.tsx?$/,
		verbose = true,
		generatorOptions = {},
	} = options;

	return {
		name: "engram-schema",

		setup(build) {
			// Generate code on build start
			build.onStart(async () => {
				if (verbose) {
					console.log("[engram-schema] Generating code from schema...");
				}

				const startTime = Date.now();

				try {
					const result = await generate({
						schema,
						outputDir,
						dryRun: false,
						...generatorOptions,
					});

					if (verbose) {
						const duration = Date.now() - startTime;
						console.log(
							`[engram-schema] Generated ${result.summary.totalFiles} files in ${duration}ms`,
						);
						console.log(`[engram-schema]   - ${result.summary.nodeTypes} node types`);
						console.log(`[engram-schema]   - ${result.summary.edgeTypes} edge types`);
						console.log(`[engram-schema]   - ${result.summary.queryBuilders} query builders`);
						console.log(`[engram-schema]   - ${result.summary.repositories} repositories`);
						if (result.summary.mcpTools > 0) {
							console.log(`[engram-schema]   - ${result.summary.mcpTools} MCP tools`);
						}
					}
				} catch (error) {
					console.error("[engram-schema] Code generation failed:", error);
					throw error;
				}
			});

			// Validate Cypher queries in source files
			if (validateQueries) {
				build.onLoad({ filter: queryFilePattern }, async (args) => {
					const contents = await Bun.file(args.path).text();

					// Skip if no queries found
					if (!contents.includes(".query(")) {
						return { contents, loader: "ts" };
					}

					const errors = validateFileQueries(contents, args.path, schema);

					if (errors.length > 0) {
						throw new Error(formatValidationErrors(errors, args.path));
					}

					return { contents, loader: "ts" };
				});
			}
		},
	};
}

/**
 * Create a standalone code generator function.
 * Use this when you need to run code generation outside of a build context.
 *
 * @param options - Generator options
 * @returns Promise that resolves when generation is complete
 *
 * @example
 * ```typescript
 * import { runCodegen } from '@engram/graph/codegen';
 * import { engramSchema } from './schema';
 *
 * await runCodegen({
 *   schema: engramSchema,
 *   outputDir: 'src/generated',
 * });
 * ```
 */
export async function runCodegen(
	options: Omit<EngramPluginOptions, "validateQueries" | "queryFilePattern" | "verbose"> & {
		verbose?: boolean;
	},
): Promise<void> {
	const { schema, outputDir = "src/generated", verbose = true, generatorOptions = {} } = options;

	if (verbose) {
		console.log("[engram-codegen] Generating code from schema...");
	}

	const startTime = Date.now();

	const result = await generate({
		schema,
		outputDir,
		dryRun: false,
		...generatorOptions,
	});

	if (verbose) {
		const duration = Date.now() - startTime;
		console.log(`[engram-codegen] Generated ${result.summary.totalFiles} files in ${duration}ms`);
	}
}

// =============================================================================
// Exports
// =============================================================================

export { validateCypherQuery, validateFileQueries, findSimilar, levenshteinDistance };

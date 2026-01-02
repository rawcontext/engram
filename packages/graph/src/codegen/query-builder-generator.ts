/**
 * Query Builder Generator for Schema DSL
 *
 * Generates typed query builder classes for each node type defined in the schema.
 * The generated builders extend BaseQueryBuilder and provide node-specific
 * convenience methods for filtering, traversal, and query execution.
 *
 * Inspired by:
 * - Drizzle ORM's select query builder pattern
 * - Kysely's typed query builder
 *
 * @example
 * ```typescript
 * import { generateQueryBuilders } from './query-builder-generator';
 * import { engramSchema } from '../schema';
 *
 * const code = generateQueryBuilders(engramSchema);
 * await Bun.write('src/generated/query-builders.ts', code);
 * ```
 *
 * @example Generated usage
 * ```typescript
 * // Generated builders provide typed convenience methods
 * const sessions = await Session.where({ agent_type: 'claude-code' })
 *   .whereCurrent()
 *   .limit(10)
 *   .execute();
 *
 * // Static factory methods for common queries
 * const memory = await Memory.findById('mem-123');
 * const historicalMemory = await Memory.asOf('mem-123', 1640000000000);
 *
 * // Field-specific filter methods
 * const decisions = await new MemoryQueryBuilder(client)
 *   .whereType('decision')
 *   .whereTags('architecture')
 *   .execute();
 * ```
 */

import type { EdgeDefinition } from "../schema/edge";
import type { NodeDefinition } from "../schema/node";
import type { Schema } from "../schema/schema";
import type { Field, FieldKind } from "../schema/types";

// =============================================================================
// Generator Configuration
// =============================================================================

/**
 * Configuration options for query builder generation.
 */
export interface QueryBuilderGeneratorConfig {
	/**
	 * Whether to include JSDoc comments in generated code.
	 * @default true
	 */
	includeComments?: boolean;

	/**
	 * Whether to generate static factory methods (findById, asOf, where).
	 * @default true
	 */
	generateFactoryMethods?: boolean;

	/**
	 * Whether to generate traversal method stubs for edges.
	 * @default true
	 */
	generateTraversalMethods?: boolean;

	/**
	 * Whether to generate field-specific filter methods (whereType, whereTags, etc.).
	 * @default true
	 */
	generateFieldFilters?: boolean;

	/**
	 * Header comment for the generated file.
	 * Set to false to disable header.
	 * @default true (generates standard AUTO-GENERATED header)
	 */
	includeHeader?: boolean | string;
}

const DEFAULT_CONFIG: Required<QueryBuilderGeneratorConfig> = {
	includeComments: true,
	generateFactoryMethods: true,
	generateTraversalMethods: true,
	generateFieldFilters: true,
	includeHeader: true,
};

// =============================================================================
// Type Mapping Utilities
// =============================================================================

/**
 * Get TypeScript type string for a field kind.
 */
function fieldKindToTsType(kind: FieldKind): string {
	switch (kind) {
		case "string":
			return "string";
		case "int":
		case "float":
		case "timestamp":
			return "number";
		case "boolean":
			return "boolean";
		case "array":
			return "unknown[]";
		case "enum":
			return "string";
		case "vector":
			return "number[]";
		default:
			return "unknown";
	}
}

/**
 * Get the full TypeScript type for a field.
 */
function getFieldTsType(field: Field): string {
	const kind = field.kind;
	const config = field.config;

	switch (kind) {
		case "string":
			return "string";

		case "int":
		case "float":
		case "timestamp":
			return "number";

		case "boolean":
			return "boolean";

		case "vector":
			return "number[]";

		case "array": {
			const arrayConfig = config as { inner?: Field };
			if (arrayConfig.inner) {
				const innerType = getFieldTsType(arrayConfig.inner);
				return `${innerType}[]`;
			}
			return "unknown[]";
		}

		case "enum": {
			const enumConfig = config as { values?: readonly string[] };
			if (enumConfig.values && enumConfig.values.length > 0) {
				return enumConfig.values.map((v) => `"${v}"`).join(" | ");
			}
			return "string";
		}

		default:
			return "unknown";
	}
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert snake_case to camelCase.
 */
function snakeToCamel(str: string): string {
	return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

// =============================================================================
// Code Generation Utilities
// =============================================================================

/**
 * Generate the standard auto-generated header.
 */
function generateHeader(): string {
	const timestamp = new Date().toISOString();
	return `// AUTO-GENERATED - DO NOT EDIT
// Generated from schema at ${timestamp}
// Run 'bun run codegen' to regenerate

`;
}

/**
 * Generate import statements for the query builders file.
 */
function generateImports(nodeNames: string[]): string {
	const lines: string[] = [];

	lines.push(`import { BaseQueryBuilder } from "../runtime/base-query-builder";`);
	lines.push(`import type { QueryClient } from "../runtime/types";`);

	// Import generated types
	if (nodeNames.length > 0) {
		lines.push(`import type {`);
		for (const name of nodeNames) {
			lines.push(`\t${name},`);
		}
		lines.push(`} from "./types";`);
	}

	lines.push("");
	return lines.join("\n");
}

// =============================================================================
// Field Filter Method Generation
// =============================================================================

/**
 * Determine if a field should get a dedicated filter method.
 */
function shouldGenerateFieldFilter(fieldName: string, field: Field): boolean {
	// Skip common fields that are handled by base class or not useful for filtering
	const skipFields = [
		"id",
		"embedding",
		"blob_ref",
		"content_hash",
		"vt_start",
		"vt_end",
		"tt_start",
		"tt_end",
	];
	if (skipFields.includes(fieldName)) {
		return false;
	}

	// Generate filter for enums, arrays, and commonly filtered fields
	const kind = field.kind;
	return kind === "enum" || kind === "array" || kind === "string" || kind === "boolean";
}

/**
 * Generate a field-specific filter method.
 */
function generateFieldFilterMethod(
	fieldName: string,
	field: Field,
	config: Required<QueryBuilderGeneratorConfig>,
): string {
	const lines: string[] = [];
	const kind = field.kind;
	const methodName = `where${capitalize(snakeToCamel(fieldName))}`;

	switch (kind) {
		case "enum": {
			const enumConfig = field.config as { values?: readonly string[] };
			const enumType = enumConfig.values?.map((v) => `"${v}"`).join(" | ") ?? "string";

			if (config.includeComments) {
				lines.push(`\t/**`);
				lines.push(`\t * Filter by ${fieldName} value.`);
				lines.push(`\t */`);
			}
			lines.push(`\t${methodName}(value: ${enumType}): this {`);
			lines.push(`\t\treturn this.addCondition("${fieldName}", "=", value);`);
			lines.push(`\t}`);
			break;
		}

		case "array": {
			// For arrays, generate a "has" method that checks if array contains value
			const hasMethodName = `has${capitalize(snakeToCamel(fieldName.replace(/s$/, "")))}`;
			const arrayConfig = field.config as { inner?: Field };
			const innerType = arrayConfig.inner ? getFieldTsType(arrayConfig.inner) : "unknown";

			if (config.includeComments) {
				lines.push(`\t/**`);
				lines.push(`\t * Filter by ${fieldName} containing a value.`);
				lines.push(`\t */`);
			}
			// Use raw condition for array contains check
			lines.push(`\t${hasMethodName}(value: ${innerType}): this {`);
			lines.push(`\t\tconst param = this.nextParamName();`);
			lines.push(`\t\tthis.params[param] = value;`);
			lines.push(
				`\t\treturn this.addRawCondition(\`$\{value} IN \${this.nodeAlias}.${fieldName}\`);`,
			);
			lines.push(`\t}`);
			break;
		}

		case "string": {
			if (config.includeComments) {
				lines.push(`\t/**`);
				lines.push(`\t * Filter by ${fieldName} value.`);
				lines.push(`\t */`);
			}
			lines.push(`\t${methodName}(value: string): this {`);
			lines.push(`\t\treturn this.addCondition("${fieldName}", "=", value);`);
			lines.push(`\t}`);
			break;
		}

		case "boolean": {
			if (config.includeComments) {
				lines.push(`\t/**`);
				lines.push(`\t * Filter by ${fieldName} value.`);
				lines.push(`\t */`);
			}
			lines.push(`\t${methodName}(value: boolean): this {`);
			lines.push(`\t\treturn this.addCondition("${fieldName}", "=", value);`);
			lines.push(`\t}`);
			break;
		}
	}

	lines.push("");
	return lines.join("\n");
}

// =============================================================================
// Traversal Method Generation
// =============================================================================

/**
 * Generate traversal method stub for an edge.
 */
function generateTraversalMethod(
	edgeType: string,
	edgeDef: EdgeDefinition<Record<string, Field>>,
	direction: "out" | "in",
	targetNode: string,
	config: Required<QueryBuilderGeneratorConfig>,
): string {
	const lines: string[] = [];
	const methodName = snakeToCamel(edgeType.toLowerCase());

	if (config.includeComments) {
		const arrow = direction === "out" ? "->" : "<-";
		lines.push(`\t/**`);
		lines.push(`\t * Traverse ${edgeType} edge ${arrow} ${targetNode}.`);
		if (edgeDef.getDescription()) {
			lines.push(`\t * ${edgeDef.getDescription()}`);
		}
		lines.push(`\t */`);
	}

	lines.push(`\t${methodName}(): ${targetNode}QueryBuilder {`);
	lines.push(`\t\t// TODO: Implement traversal when TraversalBuilder is available`);
	lines.push(`\t\treturn new ${targetNode}QueryBuilder(this.client);`);
	lines.push(`\t}`);
	lines.push("");

	return lines.join("\n");
}

// =============================================================================
// Query Builder Class Generation
// =============================================================================

/**
 * Generate a complete query builder class for a node type.
 */
function generateQueryBuilderClass(
	nodeName: string,
	nodeDef: NodeDefinition<Record<string, Field>, boolean>,
	schema: Schema<Record<string, NodeDefinition<any, any>>, Record<string, EdgeDefinition<any>>>,
	config: Required<QueryBuilderGeneratorConfig>,
): string {
	const lines: string[] = [];
	const className = `${nodeName}QueryBuilder`;

	// Class JSDoc
	if (config.includeComments) {
		lines.push(`/**`);
		lines.push(` * Query builder for ${nodeName} nodes.`);
		lines.push(` *`);
		lines.push(` * @example`);
		lines.push(` * \`\`\`typescript`);
		lines.push(` * const results = await new ${className}(client)`);
		lines.push(` *   .whereCurrent()`);
		lines.push(` *   .limit(10)`);
		lines.push(` *   .execute();`);
		lines.push(` * \`\`\``);
		lines.push(` */`);
	}

	// Class declaration
	lines.push(`export class ${className} extends BaseQueryBuilder<${nodeName}> {`);

	// Node label property
	lines.push(`\tprotected readonly nodeLabel = "${nodeName}";`);
	lines.push("");

	// Generate field-specific filter methods
	if (config.generateFieldFilters) {
		for (const [fieldName, field] of Object.entries(nodeDef.fields)) {
			if (shouldGenerateFieldFilter(fieldName, field)) {
				lines.push(generateFieldFilterMethod(fieldName, field, config));
			}
		}
	}

	// Generate traversal methods for outgoing edges
	if (config.generateTraversalMethods) {
		const outgoingEdges = schema.getEdgesFrom(nodeName);
		for (const { type, edge } of outgoingEdges) {
			const targetNode = edge.getTo();
			lines.push(generateTraversalMethod(type, edge, "out", targetNode, config));
		}

		// Generate traversal methods for incoming edges (reverse traversal)
		const incomingEdges = schema.getEdgesTo(nodeName);
		for (const { type, edge } of incomingEdges) {
			// Skip self-referential edges (already handled above)
			if (edge.getFrom() === nodeName) continue;

			const sourceNode = edge.getFrom();
			const reverseMethodName = `${snakeToCamel(type.toLowerCase())}From`;
			if (config.includeComments) {
				lines.push(`\t/**`);
				lines.push(`\t * Traverse ${type} edge <- ${sourceNode} (reverse).`);
				lines.push(`\t */`);
			}
			lines.push(`\t${reverseMethodName}(): ${sourceNode}QueryBuilder {`);
			lines.push(`\t\t// TODO: Implement reverse traversal when TraversalBuilder is available`);
			lines.push(`\t\treturn new ${sourceNode}QueryBuilder(this.client);`);
			lines.push(`\t}`);
			lines.push("");
		}
	}

	// Close class
	lines.push(`}`);
	lines.push("");

	return lines.join("\n");
}

// =============================================================================
// Static Factory Object Generation
// =============================================================================

/**
 * Generate static factory object for a node type.
 */
function generateFactoryObject(
	nodeName: string,
	nodeDef: NodeDefinition<Record<string, Field>, boolean>,
	config: Required<QueryBuilderGeneratorConfig>,
): string {
	const lines: string[] = [];
	const className = `${nodeName}QueryBuilder`;

	if (config.includeComments) {
		lines.push(`/**`);
		lines.push(` * Static factory methods for ${nodeName} queries.`);
		lines.push(` *`);
		lines.push(` * @example`);
		lines.push(` * \`\`\`typescript`);
		lines.push(` * // Find by ID`);
		lines.push(` * const node = await ${nodeName}.findById(client, 'id-123');`);
		lines.push(` *`);
		lines.push(` * // Query with conditions`);
		lines.push(` * const nodes = await ${nodeName}.query(client)`);
		lines.push(` *   .whereCurrent()`);
		lines.push(` *   .execute();`);
		lines.push(` *`);
		lines.push(` * // Time-travel query`);
		lines.push(` * const historical = await ${nodeName}.asOf(client, 'id-123', timestamp);`);
		lines.push(` * \`\`\``);
		lines.push(` */`);
	}

	lines.push(`export const ${nodeName} = {`);

	// query() - create a new query builder
	if (config.includeComments) {
		lines.push(`\t/**`);
		lines.push(`\t * Create a new query builder for ${nodeName} nodes.`);
		lines.push(`\t */`);
	}
	lines.push(`\tquery(client: QueryClient): ${className} {`);
	lines.push(`\t\treturn new ${className}(client);`);
	lines.push(`\t},`);
	lines.push("");

	// where() - create query builder with initial conditions
	if (config.includeComments) {
		lines.push(`\t/**`);
		lines.push(`\t * Create a query builder with initial conditions.`);
		lines.push(`\t */`);
	}
	lines.push(`\twhere(client: QueryClient, conditions: Partial<${nodeName}>): ${className} {`);
	lines.push(`\t\treturn new ${className}(client).where(conditions);`);
	lines.push(`\t},`);
	lines.push("");

	// findById() - convenience method for ID lookup
	if (config.includeComments) {
		lines.push(`\t/**`);
		lines.push(`\t * Find a ${nodeName} by ID (current version).`);
		lines.push(`\t */`);
	}
	lines.push(`\tasync findById(client: QueryClient, id: string): Promise<${nodeName} | null> {`);
	lines.push(`\t\treturn new ${className}(client)`);
	lines.push(`\t\t\t.where({ id } as Partial<${nodeName}>)`);
	lines.push(`\t\t\t.whereCurrent()`);
	lines.push(`\t\t\t.first();`);
	lines.push(`\t},`);
	lines.push("");

	// asOf() - time-travel query
	if (nodeDef.config.bitemporal) {
		if (config.includeComments) {
			lines.push(`\t/**`);
			lines.push(`\t * Find a ${nodeName} as it existed at a specific point in time.`);
			lines.push(`\t */`);
		}
		lines.push(`\tasync asOf(`);
		lines.push(`\t\tclient: QueryClient,`);
		lines.push(`\t\tid: string,`);
		lines.push(`\t\ttimestamp: number,`);
		lines.push(`\t): Promise<${nodeName} | null> {`);
		lines.push(`\t\treturn new ${className}(client)`);
		lines.push(`\t\t\t.where({ id } as Partial<${nodeName}>)`);
		lines.push(`\t\t\t.asOf(timestamp)`);
		lines.push(`\t\t\t.first();`);
		lines.push(`\t},`);
		lines.push("");
	}

	lines.push(`} as const;`);
	lines.push("");

	return lines.join("\n");
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate typed query builders from a schema definition.
 *
 * This function generates:
 * - A query builder class for each node type extending BaseQueryBuilder
 * - Field-specific filter methods based on field types
 * - Traversal method stubs for edge relationships
 * - Static factory objects with convenience methods (findById, asOf, where)
 *
 * @param schema - The schema to generate query builders from
 * @param options - Generation options
 * @returns Generated TypeScript code as a string
 *
 * @example
 * ```typescript
 * import { generateQueryBuilders } from '@engram/graph/codegen';
 * import { engramSchema } from '@engram/graph/schema';
 *
 * const code = generateQueryBuilders(engramSchema);
 * await Bun.write('src/generated/query-builders.ts', code);
 * ```
 */
export function generateQueryBuilders<
	TNodes extends Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	TEdges extends Record<string, EdgeDefinition<Record<string, Field>>>,
>(schema: Schema<TNodes, TEdges>, options: QueryBuilderGeneratorConfig = {}): string {
	const resolvedConfig: Required<QueryBuilderGeneratorConfig> = {
		...DEFAULT_CONFIG,
		...options,
	};

	const output: string[] = [];
	const nodeNames = Object.keys(schema.nodes);

	// Header
	if (resolvedConfig.includeHeader === true) {
		output.push(generateHeader());
	} else if (typeof resolvedConfig.includeHeader === "string") {
		output.push(resolvedConfig.includeHeader);
		output.push("\n");
	}

	// Imports
	output.push(generateImports(nodeNames));

	// Section header for query builder classes
	if (resolvedConfig.includeComments) {
		output.push(`// =============================================================================`);
		output.push(`// Query Builder Classes`);
		output.push(`// =============================================================================`);
		output.push(``);
	}

	// Cast schema for internal use
	const internalSchema = schema as unknown as Schema<
		Record<string, NodeDefinition<any, any>>,
		Record<string, EdgeDefinition<any>>
	>;

	// Generate query builder class for each node
	for (const [nodeName, nodeDef] of Object.entries(schema.nodes)) {
		output.push(
			generateQueryBuilderClass(
				nodeName,
				nodeDef as NodeDefinition<Record<string, Field>, boolean>,
				internalSchema,
				resolvedConfig,
			),
		);
	}

	// Section header for factory objects
	if (resolvedConfig.generateFactoryMethods && resolvedConfig.includeComments) {
		output.push(`// =============================================================================`);
		output.push(`// Static Factory Objects`);
		output.push(`// =============================================================================`);
		output.push(``);
	}

	// Generate factory object for each node
	if (resolvedConfig.generateFactoryMethods) {
		for (const [nodeName, nodeDef] of Object.entries(schema.nodes)) {
			output.push(
				generateFactoryObject(
					nodeName,
					nodeDef as NodeDefinition<Record<string, Field>, boolean>,
					resolvedConfig,
				),
			);
		}
	}

	return output.join("\n");
}

/**
 * Result of query builder generation including metadata.
 */
export interface GeneratedQueryBuildersResult {
	/** The generated TypeScript code */
	code: string;
	/** Number of query builder classes generated */
	builderCount: number;
	/** Number of factory objects generated */
	factoryCount: number;
	/** Total number of field filter methods generated */
	fieldFilterCount: number;
	/** Total number of traversal methods generated */
	traversalMethodCount: number;
}

/**
 * Generate query builders with metadata about what was generated.
 *
 * @param schema - The schema to generate query builders from
 * @param options - Generation options
 * @returns Generated code and metadata
 */
export function generateQueryBuildersWithMeta<
	TNodes extends Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	TEdges extends Record<string, EdgeDefinition<Record<string, Field>>>,
>(
	schema: Schema<TNodes, TEdges>,
	options: QueryBuilderGeneratorConfig = {},
): GeneratedQueryBuildersResult {
	const code = generateQueryBuilders(schema, options);

	// Count generated artifacts
	const nodeNames = Object.keys(schema.nodes);
	let fieldFilterCount = 0;
	let traversalMethodCount = 0;

	for (const [nodeName, nodeDef] of Object.entries(schema.nodes)) {
		// Count field filters
		for (const [fieldName, field] of Object.entries(
			(nodeDef as NodeDefinition<Record<string, Field>, boolean>).fields,
		)) {
			if (shouldGenerateFieldFilter(fieldName, field as Field)) {
				fieldFilterCount++;
			}
		}

		// Count traversal methods
		const internalSchema = schema as unknown as Schema<
			Record<string, NodeDefinition<any, any>>,
			Record<string, EdgeDefinition<any>>
		>;
		const outgoing = internalSchema.getEdgesFrom(nodeName);
		const incoming = internalSchema.getEdgesTo(nodeName);

		traversalMethodCount += outgoing.length;
		// Count incoming edges excluding self-referential
		for (const { edge } of incoming) {
			if (edge.getFrom() !== nodeName) {
				traversalMethodCount++;
			}
		}
	}

	return {
		code,
		builderCount: nodeNames.length,
		factoryCount: options.generateFactoryMethods !== false ? nodeNames.length : 0,
		fieldFilterCount,
		traversalMethodCount,
	};
}

/**
 * Generate query builders and write to a file.
 *
 * @param schema - The schema to generate query builders from
 * @param outputPath - Path to write the generated file
 * @param options - Generation options
 */
export async function generateQueryBuildersToFile<
	TNodes extends Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	TEdges extends Record<string, EdgeDefinition<Record<string, Field>>>,
>(
	schema: Schema<TNodes, TEdges>,
	outputPath: string,
	options: QueryBuilderGeneratorConfig = {},
): Promise<void> {
	const code = generateQueryBuilders(schema, options);
	await Bun.write(outputPath, code);
}

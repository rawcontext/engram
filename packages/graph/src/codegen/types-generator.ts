/**
 * TypeScript type generation from Schema DSL definitions.
 *
 * This module generates TypeScript interface definitions from the schema.
 * These interfaces are used throughout the codebase for type-safe query results
 * and input validation.
 *
 * Inspired by:
 * - Drizzle ORM's $inferSelect / $inferInsert patterns
 * - Prisma Client's generated types
 *
 * @example
 * ```typescript
 * import { generateTypes } from '@engram/graph/codegen';
 * import { engramSchema } from '@engram/graph/schema';
 *
 * const code = generateTypes(engramSchema);
 * console.log(code);
 * // => TypeScript interfaces for all nodes and edges
 * ```
 */

import type { EdgeDefinition } from "../schema/edge";
import type { NodeDefinition } from "../schema/node";
import type { Schema } from "../schema/schema";
import type { Field, FieldKind } from "../schema/types";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for type generation.
 */
export interface TypeGeneratorOptions {
	/**
	 * Whether to include JSDoc comments.
	 * @default true
	 */
	includeComments?: boolean;

	/**
	 * Whether to generate Create/Update input types.
	 * @default true
	 */
	generateInputTypes?: boolean;

	/**
	 * Header comment to include at the top of the generated file.
	 * Set to false to disable.
	 * @default true (generates standard AUTO-GENERATED header)
	 */
	includeHeader?: boolean | string;
}

// =============================================================================
// Field Type Mapping
// =============================================================================

/**
 * Map schema field kind to TypeScript type string.
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
			return "unknown[]"; // Will be refined by getFieldTsType
		case "enum":
			return "string"; // Will be refined by getFieldTsType
		case "vector":
			return "number[]";
		default:
			return "unknown";
	}
}

/**
 * Get the full TypeScript type for a field, handling nested types and optionality.
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
			// Access the inner field type from the config
			const arrayConfig = config as { inner?: Field };
			if (arrayConfig.inner) {
				const innerType = getFieldTsType(arrayConfig.inner);
				return `${innerType}[]`;
			}
			return "unknown[]";
		}

		case "enum": {
			// Access enum values from the config
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
 * Check if a field is optional.
 */
function isFieldOptional(field: Field): boolean {
	return field.config.optional === true;
}

// =============================================================================
// Code Generation Utilities
// =============================================================================

/**
 * Generate a standard auto-generated header.
 */
function generateHeader(): string {
	const timestamp = new Date().toISOString();
	return `// AUTO-GENERATED - DO NOT EDIT
// Generated from schema at ${timestamp}
// Run 'bun run codegen' to regenerate

`;
}

/**
 * Generate import statements for the types file.
 */
function generateImports(): string {
	return `import type { BitemporalFields } from "../schema/node";

`;
}

/**
 * Convert PascalCase to SCREAMING_SNAKE_CASE for edge type names.
 */
function toScreamingSnake(name: string): string {
	return name
		.replace(/([A-Z])/g, "_$1")
		.toUpperCase()
		.replace(/^_/, "");
}

// =============================================================================
// Node Type Generation
// =============================================================================

/**
 * Generate TypeScript interface for a single node.
 */
function generateNodeInterface(
	name: string,
	nodeDef: NodeDefinition<Record<string, Field>, boolean>,
	options: TypeGeneratorOptions,
): string {
	const lines: string[] = [];
	const fields = nodeDef.fields;
	const isBitemporal = nodeDef.config.bitemporal;

	// Interface header
	if (options.includeComments) {
		lines.push(`/**`);
		lines.push(` * ${name} node type.`);
		if (isBitemporal) {
			lines.push(` * Includes bitemporal fields (vt_start, vt_end, tt_start, tt_end).`);
		}
		lines.push(` */`);
	}

	// Extend BitemporalFields if bitemporal
	if (isBitemporal) {
		lines.push(`export interface ${name} extends BitemporalFields {`);
	} else {
		lines.push(`export interface ${name} {`);
	}

	// Generate field definitions
	for (const [fieldName, field] of Object.entries(fields)) {
		const tsType = getFieldTsType(field);
		const optional = isFieldOptional(field) ? "?" : "";
		lines.push(`\t${fieldName}${optional}: ${tsType};`);
	}

	lines.push(`}`);
	lines.push(``);

	return lines.join("\n");
}

/**
 * Generate Create input type for a node.
 * Omits bitemporal fields as they are auto-generated.
 */
function generateCreateInputType(
	name: string,
	nodeDef: NodeDefinition<Record<string, Field>, boolean>,
	options: TypeGeneratorOptions,
): string {
	const lines: string[] = [];
	const isBitemporal = nodeDef.config.bitemporal;

	if (options.includeComments) {
		lines.push(`/**`);
		lines.push(` * Input type for creating a ${name} node.`);
		if (isBitemporal) {
			lines.push(` * Bitemporal fields are omitted as they are auto-generated.`);
		}
		lines.push(` */`);
	}

	if (isBitemporal) {
		lines.push(`export type Create${name}Input = Omit<${name}, keyof BitemporalFields>;`);
	} else {
		lines.push(`export type Create${name}Input = ${name};`);
	}

	lines.push(``);

	return lines.join("\n");
}

/**
 * Generate Update input type for a node.
 * Makes all fields optional and omits bitemporal fields.
 */
function generateUpdateInputType(
	name: string,
	nodeDef: NodeDefinition<Record<string, Field>, boolean>,
	options: TypeGeneratorOptions,
): string {
	const lines: string[] = [];
	const isBitemporal = nodeDef.config.bitemporal;

	if (options.includeComments) {
		lines.push(`/**`);
		lines.push(` * Input type for updating a ${name} node.`);
		lines.push(` * All fields are optional.`);
		lines.push(` */`);
	}

	if (isBitemporal) {
		lines.push(`export type Update${name}Input = Partial<Omit<${name}, keyof BitemporalFields>>;`);
	} else {
		lines.push(`export type Update${name}Input = Partial<${name}>;`);
	}

	lines.push(``);

	return lines.join("\n");
}

// =============================================================================
// Edge Type Generation
// =============================================================================

/**
 * Generate TypeScript interface for edge properties.
 */
function generateEdgePropertiesInterface(
	name: string,
	edgeDef: EdgeDefinition<Record<string, Field>>,
	options: TypeGeneratorOptions,
): string | null {
	const props = edgeDef.getProperties();
	const propEntries = Object.entries(props);

	// Skip if no properties
	if (propEntries.length === 0) {
		return null;
	}

	const lines: string[] = [];
	const isTemporal = edgeDef.isTemporal();

	if (options.includeComments) {
		lines.push(`/**`);
		lines.push(` * Properties for ${name} edge.`);
		lines.push(` * ${edgeDef.getFrom()} -[${name}]-> ${edgeDef.getTo()}`);
		if (isTemporal) {
			lines.push(` * Includes bitemporal fields.`);
		}
		lines.push(` */`);
	}

	if (isTemporal) {
		lines.push(`export interface ${name}Properties extends BitemporalFields {`);
	} else {
		lines.push(`export interface ${name}Properties {`);
	}

	for (const [fieldName, field] of propEntries) {
		const tsType = getFieldTsType(field);
		const optional = isFieldOptional(field) ? "?" : "";
		lines.push(`\t${fieldName}${optional}: ${tsType};`);
	}

	lines.push(`}`);
	lines.push(``);

	return lines.join("\n");
}

/**
 * Generate edge type that includes temporal fields if needed.
 */
function generateEdgeType(
	name: string,
	edgeDef: EdgeDefinition<Record<string, Field>>,
	options: TypeGeneratorOptions,
): string {
	const lines: string[] = [];
	const hasProperties = edgeDef.hasProperties();
	const isTemporal = edgeDef.isTemporal();

	if (options.includeComments) {
		lines.push(`/**`);
		lines.push(` * ${name} edge type.`);
		lines.push(` * ${edgeDef.getFrom()} -[${name}]-> ${edgeDef.getTo()}`);
		if (edgeDef.getDescription()) {
			lines.push(` * ${edgeDef.getDescription()}`);
		}
		lines.push(` */`);
	}

	if (hasProperties) {
		// Properties interface already includes bitemporal if needed
		lines.push(`export type ${name}Edge = ${name}Properties;`);
	} else if (isTemporal) {
		lines.push(`export type ${name}Edge = BitemporalFields;`);
	} else {
		lines.push(`export type ${name}Edge = Record<string, never>;`);
	}

	lines.push(``);

	return lines.join("\n");
}

// =============================================================================
// Enum Type Generation
// =============================================================================

/**
 * Extract unique enum types from all node fields for shared type aliases.
 */
function extractEnumTypes(
	nodes: Record<string, NodeDefinition<Record<string, Field>, boolean>>,
): Map<string, readonly string[]> {
	const enumTypes = new Map<string, readonly string[]>();

	for (const [nodeName, nodeDef] of Object.entries(nodes)) {
		for (const [fieldName, field] of Object.entries(nodeDef.fields)) {
			if (field.kind === "enum") {
				const enumConfig = field.config as { values?: readonly string[] };
				if (enumConfig.values) {
					// Create a type name from node + field
					const typeName = `${nodeName}${capitalize(fieldName)}`;
					enumTypes.set(typeName, enumConfig.values);
				}
			}
		}
	}

	return enumTypes;
}

/**
 * Capitalize first letter.
 */
function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Generate enum type aliases.
 */
function generateEnumTypes(
	enumTypes: Map<string, readonly string[]>,
	options: TypeGeneratorOptions,
): string {
	const lines: string[] = [];

	if (enumTypes.size > 0 && options.includeComments) {
		lines.push(`// =============================================================================`);
		lines.push(`// Enum Type Aliases`);
		lines.push(`// =============================================================================`);
		lines.push(``);
	}

	for (const [typeName, values] of enumTypes) {
		if (options.includeComments) {
			lines.push(`/** Allowed values for ${typeName}. */`);
		}
		const unionType = values.map((v) => `"${v}"`).join(" | ");
		lines.push(`export type ${typeName} = ${unionType};`);
		lines.push(``);
	}

	return lines.join("\n");
}

// =============================================================================
// Union Type Generation
// =============================================================================

/**
 * Generate union types for all nodes and edges.
 */
function generateUnionTypes(
	nodeNames: string[],
	edgeNames: string[],
	options: TypeGeneratorOptions,
): string {
	const lines: string[] = [];

	if (options.includeComments) {
		lines.push(`// =============================================================================`);
		lines.push(`// Union Types`);
		lines.push(`// =============================================================================`);
		lines.push(``);
	}

	// Node labels union
	if (options.includeComments) {
		lines.push(`/** Union of all node type names. */`);
	}
	lines.push(`export type NodeLabel = ${nodeNames.map((n) => `"${n}"`).join(" | ")};`);
	lines.push(``);

	// Edge types union
	if (options.includeComments) {
		lines.push(`/** Union of all edge type names. */`);
	}
	lines.push(`export type EdgeType = ${edgeNames.map((e) => `"${e}"`).join(" | ")};`);
	lines.push(``);

	// All nodes union
	if (options.includeComments) {
		lines.push(`/** Union of all node interface types. */`);
	}
	lines.push(`export type AnyNode = ${nodeNames.join(" | ")};`);
	lines.push(``);

	return lines.join("\n");
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate TypeScript types from a schema definition.
 *
 * @param schema - The schema to generate types from
 * @param options - Generation options
 * @returns Generated TypeScript code as a string
 *
 * @example
 * ```typescript
 * import { generateTypes } from '@engram/graph/codegen';
 * import { engramSchema } from '@engram/graph/schema';
 *
 * const code = generateTypes(engramSchema);
 * await Bun.write('src/generated/types.ts', code);
 * ```
 */
export function generateTypes<
	TNodes extends Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	TEdges extends Record<string, EdgeDefinition<Record<string, Field>>>,
>(schema: Schema<TNodes, TEdges>, options: TypeGeneratorOptions = {}): string {
	const { includeComments = true, generateInputTypes = true, includeHeader = true } = options;

	const resolvedOptions: TypeGeneratorOptions = {
		includeComments,
		generateInputTypes,
		includeHeader,
	};

	const output: string[] = [];

	// Header
	if (includeHeader === true) {
		output.push(generateHeader());
	} else if (typeof includeHeader === "string") {
		output.push(includeHeader);
		output.push("\n");
	}

	// Imports
	output.push(generateImports());

	// Extract enum types for reuse
	const enumTypes = extractEnumTypes(
		schema.nodes as Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	);
	if (enumTypes.size > 0) {
		output.push(generateEnumTypes(enumTypes, resolvedOptions));
	}

	// Node interfaces section header
	if (includeComments) {
		output.push(`// =============================================================================`);
		output.push(`// Node Types`);
		output.push(`// =============================================================================`);
		output.push(``);
	}

	// Generate node interfaces
	const nodeNames: string[] = [];
	for (const [name, nodeDef] of Object.entries(schema.nodes)) {
		nodeNames.push(name);
		output.push(
			generateNodeInterface(
				name,
				nodeDef as NodeDefinition<Record<string, Field>, boolean>,
				resolvedOptions,
			),
		);

		// Generate input types if enabled
		if (generateInputTypes) {
			output.push(
				generateCreateInputType(
					name,
					nodeDef as NodeDefinition<Record<string, Field>, boolean>,
					resolvedOptions,
				),
			);
			output.push(
				generateUpdateInputType(
					name,
					nodeDef as NodeDefinition<Record<string, Field>, boolean>,
					resolvedOptions,
				),
			);
		}
	}

	// Edge section header
	if (includeComments) {
		output.push(`// =============================================================================`);
		output.push(`// Edge Types`);
		output.push(`// =============================================================================`);
		output.push(``);
	}

	// Generate edge interfaces
	const edgeNames: string[] = [];
	for (const [name, edgeDef] of Object.entries(schema.edges)) {
		edgeNames.push(name);

		// Generate properties interface if edge has properties
		const propsInterface = generateEdgePropertiesInterface(
			name,
			edgeDef as EdgeDefinition<Record<string, Field>>,
			resolvedOptions,
		);
		if (propsInterface) {
			output.push(propsInterface);
		}

		// Generate edge type
		output.push(
			generateEdgeType(name, edgeDef as EdgeDefinition<Record<string, Field>>, resolvedOptions),
		);
	}

	// Generate union types
	output.push(generateUnionTypes(nodeNames, edgeNames, resolvedOptions));

	return output.join("\n");
}

/**
 * Result of type generation including metadata.
 */
export interface GeneratedTypesResult {
	/** The generated TypeScript code */
	code: string;
	/** Number of node types generated */
	nodeCount: number;
	/** Number of edge types generated */
	edgeCount: number;
	/** Number of enum types extracted */
	enumCount: number;
}

/**
 * Generate types with metadata about what was generated.
 *
 * @param schema - The schema to generate types from
 * @param options - Generation options
 * @returns Generated code and metadata
 */
export function generateTypesWithMeta<
	TNodes extends Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	TEdges extends Record<string, EdgeDefinition<Record<string, Field>>>,
>(schema: Schema<TNodes, TEdges>, options: TypeGeneratorOptions = {}): GeneratedTypesResult {
	const code = generateTypes(schema, options);
	const enumTypes = extractEnumTypes(
		schema.nodes as Record<string, NodeDefinition<Record<string, Field>, boolean>>,
	);

	return {
		code,
		nodeCount: Object.keys(schema.nodes).length,
		edgeCount: Object.keys(schema.edges).length,
		enumCount: enumTypes.size,
	};
}

/**
 * MCP Tool Generator for Schema DSL
 *
 * Generates MCP tool registration code from mcp.tool() definitions.
 * The generated code includes Zod schemas for validation, JSON Schema
 * for MCP protocol, and typed handler wrappers.
 *
 * @example
 * ```typescript
 * import { generateMcpTools } from './mcp-generator';
 * import { myTools } from './my-tools';
 *
 * const code = generateMcpTools(myTools);
 * await Bun.write('src/generated/mcp-tools.ts', code);
 * ```
 */

import type {
	ArrayParamConfig,
	EnumParamConfig,
	FloatParamConfig,
	IntParamConfig,
	ObjectParamConfig,
	Param,
	StringParamConfig,
	Tool,
	ToolCollection,
} from "../schema/mcp";

// =============================================================================
// Generator Configuration
// =============================================================================

/**
 * Configuration options for MCP tool generation.
 */
export interface McpGeneratorConfig {
	/**
	 * Whether to include JSDoc comments in generated code.
	 * @default true
	 */
	includeComments?: boolean;

	/**
	 * Whether to generate Zod schemas for validation.
	 * @default true
	 */
	generateZodSchemas?: boolean;

	/**
	 * Whether to generate JSON Schema for MCP protocol.
	 * @default true
	 */
	generateJsonSchema?: boolean;

	/**
	 * Whether to generate tool registration functions.
	 * @default true
	 */
	generateRegistrationFunctions?: boolean;

	/**
	 * Header comment for the generated file.
	 * @default true (generates standard AUTO-GENERATED header)
	 */
	includeHeader?: boolean | string;
}

const DEFAULT_CONFIG: Required<McpGeneratorConfig> = {
	includeComments: true,
	generateZodSchemas: true,
	generateJsonSchema: true,
	generateRegistrationFunctions: true,
	includeHeader: true,
};

// =============================================================================
// Type Mapping Utilities
// =============================================================================

/**
 * Convert a Param definition to Zod schema code.
 */
function paramToZod(param: Param): string {
	const kind = param.kind;
	const config = param.config;

	let zodCode: string;

	switch (kind) {
		case "string": {
			zodCode = "z.string()";
			const strConfig = config as StringParamConfig;
			if (strConfig.minLength !== undefined) {
				zodCode += `.min(${strConfig.minLength})`;
			}
			if (strConfig.maxLength !== undefined) {
				zodCode += `.max(${strConfig.maxLength})`;
			}
			break;
		}
		case "int": {
			zodCode = "z.number().int()";
			const intConfig = config as IntParamConfig;
			if (intConfig.min !== undefined) {
				zodCode += `.min(${intConfig.min})`;
			}
			if (intConfig.max !== undefined) {
				zodCode += `.max(${intConfig.max})`;
			}
			break;
		}
		case "float": {
			zodCode = "z.number()";
			const floatConfig = config as FloatParamConfig;
			if (floatConfig.min !== undefined) {
				zodCode += `.min(${floatConfig.min})`;
			}
			if (floatConfig.max !== undefined) {
				zodCode += `.max(${floatConfig.max})`;
			}
			break;
		}
		case "boolean": {
			zodCode = "z.boolean()";
			break;
		}
		case "array": {
			const arrayConfig = config as ArrayParamConfig<unknown>;
			const innerZod = paramToZod(arrayConfig.inner);
			zodCode = `z.array(${innerZod})`;
			break;
		}
		case "enum": {
			const enumConfig = config as EnumParamConfig<string>;
			const enumValues = enumConfig.values.map((v) => `"${v}"`).join(", ");
			zodCode = `z.enum([${enumValues}])`;
			break;
		}
		case "object": {
			const objConfig = config as ObjectParamConfig<Record<string, Param>>;
			const props = Object.entries(objConfig.properties)
				.map(([key, prop]) => `\t\t${key}: ${paramToZod(prop)}`)
				.join(",\n");
			zodCode = `z.object({\n${props}\n\t})`;
			break;
		}
		default: {
			zodCode = "z.unknown()";
		}
	}

	// Handle description
	if (config.description) {
		const escaped = config.description.replace(/'/g, "\\'").replace(/\n/g, "\\n");
		zodCode += `.describe('${escaped}')`;
	}

	// Handle default value
	if (config.defaultValue !== undefined) {
		const defaultVal =
			typeof config.defaultValue === "string"
				? `"${config.defaultValue}"`
				: Array.isArray(config.defaultValue)
					? JSON.stringify(config.defaultValue)
					: String(config.defaultValue);
		zodCode += `.default(${defaultVal})`;
	}

	// Handle optional
	if (config.optional === true) {
		zodCode += ".optional()";
	}

	return zodCode;
}

/**
 * Convert a Param definition to JSON Schema.
 */
function paramToJsonSchema(param: Param): object {
	const kind = param.kind;
	const config = param.config;

	let schema: Record<string, unknown> = {};

	switch (kind) {
		case "string": {
			schema.type = "string";
			const strConfig = config as StringParamConfig;
			if (strConfig.minLength !== undefined) {
				schema.minLength = strConfig.minLength;
			}
			if (strConfig.maxLength !== undefined) {
				schema.maxLength = strConfig.maxLength;
			}
			break;
		}
		case "int": {
			schema.type = "integer";
			const intConfig = config as IntParamConfig;
			if (intConfig.min !== undefined) {
				schema.minimum = intConfig.min;
			}
			if (intConfig.max !== undefined) {
				schema.maximum = intConfig.max;
			}
			break;
		}
		case "float": {
			schema.type = "number";
			const floatConfig = config as FloatParamConfig;
			if (floatConfig.min !== undefined) {
				schema.minimum = floatConfig.min;
			}
			if (floatConfig.max !== undefined) {
				schema.maximum = floatConfig.max;
			}
			break;
		}
		case "boolean": {
			schema.type = "boolean";
			break;
		}
		case "array": {
			schema.type = "array";
			const arrayConfig = config as ArrayParamConfig<unknown>;
			schema.items = paramToJsonSchema(arrayConfig.inner);
			break;
		}
		case "enum": {
			schema.type = "string";
			const enumConfig = config as EnumParamConfig<string>;
			schema.enum = [...enumConfig.values];
			break;
		}
		case "object": {
			schema.type = "object";
			const objConfig = config as ObjectParamConfig<Record<string, Param>>;
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			for (const [key, prop] of Object.entries(objConfig.properties)) {
				properties[key] = paramToJsonSchema(prop);
				if (!prop.config.optional) {
					required.push(key);
				}
			}

			schema.properties = properties;
			if (required.length > 0) {
				schema.required = required;
			}
			break;
		}
		default: {
			schema = {};
		}
	}

	// Handle description
	if (config.description) {
		schema.description = config.description;
	}

	// Handle default value
	if (config.defaultValue !== undefined) {
		schema.default = config.defaultValue;
	}

	return schema;
}

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str: string): string {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

// =============================================================================
// Code Generation
// =============================================================================

/**
 * Generate the auto-generated header.
 */
function generateHeader(): string {
	const timestamp = new Date().toISOString();
	return `// AUTO-GENERATED FILE - DO NOT EDIT
// Generated by mcp-generator.ts at ${timestamp}
// Run 'bun run codegen' to regenerate

`;
}

/**
 * Generate imports for the MCP tools file.
 */
function generateImports(): string {
	const lines: string[] = [];

	lines.push('import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";');
	lines.push('import { z } from "zod";');
	lines.push("");

	return lines.join("\n");
}

/**
 * Generate Zod schema for a tool's input.
 */
function generateInputSchema(
	toolName: string,
	tool: Tool,
	config: Required<McpGeneratorConfig>,
): string {
	const lines: string[] = [];
	const schemaName = `${toolName}InputSchema`;

	if (config.includeComments) {
		lines.push(`/**`);
		lines.push(` * Input schema for the ${toolName} tool.`);
		lines.push(` */`);
	}

	lines.push(`export const ${schemaName} = z.object({`);

	for (const [paramName, param] of Object.entries(tool.input)) {
		lines.push(`\t${paramName}: ${paramToZod(param)},`);
	}

	lines.push(`});`);
	lines.push("");
	lines.push(`export type ${capitalize(toolName)}Input = z.infer<typeof ${schemaName}>;`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Generate Zod schema for a tool's output.
 */
function generateOutputSchema(
	toolName: string,
	tool: Tool,
	config: Required<McpGeneratorConfig>,
): string {
	if (!tool.output || Object.keys(tool.output).length === 0) {
		return "";
	}

	const lines: string[] = [];
	const schemaName = `${toolName}OutputSchema`;

	if (config.includeComments) {
		lines.push(`/**`);
		lines.push(` * Output schema for the ${toolName} tool.`);
		lines.push(` */`);
	}

	lines.push(`export const ${schemaName} = z.object({`);

	for (const [paramName, param] of Object.entries(tool.output)) {
		lines.push(`\t${paramName}: ${paramToZod(param)},`);
	}

	lines.push(`});`);
	lines.push("");
	lines.push(`export type ${capitalize(toolName)}Output = z.infer<typeof ${schemaName}>;`);
	lines.push("");

	return lines.join("\n");
}

/**
 * Generate JSON Schema object literal for a tool's input.
 */
function generateJsonSchemaObject(tool: Tool): string {
	const properties: Record<string, unknown> = {};
	const required: string[] = [];

	for (const [paramName, param] of Object.entries(tool.input)) {
		properties[paramName] = paramToJsonSchema(param);
		if (!param.config.optional) {
			required.push(paramName);
		}
	}

	const schema: Record<string, unknown> = {
		type: "object",
		properties,
	};

	if (required.length > 0) {
		schema.required = required;
	}

	return JSON.stringify(schema, null, 2)
		.split("\n")
		.map((line, i) => (i === 0 ? line : `\t${line}`))
		.join("\n");
}

/**
 * Generate the tool registration function.
 */
function generateRegistrationFunction(
	toolName: string,
	tool: Tool,
	config: Required<McpGeneratorConfig>,
): string {
	const lines: string[] = [];
	const funcName = `register${capitalize(toolName)}Tool`;
	const inputSchemaName = `${toolName}InputSchema`;
	const hasOutput = tool.output && Object.keys(tool.output).length > 0;

	if (config.includeComments) {
		lines.push(`/**`);
		lines.push(` * Register the ${toolName} tool with an MCP server.`);
		if (tool.title) {
			lines.push(` * @description ${tool.description}`);
		}
		lines.push(` */`);
	}

	// Function signature
	lines.push(`export function ${funcName}(`);
	lines.push(`\tserver: McpServer,`);
	lines.push(
		`\thandler: (input: z.infer<typeof ${inputSchemaName}>) => Promise<${hasOutput ? `z.infer<typeof ${toolName}OutputSchema>` : "void"}>,`,
	);
	lines.push(`): void {`);

	// Registration call
	lines.push(`\tserver.registerTool(`);
	lines.push(`\t\t"${toolName}",`);
	lines.push(`\t\t{`);

	if (tool.title) {
		lines.push(`\t\t\ttitle: "${tool.title}",`);
	}

	// Escape description for string literal
	const escapedDesc = tool.description.replace(/"/g, '\\"').replace(/\n/g, "\\n");
	lines.push(`\t\t\tdescription: "${escapedDesc}",`);

	// Input schema as Zod object
	lines.push(`\t\t\tinputSchema: {`);
	for (const [paramName, param] of Object.entries(tool.input)) {
		lines.push(`\t\t\t\t${paramName}: ${paramToZod(param)},`);
	}
	lines.push(`\t\t\t},`);

	// Output schema if present
	if (hasOutput && tool.output) {
		lines.push(`\t\t\toutputSchema: {`);
		for (const [paramName, param] of Object.entries(tool.output)) {
			lines.push(`\t\t\t\t${paramName}: ${paramToZod(param)},`);
		}
		lines.push(`\t\t\t},`);
	}

	// Annotations if present
	if (tool.annotations) {
		lines.push(`\t\t\tannotations: ${JSON.stringify(tool.annotations)},`);
	}

	lines.push(`\t\t},`);

	// Handler wrapper
	lines.push(`\t\tasync (inputs) => {`);
	lines.push(`\t\t\tconst validated = ${inputSchemaName}.parse(inputs);`);
	lines.push(`\t\t\tconst result = await handler(validated);`);

	if (hasOutput) {
		lines.push(`\t\t\treturn {`);
		lines.push(`\t\t\t\tcontent: [{ type: "text", text: JSON.stringify(result) }],`);
		lines.push(`\t\t\t\tstructuredContent: result,`);
		lines.push(`\t\t\t};`);
	} else {
		lines.push(`\t\t\treturn {`);
		lines.push(`\t\t\t\tcontent: [{ type: "text", text: "OK" }],`);
		lines.push(`\t\t\t};`);
	}

	lines.push(`\t\t},`);
	lines.push(`\t);`);
	lines.push(`}`);
	lines.push("");

	return lines.join("\n");
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate MCP tool code from a tool collection.
 *
 * @param tools - The tool collection to generate code for
 * @param config - Generator configuration
 * @returns Generated TypeScript code as a string
 *
 * @example
 * ```typescript
 * import { generateMcpTools } from './mcp-generator';
 * import { myTools } from './my-tools';
 *
 * const code = generateMcpTools(myTools);
 * await Bun.write('src/generated/mcp-tools.ts', code);
 * ```
 */
export function generateMcpTools(
	tools: ToolCollection<Record<string, Tool>>,
	config: Partial<McpGeneratorConfig> = {},
): string {
	const finalConfig = { ...DEFAULT_CONFIG, ...config };
	const lines: string[] = [];

	// Header
	if (finalConfig.includeHeader) {
		if (typeof finalConfig.includeHeader === "string") {
			lines.push(finalConfig.includeHeader);
		} else {
			lines.push(generateHeader());
		}
	}

	// Imports
	lines.push(generateImports());

	// Zod schemas section
	if (finalConfig.generateZodSchemas) {
		lines.push("// =============================================================================");
		lines.push("// Zod Schemas");
		lines.push("// =============================================================================");
		lines.push("");

		for (const [toolName, tool] of Object.entries(tools)) {
			lines.push(generateInputSchema(toolName, tool, finalConfig));
			const outputSchema = generateOutputSchema(toolName, tool, finalConfig);
			if (outputSchema) {
				lines.push(outputSchema);
			}
		}
	}

	// JSON Schema section
	if (finalConfig.generateJsonSchema) {
		lines.push("// =============================================================================");
		lines.push("// JSON Schemas (for MCP protocol)");
		lines.push("// =============================================================================");
		lines.push("");

		for (const [toolName, tool] of Object.entries(tools)) {
			if (finalConfig.includeComments) {
				lines.push(`/**`);
				lines.push(` * JSON Schema for ${toolName} tool input.`);
				lines.push(` */`);
			}
			lines.push(`export const ${toolName}InputJsonSchema = ${generateJsonSchemaObject(tool)};`);
			lines.push("");
		}
	}

	// Registration functions
	if (finalConfig.generateRegistrationFunctions) {
		lines.push("// =============================================================================");
		lines.push("// Tool Registration Functions");
		lines.push("// =============================================================================");
		lines.push("");

		for (const [toolName, tool] of Object.entries(tools)) {
			lines.push(generateRegistrationFunction(toolName, tool, finalConfig));
		}
	}

	// Export all tool names
	lines.push("// =============================================================================");
	lines.push("// Tool Names");
	lines.push("// =============================================================================");
	lines.push("");
	lines.push("export const toolNames = [");
	for (const toolName of Object.keys(tools)) {
		lines.push(`\t"${toolName}",`);
	}
	lines.push("] as const;");
	lines.push("");
	lines.push("export type ToolName = (typeof toolNames)[number];");
	lines.push("");

	return lines.join("\n");
}

/**
 * Generate MCP tools and write to a file.
 *
 * @param tools - The tool collection to generate code for
 * @param outputPath - Path to write the generated file
 * @param config - Generator configuration
 */
export async function generateMcpToolsToFile(
	tools: ToolCollection<Record<string, Tool>>,
	outputPath: string,
	config: Partial<McpGeneratorConfig> = {},
): Promise<void> {
	const code = generateMcpTools(tools, config);
	await Bun.write(outputPath, code);
}

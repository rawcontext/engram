/**
 * MCP Tool Annotation DSL for declarative tool definitions.
 *
 * This module provides a type-safe builder pattern for defining MCP tools
 * that can be automatically registered with McpServer. The DSL mirrors
 * the field.* pattern used for graph node schemas.
 *
 * @example
 * ```typescript
 * import { mcp } from '@engram/graph/schema';
 *
 * export const mcpTools = mcp.defineTools({
 *   remember: mcp.tool({
 *     title: 'Remember',
 *     description: 'Store a memory for future recall',
 *     input: {
 *       content: mcp.param.string('The memory content to store'),
 *       type: mcp.param.enum(MemoryTypeEnum, 'Classification of the memory').optional(),
 *       tags: mcp.param.array(mcp.param.string(), 'Keywords for filtering').optional(),
 *     },
 *     output: {
 *       id: mcp.param.string('Created memory ID'),
 *       stored: mcp.param.boolean('Success indicator'),
 *     },
 *   }),
 * });
 * ```
 */

// =============================================================================
// Param Type Kinds
// =============================================================================

/**
 * Discriminator for MCP parameter types.
 * Used for type narrowing and JSON Schema generation.
 */
export type ParamKind =
	| "string"
	| "int"
	| "float"
	| "boolean"
	| "array"
	| "enum"
	| "object";

// =============================================================================
// Param Configuration
// =============================================================================

/**
 * Base configuration shared by all param types.
 */
export interface BaseParamConfig {
	/**
	 * Human-readable description for the parameter.
	 * This appears in tool documentation and helps LLMs understand usage.
	 */
	description?: string;

	/**
	 * Whether the parameter is optional.
	 * @default false
	 */
	optional?: boolean;

	/**
	 * Default value for the parameter if not provided.
	 */
	defaultValue?: unknown;
}

/**
 * Configuration for string parameters.
 */
export interface StringParamConfig extends BaseParamConfig {
	/**
	 * Maximum length constraint.
	 */
	maxLength?: number;

	/**
	 * Minimum length constraint.
	 */
	minLength?: number;
}

/**
 * Configuration for integer parameters.
 */
export interface IntParamConfig extends BaseParamConfig {
	/**
	 * Minimum value constraint (inclusive).
	 */
	min?: number;

	/**
	 * Maximum value constraint (inclusive).
	 */
	max?: number;
}

/**
 * Configuration for float parameters.
 */
export interface FloatParamConfig extends BaseParamConfig {
	/**
	 * Minimum value constraint (inclusive).
	 */
	min?: number;

	/**
	 * Maximum value constraint (inclusive).
	 */
	max?: number;
}

/**
 * Configuration for boolean parameters.
 */
export interface BooleanParamConfig extends BaseParamConfig {}

/**
 * Configuration for array parameters.
 */
export interface ArrayParamConfig<T> extends BaseParamConfig {
	/**
	 * The inner param type for array elements.
	 */
	inner: Param<T>;
}

/**
 * Configuration for enum parameters.
 */
export interface EnumParamConfig<T extends string> extends BaseParamConfig {
	/**
	 * Allowed string values for the enum.
	 */
	values: readonly T[];
}

/**
 * Configuration for object parameters.
 */
export interface ObjectParamConfig<T extends Record<string, Param>> extends BaseParamConfig {
	/**
	 * The properties of the object.
	 */
	properties: T;
}

// =============================================================================
// Param Interface
// =============================================================================

/**
 * Base interface for all param types.
 * @template T - The TypeScript type this param represents
 */
export interface Param<T = unknown> {
	/**
	 * Discriminator for the param type.
	 */
	readonly kind: ParamKind;

	/**
	 * Param configuration.
	 */
	readonly config: BaseParamConfig;

	/**
	 * TypeScript type inference helper.
	 * This property is never actually set but is used for type inference.
	 */
	readonly __type?: T;
}

// =============================================================================
// StringParam
// =============================================================================

export class StringParam implements Param<string> {
	readonly kind = "string" as const;
	readonly config: StringParamConfig;

	constructor(description?: string, config: Omit<StringParamConfig, "description"> = {}) {
		this.config = { ...config, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): StringParam {
		return new StringParam(this.config.description, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this parameter.
	 */
	default(value: string): StringParam {
		return new StringParam(this.config.description, { ...this.config, defaultValue: value });
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): StringParam {
		return new StringParam(description, this.config);
	}

	/**
	 * Set maximum length constraint.
	 */
	max(length: number): StringParam {
		return new StringParam(this.config.description, { ...this.config, maxLength: length });
	}

	/**
	 * Set minimum length constraint.
	 */
	min(length: number): StringParam {
		return new StringParam(this.config.description, { ...this.config, minLength: length });
	}
}

// =============================================================================
// IntParam
// =============================================================================

export class IntParam implements Param<number> {
	readonly kind = "int" as const;
	readonly config: IntParamConfig;

	constructor(description?: string, config: Omit<IntParamConfig, "description"> = {}) {
		this.config = { ...config, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): IntParam {
		return new IntParam(this.config.description, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this parameter.
	 */
	default(value: number): IntParam {
		return new IntParam(this.config.description, { ...this.config, defaultValue: value });
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): IntParam {
		return new IntParam(description, this.config);
	}

	/**
	 * Set minimum value constraint (inclusive).
	 */
	min(value: number): IntParam {
		return new IntParam(this.config.description, { ...this.config, min: value });
	}

	/**
	 * Set maximum value constraint (inclusive).
	 */
	max(value: number): IntParam {
		return new IntParam(this.config.description, { ...this.config, max: value });
	}
}

// =============================================================================
// FloatParam
// =============================================================================

export class FloatParam implements Param<number> {
	readonly kind = "float" as const;
	readonly config: FloatParamConfig;

	constructor(description?: string, config: Omit<FloatParamConfig, "description"> = {}) {
		this.config = { ...config, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): FloatParam {
		return new FloatParam(this.config.description, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this parameter.
	 */
	default(value: number): FloatParam {
		return new FloatParam(this.config.description, { ...this.config, defaultValue: value });
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): FloatParam {
		return new FloatParam(description, this.config);
	}

	/**
	 * Set minimum value constraint (inclusive).
	 */
	min(value: number): FloatParam {
		return new FloatParam(this.config.description, { ...this.config, min: value });
	}

	/**
	 * Set maximum value constraint (inclusive).
	 */
	max(value: number): FloatParam {
		return new FloatParam(this.config.description, { ...this.config, max: value });
	}
}

// =============================================================================
// BooleanParam
// =============================================================================

export class BooleanParam implements Param<boolean> {
	readonly kind = "boolean" as const;
	readonly config: BooleanParamConfig;

	constructor(description?: string, config: Omit<BooleanParamConfig, "description"> = {}) {
		this.config = { ...config, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): BooleanParam {
		return new BooleanParam(this.config.description, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this parameter.
	 */
	default(value: boolean): BooleanParam {
		return new BooleanParam(this.config.description, { ...this.config, defaultValue: value });
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): BooleanParam {
		return new BooleanParam(description, this.config);
	}
}

// =============================================================================
// ArrayParam
// =============================================================================

export class ArrayParam<T> implements Param<T[]> {
	readonly kind = "array" as const;
	readonly config: ArrayParamConfig<T>;

	constructor(
		inner: Param<T>,
		description?: string,
		config: Omit<ArrayParamConfig<T>, "inner" | "description"> = {},
	) {
		this.config = { ...config, inner, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): ArrayParam<T> {
		return new ArrayParam(this.config.inner, this.config.description, {
			...this.config,
			optional: true,
		});
	}

	/**
	 * Set a default value for this parameter.
	 */
	default(value: T[]): ArrayParam<T> {
		return new ArrayParam(this.config.inner, this.config.description, {
			...this.config,
			defaultValue: value,
		});
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): ArrayParam<T> {
		return new ArrayParam(this.config.inner, description, this.config);
	}
}

// =============================================================================
// EnumParam
// =============================================================================

export class EnumParam<T extends string> implements Param<T> {
	readonly kind = "enum" as const;
	readonly config: EnumParamConfig<T>;

	constructor(
		values: readonly T[],
		description?: string,
		config: Omit<EnumParamConfig<T>, "values" | "description"> = {},
	) {
		this.config = { ...config, values, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): EnumParam<T> {
		return new EnumParam(this.config.values, this.config.description, {
			...this.config,
			optional: true,
		});
	}

	/**
	 * Set a default value for this parameter.
	 */
	default(value: T): EnumParam<T> {
		return new EnumParam(this.config.values, this.config.description, {
			...this.config,
			defaultValue: value,
		});
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): EnumParam<T> {
		return new EnumParam(this.config.values, description, this.config);
	}
}

// =============================================================================
// ObjectParam
// =============================================================================

export class ObjectParam<T extends Record<string, Param>> implements Param<InferParamShape<T>> {
	readonly kind = "object" as const;
	readonly config: ObjectParamConfig<T>;

	constructor(
		properties: T,
		description?: string,
		config: Omit<ObjectParamConfig<T>, "properties" | "description"> = {},
	) {
		this.config = { ...config, properties, description };
	}

	/**
	 * Make this parameter optional.
	 */
	optional(): ObjectParam<T> {
		return new ObjectParam(this.config.properties, this.config.description, {
			...this.config,
			optional: true,
		});
	}

	/**
	 * Add or update the description.
	 */
	describe(description: string): ObjectParam<T> {
		return new ObjectParam(this.config.properties, description, this.config);
	}
}

// =============================================================================
// Type Inference Utilities
// =============================================================================

/**
 * Infer the TypeScript type from a Param definition.
 */
export type InferParamType<P extends Param> = P extends Param<infer T> ? T : never;

/**
 * Infer the TypeScript type from a shape of Params.
 * Handles optional params by making their keys optional in the result type.
 */
export type InferParamShape<T extends Record<string, Param>> = {
	[K in keyof T as T[K]["config"]["optional"] extends true ? never : K]: InferParamType<T[K]>;
} & {
	[K in keyof T as T[K]["config"]["optional"] extends true ? K : never]?: InferParamType<T[K]>;
};

/**
 * Simplify a type for better IDE display.
 */
export type Simplify<T> = { [K in keyof T]: T[K] } & {};

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * Tool annotations for MCP tool metadata.
 */
export interface ToolAnnotations {
	/**
	 * Human-readable title for the tool.
	 */
	title?: string;

	/**
	 * If true, the tool does not modify any state (read-only operation).
	 */
	readOnlyHint?: boolean;

	/**
	 * If true, the tool may perform destructive operations (e.g., delete data).
	 */
	destructiveHint?: boolean;

	/**
	 * If true, the tool may take a long time to execute.
	 */
	idempotentHint?: boolean;

	/**
	 * If true, the tool should only be called with explicit user confirmation.
	 */
	openWorldHint?: boolean;
}

/**
 * Tool definition with input/output schemas and handler.
 */
export interface ToolDefinition<
	TInput extends Record<string, Param> = Record<string, Param>,
	TOutput extends Record<string, Param> = Record<string, Param>,
	TContext = unknown,
> {
	/**
	 * Human-readable title for the tool.
	 */
	title?: string;

	/**
	 * Description of what the tool does.
	 * This is shown to LLMs to help them understand when to use the tool.
	 */
	description: string;

	/**
	 * Input parameter schema.
	 */
	input: TInput;

	/**
	 * Output schema (optional but recommended for structured content).
	 */
	output?: TOutput;

	/**
	 * Tool annotations for behavioral hints.
	 */
	annotations?: ToolAnnotations;

	/**
	 * Handler function for the tool.
	 * Receives validated input and context, returns the output.
	 */
	handler?: (
		input: Simplify<InferParamShape<TInput>>,
		context: TContext,
	) => Promise<Simplify<InferParamShape<TOutput>>> | Simplify<InferParamShape<TOutput>>;
}

/**
 * Internal representation of a tool with all metadata.
 */
export class Tool<
	TInput extends Record<string, Param> = Record<string, Param>,
	TOutput extends Record<string, Param> = Record<string, Param>,
	TContext = unknown,
> {
	constructor(public readonly definition: ToolDefinition<TInput, TOutput, TContext>) {}

	/**
	 * Get the tool's title.
	 */
	get title(): string | undefined {
		return this.definition.title;
	}

	/**
	 * Get the tool's description.
	 */
	get description(): string {
		return this.definition.description;
	}

	/**
	 * Get the input schema.
	 */
	get input(): TInput {
		return this.definition.input;
	}

	/**
	 * Get the output schema.
	 */
	get output(): TOutput | undefined {
		return this.definition.output;
	}

	/**
	 * Get the tool annotations.
	 */
	get annotations(): ToolAnnotations | undefined {
		return this.definition.annotations;
	}
}

// =============================================================================
// Tool Collection
// =============================================================================

/**
 * A collection of named tools.
 */
export type ToolCollection<T extends Record<string, Tool>> = T;

// =============================================================================
// Param Factory
// =============================================================================

/**
 * Parameter type factory with builder pattern.
 *
 * @example
 * ```typescript
 * const params = {
 *   query: param.string('Search query'),
 *   limit: param.int('Maximum results').min(1).max(100).default(10),
 *   tags: param.array(param.string(), 'Filter tags').optional(),
 *   type: param.enum(['a', 'b', 'c'] as const, 'Item type'),
 * };
 * ```
 */
export const param = {
	/**
	 * Create a string parameter.
	 * @param description - Human-readable description
	 */
	string: (description?: string): StringParam => new StringParam(description),

	/**
	 * Create an integer parameter.
	 * @param description - Human-readable description
	 */
	int: (description?: string): IntParam => new IntParam(description),

	/**
	 * Create a float parameter for decimal numbers.
	 * @param description - Human-readable description
	 */
	float: (description?: string): FloatParam => new FloatParam(description),

	/**
	 * Create a boolean parameter.
	 * @param description - Human-readable description
	 */
	boolean: (description?: string): BooleanParam => new BooleanParam(description),

	/**
	 * Create an array parameter with a specific element type.
	 * @param inner - The param type for array elements
	 * @param description - Human-readable description
	 */
	array: <T>(inner: Param<T>, description?: string): ArrayParam<T> =>
		new ArrayParam(inner, description),

	/**
	 * Create an enum parameter from a const array of string values.
	 * @param values - Readonly array of allowed values
	 * @param description - Human-readable description
	 */
	enum: <T extends string>(values: readonly T[], description?: string): EnumParam<T> =>
		new EnumParam(values, description),

	/**
	 * Create an object parameter with nested properties.
	 * @param properties - Object of param definitions
	 * @param description - Human-readable description
	 */
	object: <T extends Record<string, Param>>(properties: T, description?: string): ObjectParam<T> =>
		new ObjectParam(properties, description),
} as const;

// =============================================================================
// Tool Factory Functions
// =============================================================================

/**
 * Define a single MCP tool.
 *
 * @example
 * ```typescript
 * const rememberTool = mcp.tool({
 *   title: 'Remember',
 *   description: 'Store a memory for future recall',
 *   input: {
 *     content: mcp.param.string('The memory content'),
 *     type: mcp.param.enum(['decision', 'insight'] as const).optional(),
 *   },
 *   output: {
 *     id: mcp.param.string('Created memory ID'),
 *     stored: mcp.param.boolean('Success indicator'),
 *   },
 * });
 * ```
 */
function tool<
	TInput extends Record<string, Param>,
	TOutput extends Record<string, Param> = Record<string, never>,
	TContext = unknown,
>(definition: ToolDefinition<TInput, TOutput, TContext>): Tool<TInput, TOutput, TContext> {
	return new Tool(definition);
}

/**
 * Define a collection of MCP tools.
 *
 * @example
 * ```typescript
 * const tools = mcp.defineTools({
 *   remember: mcp.tool({ ... }),
 *   recall: mcp.tool({ ... }),
 * });
 * ```
 */
function defineTools<T extends Record<string, Tool>>(tools: T): ToolCollection<T> {
	return tools;
}

// =============================================================================
// MCP Namespace Export
// =============================================================================

/**
 * MCP tool annotation DSL.
 *
 * @example
 * ```typescript
 * import { mcp } from '@engram/graph/schema';
 *
 * export const mcpTools = mcp.defineTools({
 *   remember: mcp.tool({
 *     title: 'Remember',
 *     description: 'Store a memory for future recall',
 *     input: {
 *       content: mcp.param.string('The memory content to store'),
 *       type: mcp.param.enum(['decision', 'insight', 'preference'] as const).optional(),
 *       tags: mcp.param.array(mcp.param.string(), 'Keywords').optional(),
 *     },
 *     output: {
 *       id: mcp.param.string('Created memory ID'),
 *       stored: mcp.param.boolean('Success indicator'),
 *     },
 *   }),
 * });
 * ```
 */
export const mcp = {
	/**
	 * Parameter type factory.
	 */
	param,

	/**
	 * Define a single MCP tool.
	 */
	tool,

	/**
	 * Define a collection of MCP tools.
	 */
	defineTools,
} as const;

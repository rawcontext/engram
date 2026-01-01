/**
 * Field type primitives for the Schema DSL.
 *
 * This module provides a type-safe builder pattern for defining graph node fields.
 * Inspired by Drizzle ORM's column definitions with chainable modifiers.
 *
 * @example
 * ```typescript
 * const userSchema = {
 *   name: field.string().max(100),
 *   age: field.int().min(0).max(150).optional(),
 *   email: field.string().default("user@example.com"),
 *   tags: field.array(field.string()),
 *   role: field.enum(["admin", "user", "guest"] as const),
 *   embedding: field.vector(1536),
 * };
 * ```
 */

import type {
	ArrayFieldConfig,
	BooleanFieldConfig,
	EnumFieldConfig,
	Field,
	FloatFieldConfig,
	IntFieldConfig,
	StringFieldConfig,
	TimestampFieldConfig,
	VectorFieldConfig,
} from "./types";

// =============================================================================
// StringField
// =============================================================================

export class StringField implements Field<string> {
	readonly kind = "string" as const;
	readonly config: StringFieldConfig;

	constructor(config: StringFieldConfig = {}) {
		this.config = config;
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): StringField {
		return new StringField({ ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: string): StringField {
		return new StringField({ ...this.config, defaultValue: value });
	}

	/**
	 * Set maximum length constraint.
	 */
	max(length: number): StringField {
		return new StringField({ ...this.config, maxLength: length });
	}
}

// =============================================================================
// IntField
// =============================================================================

export class IntField implements Field<number> {
	readonly kind = "int" as const;
	readonly config: IntFieldConfig;

	constructor(config: IntFieldConfig = {}) {
		this.config = config;
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): IntField {
		return new IntField({ ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: number): IntField {
		return new IntField({ ...this.config, defaultValue: value });
	}

	/**
	 * Set minimum value constraint (inclusive).
	 */
	min(value: number): IntField {
		return new IntField({ ...this.config, min: value });
	}

	/**
	 * Set maximum value constraint (inclusive).
	 */
	max(value: number): IntField {
		return new IntField({ ...this.config, max: value });
	}
}

// =============================================================================
// FloatField
// =============================================================================

export class FloatField implements Field<number> {
	readonly kind = "float" as const;
	readonly config: FloatFieldConfig;

	constructor(config: FloatFieldConfig = {}) {
		this.config = config;
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): FloatField {
		return new FloatField({ ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: number): FloatField {
		return new FloatField({ ...this.config, defaultValue: value });
	}

	/**
	 * Set minimum value constraint (inclusive).
	 */
	min(value: number): FloatField {
		return new FloatField({ ...this.config, min: value });
	}

	/**
	 * Set maximum value constraint (inclusive).
	 */
	max(value: number): FloatField {
		return new FloatField({ ...this.config, max: value });
	}
}

// =============================================================================
// BooleanField
// =============================================================================

export class BooleanField implements Field<boolean> {
	readonly kind = "boolean" as const;
	readonly config: BooleanFieldConfig;

	constructor(config: BooleanFieldConfig = {}) {
		this.config = config;
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): BooleanField {
		return new BooleanField({ ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: boolean): BooleanField {
		return new BooleanField({ ...this.config, defaultValue: value });
	}
}

// =============================================================================
// TimestampField
// =============================================================================

export class TimestampField implements Field<number> {
	readonly kind = "timestamp" as const;
	readonly config: TimestampFieldConfig;

	constructor(config: TimestampFieldConfig = {}) {
		this.config = config;
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): TimestampField {
		return new TimestampField({ ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 * @param value - Epoch milliseconds
	 */
	default(value: number): TimestampField {
		return new TimestampField({ ...this.config, defaultValue: value });
	}
}

// =============================================================================
// ArrayField
// =============================================================================

export class ArrayField<T> implements Field<T[]> {
	readonly kind = "array" as const;
	readonly config: ArrayFieldConfig<T>;

	constructor(inner: Field<T>, config: Partial<ArrayFieldConfig<T>> = {}) {
		this.config = { ...config, inner };
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): ArrayField<T> {
		return new ArrayField(this.config.inner, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: T[]): ArrayField<T> {
		return new ArrayField(this.config.inner, { ...this.config, defaultValue: value });
	}
}

// =============================================================================
// EnumField
// =============================================================================

export class EnumField<T extends string> implements Field<T> {
	readonly kind = "enum" as const;
	readonly config: EnumFieldConfig<T>;

	constructor(values: readonly T[], config: Partial<EnumFieldConfig<T>> = {}) {
		this.config = { ...config, values };
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): EnumField<T> {
		return new EnumField(this.config.values, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: T): EnumField<T> {
		return new EnumField(this.config.values, { ...this.config, defaultValue: value });
	}
}

// =============================================================================
// VectorField
// =============================================================================

export class VectorField implements Field<number[]> {
	readonly kind = "vector" as const;
	readonly config: VectorFieldConfig;

	constructor(dimensions: number, config: Partial<VectorFieldConfig> = {}) {
		this.config = { ...config, dimensions };
	}

	/**
	 * Make this field optional (can be undefined).
	 */
	optional(): VectorField {
		return new VectorField(this.config.dimensions, { ...this.config, optional: true });
	}

	/**
	 * Set a default value for this field.
	 */
	default(value: number[]): VectorField {
		return new VectorField(this.config.dimensions, { ...this.config, defaultValue: value });
	}
}

// =============================================================================
// Field Factory
// =============================================================================

/**
 * Field type factory with builder pattern.
 *
 * @example
 * ```typescript
 * const schema = {
 *   name: field.string().max(100),
 *   age: field.int().min(0).max(150).optional(),
 *   email: field.string().default("user@example.com"),
 *   isActive: field.boolean().default(true),
 *   createdAt: field.timestamp(),
 *   tags: field.array(field.string()),
 *   role: field.enum(["admin", "user", "guest"] as const),
 *   embedding: field.vector(1536).optional(),
 * };
 * ```
 */
export const field = {
	/**
	 * Create a string field.
	 */
	string: (): StringField => new StringField(),

	/**
	 * Create an integer field.
	 */
	int: (): IntField => new IntField(),

	/**
	 * Create a float field for decimal numbers.
	 */
	float: (): FloatField => new FloatField(),

	/**
	 * Create a boolean field.
	 */
	boolean: (): BooleanField => new BooleanField(),

	/**
	 * Create a timestamp field (epoch milliseconds).
	 */
	timestamp: (): TimestampField => new TimestampField(),

	/**
	 * Create an array field with a specific element type.
	 * @param inner - The field type for array elements
	 */
	array: <T>(inner: Field<T>): ArrayField<T> => new ArrayField(inner),

	/**
	 * Create an enum field from a const array of string values.
	 * @param values - Readonly array of allowed values
	 */
	enum: <T extends string>(values: readonly T[]): EnumField<T> => new EnumField(values),

	/**
	 * Create a vector field for embeddings.
	 * @param dimensions - Dimensionality of the vector (e.g., 1536 for OpenAI)
	 */
	vector: (dimensions: number): VectorField => new VectorField(dimensions),
} as const;

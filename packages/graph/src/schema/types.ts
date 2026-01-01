/**
 * Shared type definitions for the Schema DSL.
 *
 * This module defines the core types and interfaces used throughout the schema system.
 */

// =============================================================================
// Field Type Kinds
// =============================================================================

/**
 * Discriminator for field types.
 * Used for type narrowing and runtime type checking.
 */
export type FieldKind =
	| "string"
	| "int"
	| "float"
	| "boolean"
	| "timestamp"
	| "array"
	| "enum"
	| "vector";

// =============================================================================
// Field Configuration
// =============================================================================

/**
 * Base configuration shared by all field types.
 */
export interface BaseFieldConfig {
	/**
	 * Whether the field is optional (can be undefined).
	 * @default false
	 */
	optional?: boolean;

	/**
	 * Default value for the field if not provided.
	 */
	defaultValue?: unknown;
}

/**
 * Configuration for string fields.
 */
export interface StringFieldConfig extends BaseFieldConfig {
	/**
	 * Maximum length constraint.
	 */
	maxLength?: number;
}

/**
 * Configuration for integer fields.
 */
export interface IntFieldConfig extends BaseFieldConfig {
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
 * Configuration for float fields.
 */
export interface FloatFieldConfig extends BaseFieldConfig {
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
 * Configuration for boolean fields.
 */
export interface BooleanFieldConfig extends BaseFieldConfig {}

/**
 * Configuration for timestamp fields.
 */
export interface TimestampFieldConfig extends BaseFieldConfig {}

/**
 * Configuration for array fields.
 */
export interface ArrayFieldConfig<T> extends BaseFieldConfig {
	/**
	 * The inner field type for array elements.
	 */
	inner: Field<T>;
}

/**
 * Configuration for enum fields.
 */
export interface EnumFieldConfig<T extends string> extends BaseFieldConfig {
	/**
	 * Allowed string values for the enum.
	 */
	values: readonly T[];
}

/**
 * Configuration for vector fields (embeddings).
 */
export interface VectorFieldConfig extends BaseFieldConfig {
	/**
	 * Dimensionality of the vector.
	 */
	dimensions: number;
}

// =============================================================================
// Field Interface
// =============================================================================

/**
 * Base interface for all field types.
 * @template T - The TypeScript type this field represents
 */
export interface Field<T = unknown> {
	/**
	 * Discriminator for the field type.
	 */
	readonly kind: FieldKind;

	/**
	 * Field configuration.
	 */
	readonly config: BaseFieldConfig;

	/**
	 * TypeScript type inference helper.
	 * This property is never actually set but is used for type inference.
	 */
	readonly __type?: T;
}

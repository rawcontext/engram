/**
 * Domain-specific error classes for the Engram system.
 *
 * These errors represent specific failure scenarios across the system.
 *
 * @module @engram/common/errors/domain
 */

import { EngramError } from "./base";

/**
 * Error codes for domain errors.
 */
export const ErrorCodes = {
	// Graph operations
	GRAPH_QUERY_FAILED: "GRAPH_QUERY_FAILED",
	GRAPH_CONNECTION_FAILED: "GRAPH_CONNECTION_FAILED",
	GRAPH_TRANSACTION_FAILED: "GRAPH_TRANSACTION_FAILED",

	// Parsing
	PARSE_JSON_FAILED: "PARSE_JSON_FAILED",
	PARSE_CYPHER_FAILED: "PARSE_CYPHER_FAILED",
	PARSE_EVENT_FAILED: "PARSE_EVENT_FAILED",

	// Validation
	VALIDATION_FAILED: "VALIDATION_FAILED",
	VALIDATION_SCHEMA_FAILED: "VALIDATION_SCHEMA_FAILED",
	VALIDATION_CONSTRAINT_FAILED: "VALIDATION_CONSTRAINT_FAILED",

	// Context assembly
	CONTEXT_ASSEMBLY_FAILED: "CONTEXT_ASSEMBLY_FAILED",
	CONTEXT_TIMEOUT: "CONTEXT_TIMEOUT",
	CONTEXT_LIMIT_EXCEEDED: "CONTEXT_LIMIT_EXCEEDED",

	// Rehydration
	REHYDRATION_FAILED: "REHYDRATION_FAILED",
	REHYDRATION_NOT_FOUND: "REHYDRATION_NOT_FOUND",
	REHYDRATION_CORRUPTED: "REHYDRATION_CORRUPTED",

	// Storage
	STORAGE_READ_FAILED: "STORAGE_READ_FAILED",
	STORAGE_WRITE_FAILED: "STORAGE_WRITE_FAILED",
	STORAGE_NOT_FOUND: "STORAGE_NOT_FOUND",
	STORAGE_INVALID_PATH: "STORAGE_INVALID_PATH",

	// Search
	SEARCH_QUERY_FAILED: "SEARCH_QUERY_FAILED",
	SEARCH_INDEX_FAILED: "SEARCH_INDEX_FAILED",
	SEARCH_EMBEDDING_FAILED: "SEARCH_EMBEDDING_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Error for FalkorDB graph operations.
 *
 * Thrown when graph queries, connections, or transactions fail.
 *
 * @example
 * ```ts
 * throw new GraphOperationError(
 *   "Failed to execute Cypher query",
 *   "MATCH (n) RETURN n LIMIT 10",
 *   originalError
 * );
 * ```
 */
export class GraphOperationError extends EngramError {
	/**
	 * The Cypher query that failed (if applicable).
	 */
	public readonly query?: string;

	/**
	 * Query parameters (if applicable).
	 */
	public readonly params?: Record<string, unknown>;

	constructor(message: string, query?: string, cause?: Error, params?: Record<string, unknown>) {
		super(message, ErrorCodes.GRAPH_QUERY_FAILED, cause);
		this.name = "GraphOperationError";
		this.query = query;
		this.params = params;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			query: this.query,
			params: this.params,
		};
	}
}

/**
 * Error for parsing failures.
 *
 * Thrown when JSON parsing, event parsing, or other deserialization fails.
 *
 * @example
 * ```ts
 * throw new ParseError("Invalid JSON in event payload", rawPayload, originalError);
 * ```
 */
export class ParseError extends EngramError {
	/**
	 * The raw input that failed to parse.
	 */
	public readonly input?: string;

	/**
	 * Expected format or type.
	 */
	public readonly expected?: string;

	constructor(message: string, input?: string, cause?: Error, expected?: string) {
		super(message, ErrorCodes.PARSE_JSON_FAILED, cause);
		this.name = "ParseError";
		this.input = input ? input.slice(0, 500) : undefined; // Truncate for logging
		this.expected = expected;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			input: this.input,
			expected: this.expected,
		};
	}
}

/**
 * Error for validation failures.
 *
 * Thrown when input validation, schema validation, or constraint checks fail.
 *
 * @example
 * ```ts
 * throw new ValidationError("Session ID is required", "sessionId");
 * ```
 */
export class ValidationError extends EngramError {
	/**
	 * The field or property that failed validation.
	 */
	public readonly field?: string;

	/**
	 * The invalid value that was provided.
	 */
	public readonly value?: unknown;

	/**
	 * Constraint that was violated.
	 */
	public readonly constraint?: string;

	constructor(
		message: string,
		field?: string,
		cause?: Error,
		options?: { value?: unknown; constraint?: string },
	) {
		super(message, ErrorCodes.VALIDATION_FAILED, cause);
		this.name = "ValidationError";
		this.field = field;
		this.value = options?.value;
		this.constraint = options?.constraint;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			field: this.field,
			value: this.value,
			constraint: this.constraint,
		};
	}
}

/**
 * Error for context assembly failures.
 *
 * Thrown when building context for agent interactions fails.
 *
 * @example
 * ```ts
 * throw new ContextAssemblyError(
 *   "Failed to assemble context within timeout",
 *   sessionId,
 *   timeoutError
 * );
 * ```
 */
export class ContextAssemblyError extends EngramError {
	/**
	 * Session ID for which context assembly failed.
	 */
	public readonly sessionId?: string;

	/**
	 * Partial context that was assembled before failure.
	 */
	public readonly partialContext?: unknown;

	constructor(message: string, sessionId?: string, cause?: Error, partialContext?: unknown) {
		super(message, ErrorCodes.CONTEXT_ASSEMBLY_FAILED, cause);
		this.name = "ContextAssemblyError";
		this.sessionId = sessionId;
		this.partialContext = partialContext;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			sessionId: this.sessionId,
			hasPartialContext: this.partialContext !== undefined,
		};
	}
}

/**
 * Error for state rehydration failures.
 *
 * Thrown when reconstructing state from persisted data fails.
 *
 * @example
 * ```ts
 * throw new RehydrationError("Session state corrupted", sessionId, corruptionError);
 * ```
 */
export class RehydrationError extends EngramError {
	/**
	 * Entity ID for which rehydration failed.
	 */
	public readonly entityId?: string;

	/**
	 * Type of entity being rehydrated.
	 */
	public readonly entityType?: string;

	constructor(message: string, entityId?: string, cause?: Error, entityType?: string) {
		super(message, ErrorCodes.REHYDRATION_FAILED, cause);
		this.name = "RehydrationError";
		this.entityId = entityId;
		this.entityType = entityType;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			entityId: this.entityId,
			entityType: this.entityType,
		};
	}
}

/**
 * Error for storage operations.
 *
 * Thrown when blob storage, file system, or database operations fail.
 *
 * @example
 * ```ts
 * throw new StorageError("Failed to read blob", uri, readError);
 * ```
 */
export class StorageError extends EngramError {
	/**
	 * URI or path of the storage resource.
	 */
	public readonly uri?: string;

	/**
	 * Type of storage operation that failed.
	 */
	public readonly operation?: "read" | "write" | "delete" | "list";

	constructor(
		message: string,
		code: ErrorCode,
		uri?: string,
		cause?: Error,
		operation?: "read" | "write" | "delete" | "list",
	) {
		super(message, code, cause);
		this.name = "StorageError";
		this.uri = uri;
		this.operation = operation;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			uri: this.uri,
			operation: this.operation,
		};
	}
}

/**
 * Error for search operations.
 *
 * Thrown when search queries, indexing, or embedding generation fails.
 *
 * @example
 * ```ts
 * throw new SearchError("Embedding generation failed", query, embeddingError);
 * ```
 */
export class SearchError extends EngramError {
	/**
	 * The search query that failed.
	 */
	public readonly query?: string;

	/**
	 * Search operation that failed.
	 */
	public readonly operation?: "query" | "index" | "embed" | "rerank";

	constructor(
		message: string,
		code: ErrorCode,
		query?: string,
		cause?: Error,
		operation?: "query" | "index" | "embed" | "rerank",
	) {
		super(message, code, cause);
		this.name = "SearchError";
		this.query = query;
		this.operation = operation;
	}

	override toJSON(): Record<string, unknown> {
		return {
			...super.toJSON(),
			query: this.query,
			operation: this.operation,
		};
	}
}

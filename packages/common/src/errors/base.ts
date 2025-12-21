/**
 * Base error class for the Engram system.
 *
 * All domain-specific errors should extend this class.
 *
 * @module @engram/common/errors/base
 */

/**
 * Base error class for all Engram errors.
 *
 * Provides structured error handling with:
 * - Error codes for programmatic handling
 * - Cause chaining for root cause analysis
 * - Consistent serialization for logging
 *
 * @example
 * ```ts
 * throw new EngramError("Operation failed", "OP_FAILED", originalError);
 * ```
 */
export class EngramError extends Error {
	/**
	 * Error code for programmatic error handling.
	 * Use SCREAMING_SNAKE_CASE (e.g., "GRAPH_QUERY_FAILED").
	 */
	public readonly code: string;

	/**
	 * Original error that caused this error.
	 * Enables error chaining for debugging.
	 */
	public readonly cause?: Error;

	/**
	 * Timestamp when the error was created.
	 */
	public readonly timestamp: number;

	constructor(message: string, code: string, cause?: Error) {
		super(message);
		this.name = "EngramError";
		this.code = code;
		this.cause = cause;
		this.timestamp = Date.now();

		// Maintains proper stack trace for where error was thrown
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, this.constructor);
		}
	}

	/**
	 * Convert error to a plain object for logging/serialization.
	 * Note: Stack traces are intentionally excluded to prevent information disclosure.
	 */
	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			timestamp: this.timestamp,
			cause: this.cause
				? {
						name: this.cause.name,
						message: this.cause.message,
					}
				: undefined,
		};
	}

	/**
	 * Create a formatted string representation for logging.
	 */
	toLogString(): string {
		const parts = [`[${this.code}] ${this.message}`];

		if (this.cause) {
			parts.push(`  Caused by: ${this.cause.message}`);
		}

		return parts.join("\n");
	}
}

/**
 * @engram/common - Shared utilities, errors, and constants for the Engram system.
 *
 * This package provides the foundation for all other packages and applications
 * in the Engram monorepo. It consolidates common patterns and eliminates
 * code duplication across the codebase.
 *
 * @example
 * ```ts
 * // Import utilities
 * import { envBool, sha256Hash, withRetry } from "@engram/common";
 *
 * // Import errors
 * import { GraphOperationError, ValidationError } from "@engram/common";
 *
 * // Import constants
 * import { GraphTimeouts, ContentLimits } from "@engram/common";
 *
 * // Or import from subpaths
 * import { envStr } from "@engram/common/utils";
 * import { EngramError } from "@engram/common/errors";
 * import { PruneIntervals } from "@engram/common/constants";
 * ```
 *
 * @module @engram/common
 */

// =============================================================================
// Utils
// =============================================================================

export type { RetryOptions } from "./utils";
export {
	envArray,
	// Environment helpers
	envBool,
	envFloat,
	envNum,
	envRequired,
	envStr,
	formatBytes,
	formatDuration,
	// Formatting utilities
	formatRelativeTime,
	hashObject,
	RetryableErrors,
	// Hash utilities
	sha256Hash,
	sha256Short,
	truncateId,
	truncateText,
	// Retry utilities
	withRetry,
} from "./utils";

// =============================================================================
// Errors
// =============================================================================

export type { ErrorCode } from "./errors";
export {
	ContextAssemblyError,
	// Base error
	EngramError,
	// Error codes
	ErrorCodes,
	// Domain errors
	GraphOperationError,
	ParseError,
	RehydrationError,
	SearchError,
	StorageError,
	ValidationError,
} from "./errors";

// =============================================================================
// Constants
// =============================================================================

export type { QdrantCollectionName } from "./constants";
export {
	BatchLimits,
	CacheTimeouts,
	// Limits
	ContentLimits,
	DebounceIntervals,
	// Timeouts
	GraphTimeouts,
	HttpTimeouts,
	// Qdrant
	MemoryVectorFields,
	PollIntervals,
	// Intervals
	PruneIntervals,
	QdrantCollections,
	QueryLimits,
	RateLimits,
	RetentionPeriods,
	SearchTimeouts,
	SessionLimits,
	ToolTimeouts,
	TurnsVectorFields,
	WebSocketIntervals,
} from "./constants";

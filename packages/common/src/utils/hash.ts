/**
 * Hashing utilities.
 *
 * Provides consistent hashing functions used across the codebase.
 *
 * @module @engram/common/utils/hash
 */

import { createHash } from "node:crypto";

/**
 * Generate a SHA-256 hash of the given content.
 *
 * Used for content-addressable storage, cache keys, and deduplication.
 *
 * @param content - Content to hash (string or Buffer)
 * @returns Hexadecimal hash string (64 characters)
 *
 * @example
 * ```ts
 * const hash = sha256Hash("Hello, World!");
 * // => "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"
 * ```
 */
export function sha256Hash(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

/**
 * Generate a short hash suitable for display or IDs.
 *
 * Returns the first `length` characters of a SHA-256 hash.
 *
 * @param content - Content to hash
 * @param length - Number of characters (default: 8)
 * @returns Truncated hexadecimal hash string
 *
 * @example
 * ```ts
 * const shortHash = sha256Short("Hello, World!");
 * // => "dffd6021"
 * ```
 */
export function sha256Short(content: string | Buffer, length: number = 8): string {
	return sha256Hash(content).slice(0, length);
}

/**
 * Generate a deterministic hash from a JSON-serializable object.
 *
 * Keys are sorted to ensure consistent hashing regardless of property order.
 * Handles null, undefined, and primitive values safely.
 *
 * @param obj - Object to hash
 * @returns Hexadecimal hash string
 *
 * @example
 * ```ts
 * const hash1 = hashObject({ b: 2, a: 1 });
 * const hash2 = hashObject({ a: 1, b: 2 });
 * // hash1 === hash2
 * ```
 */
export function hashObject(obj: unknown): string {
	// Handle null, undefined, and primitives
	if (obj === null || obj === undefined || typeof obj !== "object") {
		return sha256Hash(JSON.stringify(obj));
	}

	// Handle arrays
	if (Array.isArray(obj)) {
		return sha256Hash(JSON.stringify(obj));
	}

	// Handle objects with sorted keys
	const sortedKeys = Object.keys(obj).sort();
	const normalized = JSON.stringify(obj, sortedKeys);
	return sha256Hash(normalized);
}

/**
 * Formatting utilities.
 *
 * Provides consistent formatting functions for display and logging.
 *
 * @module @engram/common/utils/format
 */

/**
 * Format a timestamp as a relative time string.
 *
 * Used for displaying timestamps in a human-friendly format.
 *
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Relative time string (e.g., "now", "5m", "2h", "3d")
 *
 * @example
 * ```ts
 * formatRelativeTime(Date.now() - 30000); // => "now" (less than 1 minute)
 * formatRelativeTime(Date.now() - 300000); // => "5m"
 * formatRelativeTime(Date.now() - 7200000); // => "2h"
 * formatRelativeTime(Date.now() - 259200000); // => "3d"
 * ```
 */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	if (hours < 24) return `${hours}h`;
	if (days < 7) return `${days}d`;

	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

/**
 * Truncate an ID for display.
 *
 * Returns the first `length` characters of an ID, useful for UUIDs and hashes.
 *
 * @param id - ID to truncate
 * @param length - Maximum length (default: 8)
 * @returns Truncated ID
 *
 * @example
 * ```ts
 * truncateId("550e8400-e29b-41d4-a716-446655440000"); // => "550e8400"
 * truncateId("abc"); // => "abc"
 * ```
 */
export function truncateId(id: string, length: number = 8): string {
	if (id.length <= length) return id;
	return id.slice(0, length);
}

/**
 * Truncate text with ellipsis.
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length including ellipsis
 * @param ellipsis - Ellipsis string (default: "...")
 * @returns Truncated text
 *
 * @example
 * ```ts
 * truncateText("Hello, World!", 10); // => "Hello, ..."
 * truncateText("Hi", 10); // => "Hi"
 * ```
 */
export function truncateText(text: string, maxLength: number, ellipsis: string = "..."): string {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Format bytes as a human-readable string.
 *
 * @param bytes - Number of bytes
 * @param decimals - Decimal places (default: 2)
 * @returns Formatted string (e.g., "1.5 KB", "2.3 MB")
 *
 * @example
 * ```ts
 * formatBytes(1024); // => "1 KB"
 * formatBytes(1536); // => "1.5 KB"
 * formatBytes(1048576); // => "1 MB"
 * ```
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
	if (bytes === 0) return "0 Bytes";
	if (bytes < 0) return formatBytes(Math.abs(bytes), decimals);

	const k = 1024;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));

	// Clamp index to array bounds to handle very large values
	const boundedIndex = Math.min(Math.max(0, i), sizes.length - 1);

	return `${Number.parseFloat((bytes / k ** boundedIndex).toFixed(decimals))} ${sizes[boundedIndex]}`;
}

/**
 * Format milliseconds as a human-readable duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted duration (e.g., "1.5s", "250ms", "2m 30s")
 *
 * @example
 * ```ts
 * formatDuration(150); // => "150ms"
 * formatDuration(1500); // => "1.5s"
 * formatDuration(90000); // => "1m 30s"
 * ```
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;

	const minutes = Math.floor(ms / 60000);
	const seconds = Math.floor((ms % 60000) / 1000);

	if (seconds === 0) return `${minutes}m`;
	return `${minutes}m ${seconds}s`;
}

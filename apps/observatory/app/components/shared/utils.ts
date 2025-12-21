/**
 * Shared utility functions
 * Extracted from duplicated implementations across components
 */

/**
 * Format a timestamp as a relative time string (e.g., "5m", "2h", "3d")
 */
export function formatRelativeTime(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	const seconds = Math.floor(diff / 1000);
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (seconds < 60) return "now";
	if (minutes < 60) return `${minutes}m`;
	if (hours < 24) return `${hours}h`;
	if (days < 7) return `${days}d`;

	return new Date(timestamp).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	});
}

/**
 * Format a timestamp as a human-readable "time ago" string
 */
export function formatTimeAgo(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diff = now.getTime() - date.getTime();

	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 7) return `${days}d ago`;

	return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Truncate a UUID or long ID to a shorter display form
 */
export function truncateId(id: string, length = 8): string {
	if (id.length <= length) return id;
	return id.slice(0, length);
}

/**
 * Truncate content with ellipsis
 */
export function truncateContent(content: string, maxLength = 120): string {
	if (content.length <= maxLength) return content;
	return `${content.slice(0, maxLength).trim()}...`;
}

/**
 * Format a timestamp as HH:MM:SS
 */
export function formatTime(timestamp: string | number): string {
	try {
		const date = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp);
		return date.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return "";
	}
}

/**
 * Generate activity bar segments based on a value (for visualization)
 */
export function getActivityLevel(value: number, max = 300, segments = 5): number[] {
	const normalized = Math.min(value / max, 1);
	const filled = Math.ceil(normalized * segments);
	return Array.from({ length: segments }, (_, i) => (i < filled ? 1 : 0.15));
}

/**
 * Check if a string is a valid UUID
 */
export function isUUID(str: string): boolean {
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	return uuidRegex.test(str);
}

/**
 * Create a CSS animation delay based on index for staggered animations
 */
export function staggerDelay(index: number, baseDelay = 0.05): string {
	return `${index * baseDelay}s`;
}

/**
 * Tests for @engram/common/utils/format
 */

import { describe, expect, it } from "vitest";
import {
	formatBytes,
	formatDuration,
	formatRelativeTime,
	truncateId,
	truncateText,
} from "./format";

describe("formatRelativeTime", () => {
	it("should return 'now' for time less than 1 minute ago", () => {
		// Arrange
		const timestamp = Date.now() - 30000; // 30 seconds ago

		// Act
		const result = formatRelativeTime(timestamp);

		// Assert
		expect(result).toBe("now");
	});

	it("should return minutes for time less than 1 hour ago", () => {
		// Arrange
		const timestamp = Date.now() - 5 * 60000; // 5 minutes ago

		// Act
		const result = formatRelativeTime(timestamp);

		// Assert
		expect(result).toBe("5m");
	});

	it("should return hours for time less than 24 hours ago", () => {
		// Arrange
		const timestamp = Date.now() - 2 * 3600000; // 2 hours ago

		// Act
		const result = formatRelativeTime(timestamp);

		// Assert
		expect(result).toBe("2h");
	});

	it("should return days for time less than 7 days ago", () => {
		// Arrange
		const timestamp = Date.now() - 3 * 86400000; // 3 days ago

		// Act
		const result = formatRelativeTime(timestamp);

		// Assert
		expect(result).toBe("3d");
	});

	it("should return formatted date for time 7 days or more ago", () => {
		// Arrange
		const timestamp = Date.now() - 10 * 86400000; // 10 days ago

		// Act
		const result = formatRelativeTime(timestamp);

		// Assert
		expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/); // e.g., "Jan 15"
	});

	it("should handle edge case of exactly 1 minute", () => {
		// Arrange
		const timestamp = Date.now() - 60000; // 1 minute ago

		// Act
		const result = formatRelativeTime(timestamp);

		// Assert
		expect(result).toBe("1m");
	});
});

describe("truncateId", () => {
	it("should truncate long IDs to 8 characters by default", () => {
		// Arrange
		const longId = "550e8400-e29b-41d4-a716-446655440000";

		// Act
		const result = truncateId(longId);

		// Assert
		expect(result).toBe("550e8400");
		expect(result).toHaveLength(8);
	});

	it("should return full ID if shorter than length", () => {
		// Arrange
		const shortId = "abc";

		// Act
		const result = truncateId(shortId);

		// Assert
		expect(result).toBe("abc");
	});

	it("should respect custom length", () => {
		// Arrange
		const id = "abcdefghijklmnop";

		// Act
		const result = truncateId(id, 12);

		// Assert
		expect(result).toBe("abcdefghijkl");
		expect(result).toHaveLength(12);
	});

	it("should return full ID if exactly equal to length", () => {
		// Arrange
		const id = "12345678";

		// Act
		const result = truncateId(id, 8);

		// Assert
		expect(result).toBe("12345678");
	});
});

describe("truncateText", () => {
	it("should truncate long text with ellipsis", () => {
		// Arrange
		const text = "Hello, World! This is a long text.";

		// Act
		const result = truncateText(text, 15);

		// Assert
		expect(result).toHaveLength(15);
		expect(result.endsWith("...")).toBe(true);
		expect(result.startsWith("Hello")).toBe(true);
	});

	it("should return full text if shorter than maxLength", () => {
		// Arrange
		const text = "Hi";

		// Act
		const result = truncateText(text, 10);

		// Assert
		expect(result).toBe("Hi");
	});

	it("should use custom ellipsis", () => {
		// Arrange
		const text = "This is a very long text";

		// Act
		const result = truncateText(text, 12, "...");

		// Assert
		expect(result).toHaveLength(12);
		expect(result.endsWith("...")).toBe(true);
	});

	it("should handle empty string", () => {
		// Act
		const result = truncateText("", 10);

		// Assert
		expect(result).toBe("");
	});

	it("should handle maxLength exactly equal to text length", () => {
		// Arrange
		const text = "exactly";

		// Act
		const result = truncateText(text, 7);

		// Assert
		expect(result).toBe("exactly");
	});
});

describe("formatBytes", () => {
	it("should format 0 bytes", () => {
		// Act
		const result = formatBytes(0);

		// Assert
		expect(result).toBe("0 Bytes");
	});

	it("should format bytes", () => {
		// Act
		const result = formatBytes(512);

		// Assert
		expect(result).toBe("512 Bytes");
	});

	it("should format kilobytes", () => {
		// Act
		const result = formatBytes(1024);

		// Assert
		expect(result).toBe("1 KB");
	});

	it("should format kilobytes with decimals", () => {
		// Act
		const result = formatBytes(1536);

		// Assert
		expect(result).toBe("1.5 KB");
	});

	it("should format megabytes", () => {
		// Act
		const result = formatBytes(1048576);

		// Assert
		expect(result).toBe("1 MB");
	});

	it("should format gigabytes", () => {
		// Act
		const result = formatBytes(1073741824);

		// Assert
		expect(result).toBe("1 GB");
	});

	it("should format terabytes", () => {
		// Act
		const result = formatBytes(1099511627776);

		// Assert
		expect(result).toBe("1 TB");
	});

	it("should respect decimal places", () => {
		// Act
		const result = formatBytes(1536, 3);

		// Assert
		expect(result).toBe("1.5 KB");
	});

	it("should handle negative bytes", () => {
		// Act
		const result = formatBytes(-1024);

		// Assert
		expect(result).toBe("1 KB");
	});

	it("should handle very large values", () => {
		// Arrange - value larger than TB
		const veryLarge = 2 * 1099511627776; // 2 TB

		// Act
		const result = formatBytes(veryLarge);

		// Assert
		expect(result).toBe("2 TB");
	});

	it("should handle extremely large values beyond TB", () => {
		// Arrange - value much larger than TB to test bounds clamping
		const extremelyLarge = 1024 * 1024 * 1024 * 1024 * 1024; // 1024 TB (1 PB)

		// Act
		const result = formatBytes(extremelyLarge);

		// Assert
		expect(result).toContain("TB"); // Should clamp to TB (max in sizes array)
	});

	it("should handle 1 byte", () => {
		// Act
		const result = formatBytes(1);

		// Assert
		expect(result).toBe("1 Bytes");
	});

	it("should handle decimal precision correctly", () => {
		// Act
		const result = formatBytes(1536, 0);

		// Assert
		expect(result).toBe("2 KB"); // Rounded up
	});
});

describe("formatDuration", () => {
	it("should format milliseconds", () => {
		// Act
		const result = formatDuration(150);

		// Assert
		expect(result).toBe("150ms");
	});

	it("should format seconds", () => {
		// Act
		const result = formatDuration(1500);

		// Assert
		expect(result).toBe("1.5s");
	});

	it("should format minutes without seconds", () => {
		// Act
		const result = formatDuration(120000); // 2 minutes exactly

		// Assert
		expect(result).toBe("2m");
	});

	it("should format minutes with seconds", () => {
		// Act
		const result = formatDuration(90000); // 1 minute 30 seconds

		// Assert
		expect(result).toBe("1m 30s");
	});

	it("should handle edge case of exactly 1 second", () => {
		// Act
		const result = formatDuration(1000);

		// Assert
		expect(result).toBe("1.0s");
	});

	it("should handle 0 milliseconds", () => {
		// Act
		const result = formatDuration(0);

		// Assert
		expect(result).toBe("0ms");
	});

	it("should format long durations", () => {
		// Act - 5 minutes 45 seconds
		const result = formatDuration(345000);

		// Assert
		expect(result).toBe("5m 45s");
	});

	it("should handle milliseconds just under 1 second", () => {
		// Act
		const result = formatDuration(999);

		// Assert
		expect(result).toBe("999ms");
	});

	it("should handle exactly 60 seconds (1 minute)", () => {
		// Act
		const result = formatDuration(60000);

		// Assert
		expect(result).toBe("1m");
	});

	it("should format very long durations", () => {
		// Act - 10 minutes 30 seconds
		const result = formatDuration(630000);

		// Assert
		expect(result).toBe("10m 30s");
	});
});

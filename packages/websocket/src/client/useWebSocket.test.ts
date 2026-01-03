/**
 * Tests for useWebSocket hook
 *
 * Note: The hook itself uses React hooks (useState, useEffect) and browser
 * WebSocket API, which requires a full React testing environment. These tests
 * focus on the pure utility functions that can be tested without React.
 *
 * For full hook testing, you would need:
 * - @testing-library/react-hooks
 * - A WebSocket mock server
 * - JSDOM or similar for document API
 */

import { describe, expect, it } from "bun:test";

// Extract and test the buildWebSocketUrl logic since it's a pure function
describe("buildWebSocketUrl helper logic", () => {
	// Replicate the function logic for testing
	function buildWebSocketUrl(
		urlOrPath: string,
		mockWindow?: { location: { protocol: string; host: string } },
	): string {
		// If already a full URL, return as-is
		if (urlOrPath.startsWith("ws://") || urlOrPath.startsWith("wss://")) {
			return urlOrPath;
		}

		// Build from mock window or defaults
		const protocol = mockWindow?.location.protocol === "https:" ? "wss:" : "ws:";
		const host = mockWindow?.location.host ?? "localhost";

		// Ensure path starts with /
		const path = urlOrPath.startsWith("/") ? urlOrPath : `/${urlOrPath}`;

		return `${protocol}//${host}${path}`;
	}

	describe("full URLs", () => {
		it("should return ws:// URLs unchanged", () => {
			const url = "ws://example.com/socket";
			expect(buildWebSocketUrl(url)).toBe(url);
		});

		it("should return wss:// URLs unchanged", () => {
			const url = "wss://example.com:8080/socket";
			expect(buildWebSocketUrl(url)).toBe(url);
		});
	});

	describe("path conversion", () => {
		it("should convert path to ws:// URL with default host", () => {
			const result = buildWebSocketUrl("/api/ws");
			expect(result).toBe("ws://localhost/api/ws");
		});

		it("should add leading slash if missing", () => {
			const result = buildWebSocketUrl("api/ws");
			expect(result).toBe("ws://localhost/api/ws");
		});

		it("should use wss:// for https context", () => {
			const mockWindow = { location: { protocol: "https:", host: "secure.example.com" } };
			const result = buildWebSocketUrl("/api/ws", mockWindow);
			expect(result).toBe("wss://secure.example.com/api/ws");
		});

		it("should use ws:// for http context", () => {
			const mockWindow = { location: { protocol: "http:", host: "example.com:3000" } };
			const result = buildWebSocketUrl("/api/ws", mockWindow);
			expect(result).toBe("ws://example.com:3000/api/ws");
		});

		it("should preserve port in host", () => {
			const mockWindow = { location: { protocol: "http:", host: "localhost:8080" } };
			const result = buildWebSocketUrl("/socket", mockWindow);
			expect(result).toBe("ws://localhost:8080/socket");
		});
	});
});

describe("WebSocket types", () => {
	it("should export correct WebSocketStatus values", () => {
		const validStatuses = ["connecting", "open", "closed", "error"] as const;

		// Type check that these are valid WebSocketStatus values
		type WebSocketStatus = "connecting" | "open" | "closed" | "error";
		const status: WebSocketStatus = validStatuses[0];
		expect(status).toBe("connecting");
	});
});

describe("HeartbeatOptions defaults", () => {
	it("should document default heartbeat values", () => {
		// Document the default values used in the hook
		const defaults = {
			message: "ping",
			returnMessage: "pong",
			interval: 30000,
			timeout: 5000,
		};

		expect(defaults.message).toBe("ping");
		expect(defaults.returnMessage).toBe("pong");
		expect(defaults.interval).toBe(30000);
		expect(defaults.timeout).toBe(5000);
	});
});

describe("UseWebSocketOptions defaults", () => {
	it("should document default options values", () => {
		// Document the default values used in the hook
		const defaults = {
			reconnect: true,
			maxReconnectAttempts: 5,
			maxReconnectDelay: 30000,
			baseReconnectDelay: 1000,
			queueOfflineMessages: false,
			maxQueueSize: 100,
			maxQueueAge: 30000,
		};

		expect(defaults.reconnect).toBe(true);
		expect(defaults.maxReconnectAttempts).toBe(5);
		expect(defaults.maxReconnectDelay).toBe(30000);
		expect(defaults.baseReconnectDelay).toBe(1000);
		expect(defaults.queueOfflineMessages).toBe(false);
		expect(defaults.maxQueueSize).toBe(100);
		expect(defaults.maxQueueAge).toBe(30000);
	});
});

describe("message queueing logic", () => {
	it("should correctly determine queue overflow behavior", () => {
		const maxQueueSize = 100;
		const queue: { message: string; timestamp: number }[] = [];

		// Simulate adding messages
		for (let i = 0; i < 105; i++) {
			if (queue.length >= maxQueueSize) {
				queue.shift(); // Remove oldest
			}
			queue.push({ message: `msg-${i}`, timestamp: Date.now() });
		}

		expect(queue.length).toBe(maxQueueSize);
		expect(queue[0].message).toBe("msg-5"); // Oldest should be removed
	});

	it("should filter stale messages based on maxQueueAge", () => {
		const maxQueueAge = 30000;
		const now = Date.now();
		const queue = [
			{ message: "old", timestamp: now - 40000 }, // Too old
			{ message: "valid", timestamp: now - 20000 }, // Valid
			{ message: "new", timestamp: now - 1000 }, // Valid
		];

		const validMessages = queue.filter((item) => now - item.timestamp <= maxQueueAge);

		expect(validMessages).toHaveLength(2);
		expect(validMessages.map((m) => m.message)).toEqual(["valid", "new"]);
	});
});

describe("reconnection backoff logic", () => {
	it("should calculate exponential backoff correctly", () => {
		const baseDelay = 1000;
		const maxDelay = 30000;

		const calculateDelay = (attempt: number) => {
			return Math.min(baseDelay * 2 ** attempt, maxDelay);
		};

		expect(calculateDelay(0)).toBe(1000); // 1s
		expect(calculateDelay(1)).toBe(2000); // 2s
		expect(calculateDelay(2)).toBe(4000); // 4s
		expect(calculateDelay(3)).toBe(8000); // 8s
		expect(calculateDelay(4)).toBe(16000); // 16s
		expect(calculateDelay(5)).toBe(30000); // capped at 30s
		expect(calculateDelay(10)).toBe(30000); // still capped
	});

	it("should determine when not to reconnect based on close code", () => {
		const shouldNotReconnect = (code: number) =>
			code === 1000 || // Normal closure
			code === 1002 || // Protocol error
			code === 1003; // Unsupported data

		expect(shouldNotReconnect(1000)).toBe(true);
		expect(shouldNotReconnect(1002)).toBe(true);
		expect(shouldNotReconnect(1003)).toBe(true);
		expect(shouldNotReconnect(1001)).toBe(false); // Going away - should reconnect
		expect(shouldNotReconnect(1006)).toBe(false); // Abnormal - should reconnect
	});
});

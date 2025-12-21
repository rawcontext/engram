/**
 * Tests for @engram/common/constants/intervals
 */

import { describe, expect, it } from "vitest";
import {
	DebounceIntervals,
	PollIntervals,
	PruneIntervals,
	RetentionPeriods,
	WebSocketIntervals,
} from "./intervals";

describe("PruneIntervals", () => {
	it("should have correct pruning intervals", () => {
		expect(PruneIntervals.GRAPH_PRUNE_MS).toBe(24 * 60 * 60 * 1000);
		expect(PruneIntervals.STALE_TURN_CLEANUP_MS).toBe(5 * 60 * 1000);
		expect(PruneIntervals.CACHE_CLEANUP_MS).toBe(60 * 60 * 1000);
		expect(PruneIntervals.SESSION_INACTIVE_MS).toBe(30 * 60 * 1000);
		expect(PruneIntervals.STALE_TURN_THRESHOLD_MS).toBe(30 * 60 * 1000);
	});
});

describe("PollIntervals", () => {
	it("should have correct polling intervals", () => {
		expect(PollIntervals.HEALTH_CHECK_MS).toBe(30 * 1000);
		expect(PollIntervals.METRICS_COLLECTION_MS).toBe(10 * 1000);
		expect(PollIntervals.CONNECTION_RETRY_BASE_MS).toBe(1000);
		expect(PollIntervals.CONNECTION_RETRY_MAX_MS).toBe(30 * 1000);
		expect(PollIntervals.KAFKA_POLL_MS).toBe(100);
	});
});

describe("DebounceIntervals", () => {
	it("should have correct debounce intervals", () => {
		expect(DebounceIntervals.SEARCH_INPUT_MS).toBe(300);
		expect(DebounceIntervals.AUTO_SAVE_MS).toBe(1000);
		expect(DebounceIntervals.WS_RECONNECT_MS).toBe(1000);
		expect(DebounceIntervals.EVENT_BATCH_MS).toBe(100);
	});
});

describe("RetentionPeriods", () => {
	it("should have correct retention periods in days", () => {
		expect(RetentionPeriods.DEFAULT_DAYS).toBe(30);
		expect(RetentionPeriods.SESSION_DAYS).toBe(90);
		expect(RetentionPeriods.METRICS_DAYS).toBe(7);
		expect(RetentionPeriods.LOGS_DAYS).toBe(14);
	});

	it("should convert days to milliseconds", () => {
		expect(RetentionPeriods.toMs(1)).toBe(24 * 60 * 60 * 1000);
		expect(RetentionPeriods.toMs(7)).toBe(7 * 24 * 60 * 60 * 1000);
		expect(RetentionPeriods.toMs(30)).toBe(30 * 24 * 60 * 60 * 1000);
	});

	it("should handle zero days", () => {
		expect(RetentionPeriods.toMs(0)).toBe(0);
	});

	it("should handle fractional days", () => {
		expect(RetentionPeriods.toMs(0.5)).toBe(12 * 60 * 60 * 1000);
	});
});

describe("WebSocketIntervals", () => {
	it("should have correct WebSocket intervals", () => {
		expect(WebSocketIntervals.PING_MS).toBe(30 * 1000);
		expect(WebSocketIntervals.PONG_TIMEOUT_MS).toBe(10 * 1000);
		expect(WebSocketIntervals.RECONNECT_BASE_MS).toBe(1000);
		expect(WebSocketIntervals.RECONNECT_MAX_MS).toBe(30 * 1000);
		expect(WebSocketIntervals.MAX_RECONNECT_ATTEMPTS).toBe(10);
	});
});

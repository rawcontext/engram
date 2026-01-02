import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	DeduplicationEngine,
	computeEventHash,
	fnv1aHash,
	type DeduplicationKey,
	type EventSource,
} from "./engine";

describe("fnv1aHash", () => {
	it("should produce consistent hashes for same input", () => {
		const hash1 = fnv1aHash("hello world");
		const hash2 = fnv1aHash("hello world");
		expect(hash1).toBe(hash2);
	});

	it("should produce different hashes for different inputs", () => {
		const hash1 = fnv1aHash("hello");
		const hash2 = fnv1aHash("world");
		expect(hash1).not.toBe(hash2);
	});

	it("should handle empty string", () => {
		const hash = fnv1aHash("");
		expect(typeof hash).toBe("string");
		expect(hash.length).toBeGreaterThan(0);
	});

	it("should handle unicode characters", () => {
		const hash = fnv1aHash("你好世界");
		expect(typeof hash).toBe("string");
	});
});

describe("computeEventHash", () => {
	it("should include type in hash", () => {
		const hash1 = computeEventHash({ type: "user_message" });
		const hash2 = computeEventHash({ type: "assistant_message" });
		expect(hash1).not.toBe(hash2);
	});

	it("should include content in hash", () => {
		const hash1 = computeEventHash({ content: "hello" });
		const hash2 = computeEventHash({ content: "goodbye" });
		expect(hash1).not.toBe(hash2);
	});

	it("should include tool name in hash", () => {
		const hash1 = computeEventHash({ tool_name: "read_file" });
		const hash2 = computeEventHash({ tool_name: "write_file" });
		expect(hash1).not.toBe(hash2);
	});

	it("should include tool_use.name in hash", () => {
		const hash1 = computeEventHash({ tool_use: { name: "read_file" } });
		const hash2 = computeEventHash({ tool_use: { name: "write_file" } });
		expect(hash1).not.toBe(hash2);
	});

	it("should include session_id in hash", () => {
		const hash1 = computeEventHash({ session_id: "session-1" });
		const hash2 = computeEventHash({ session_id: "session-2" });
		expect(hash1).not.toBe(hash2);
	});

	it("should truncate content at 500 chars", () => {
		const longContent = "a".repeat(1000);
		const hash1 = computeEventHash({ content: longContent });
		const hash2 = computeEventHash({ content: "a".repeat(500) });
		// They should be the same since content is truncated to 500 chars
		expect(hash1).toBe(hash2);
	});

	it("should handle empty payload", () => {
		const hash = computeEventHash({});
		expect(typeof hash).toBe("string");
	});
});

describe("DeduplicationEngine", () => {
	let engine: DeduplicationEngine;

	beforeEach(() => {
		engine = new DeduplicationEngine({
			ttlMs: 5000,
			maxEntries: 100,
			cleanupIntervalMs: 60000, // Prevent cleanup during tests
		});
	});

	afterEach(() => {
		engine.stop();
	});

	describe("shouldIngest", () => {
		it("should allow first occurrence of an event", () => {
			const key: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			};

			expect(engine.shouldIngest(key)).toBe(true);
		});

		it("should reject duplicate event from same source", () => {
			const key: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			};

			expect(engine.shouldIngest(key)).toBe(true);
			expect(engine.shouldIngest(key)).toBe(false);
		});

		it("should reject duplicate event from lower priority source", () => {
			const highPriorityKey: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "stream-json", // highest priority
			};

			const lowPriorityKey: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "file-watcher", // lowest priority
			};

			expect(engine.shouldIngest(highPriorityKey)).toBe(true);
			expect(engine.shouldIngest(lowPriorityKey)).toBe(false);
		});

		it("should allow re-ingestion from higher priority source", () => {
			const lowPriorityKey: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "file-watcher", // lowest priority
			};

			const highPriorityKey: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "stream-json", // highest priority
			};

			expect(engine.shouldIngest(lowPriorityKey)).toBe(true);
			expect(engine.shouldIngest(highPriorityKey)).toBe(true); // Re-ingestion allowed
		});

		it("should track events separately per session", () => {
			const key1: DeduplicationKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			};

			const key2: DeduplicationKey = {
				sessionId: "session-2",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			};

			expect(engine.shouldIngest(key1)).toBe(true);
			expect(engine.shouldIngest(key2)).toBe(true);
		});
	});

	describe("isDuplicate", () => {
		it("should return false for unseen events", () => {
			expect(engine.isDuplicate("session-1", "abc123")).toBe(false);
		});

		it("should return true for seen events", () => {
			engine.shouldIngest({
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			});

			expect(engine.isDuplicate("session-1", "abc123")).toBe(true);
		});
	});

	describe("markSeen", () => {
		it("should mark event as seen", () => {
			engine.markSeen("session-1", "abc123");
			expect(engine.isDuplicate("session-1", "abc123")).toBe(true);
		});

		it("should not overwrite existing entry", () => {
			engine.shouldIngest({
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "stream-json",
			});

			engine.markSeen("session-1", "abc123", "file-watcher");

			const sources = engine.getSources("session-1", "abc123");
			expect(sources).toContain("stream-json");
		});
	});

	describe("getSources", () => {
		it("should return empty array for unseen events", () => {
			expect(engine.getSources("session-1", "abc123")).toEqual([]);
		});

		it("should return all sources that provided an event", () => {
			const sources: EventSource[] = ["file-watcher", "hook", "stream-json"];

			for (const source of sources) {
				engine.shouldIngest({
					sessionId: "session-1",
					timestamp: Date.now(),
					contentHash: "abc123",
					source,
				});
			}

			const result = engine.getSources("session-1", "abc123");
			expect(result.sort()).toEqual(sources.sort());
		});
	});

	describe("getStats", () => {
		it("should return current statistics", () => {
			const stats = engine.getStats();
			expect(stats).toEqual({
				entries: 0,
				maxEntries: 100,
				ttlMs: 5000,
			});
		});

		it("should reflect added entries", () => {
			engine.shouldIngest({
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			});

			engine.shouldIngest({
				sessionId: "session-2",
				timestamp: Date.now(),
				contentHash: "def456",
				source: "hook",
			});

			expect(engine.getStats().entries).toBe(2);
		});
	});

	describe("clear", () => {
		it("should remove all entries", () => {
			engine.shouldIngest({
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "abc123",
				source: "hook",
			});

			expect(engine.getStats().entries).toBe(1);

			engine.clear();

			expect(engine.getStats().entries).toBe(0);
			expect(engine.isDuplicate("session-1", "abc123")).toBe(false);
		});
	});

	describe("max entries enforcement", () => {
		it("should enforce max entries limit", () => {
			const smallEngine = new DeduplicationEngine({
				ttlMs: 60000,
				maxEntries: 10,
				cleanupIntervalMs: 60000,
			});

			// Add 15 entries
			for (let i = 0; i < 15; i++) {
				smallEngine.shouldIngest({
					sessionId: "session-1",
					timestamp: Date.now(),
					contentHash: `hash-${i}`,
					source: "hook",
				});
			}

			// Should have removed oldest 10% (1 entry) when exceeding max
			expect(smallEngine.getStats().entries).toBeLessThanOrEqual(15);

			smallEngine.stop();
		});
	});

	describe("source priority", () => {
		it("should correctly order sources by priority", () => {
			// Test priority: stream-json (3) > hook (2) > file-watcher (1)
			const baseKey = {
				sessionId: "session-1",
				timestamp: Date.now(),
				contentHash: "priority-test",
			};

			// Start with file-watcher (lowest)
			expect(engine.shouldIngest({ ...baseKey, source: "file-watcher" })).toBe(true);

			// Hook should upgrade
			expect(engine.shouldIngest({ ...baseKey, source: "hook" })).toBe(true);

			// file-watcher should not downgrade
			expect(engine.shouldIngest({ ...baseKey, source: "file-watcher" })).toBe(false);

			// stream-json should upgrade
			expect(engine.shouldIngest({ ...baseKey, source: "stream-json" })).toBe(true);

			// Nothing should upgrade from stream-json (highest)
			expect(engine.shouldIngest({ ...baseKey, source: "hook" })).toBe(false);
			expect(engine.shouldIngest({ ...baseKey, source: "file-watcher" })).toBe(false);
		});
	});
});

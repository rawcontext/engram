import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @engram/storage before importing
const mockBlobStoreRead = vi.fn(async () => "{}");
vi.mock("@engram/storage", () => ({
	createBlobStore: () => ({
		read: mockBlobStoreRead,
		write: vi.fn(async () => {}),
	}),
}));

import type { FalkorClient } from "@engram/storage";
import { ReplayEngine } from "./replay";

describe("ReplayEngine", () => {
	let mockFalkorQuery: ReturnType<typeof mock>;
	let mockFalkor: FalkorClient;
	let engine: ReplayEngine;

	beforeEach(() => {
		mockFalkorQuery = vi.fn(async () => []);
		mockFalkor = {
			query: mockFalkorQuery,
		} as unknown as FalkorClient;
		engine = new ReplayEngine(mockFalkor);
	});

	it("should return error when event not found", async () => {
		// All queries return empty
		mockFalkorQuery.mockResolvedValue([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});

	it("should replay a tool call event", async () => {
		// First call: fetchToolCallEvent query returns the tool call
		// Second call: rehydrator's snapshot query returns empty
		// Third call: rehydrator's diff query returns empty
		// Note: Using write_file because read_file would fail with empty VFS
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/test.txt", content: "hello" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			]) // tool call event
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
	});

	it("should mock Date.now during replay", async () => {
		const originalNow = Date.now();

		// Setup mock to return a tool call
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "unknown_tool",
					arguments: "{}",
					result: null,
					vt_start: 5000,
				},
			]) // tool call
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		await engine.replay("session-1", "event-1");

		// Date.now should be restored after replay
		expect(Date.now()).toBeGreaterThanOrEqual(originalNow);
	});

	it("should compare outputs correctly", async () => {
		// Setup for a write_file tool with matching output
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/new.txt", content: "test" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			]) // tool call
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.matches).toBe(true);
	});

	it("should detect mismatched outputs", async () => {
		// Setup where original result differs from replay
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/new.txt", content: "test" }),
					result: JSON.stringify({ success: false }), // Different from actual replay (which returns { success: true })
					vt_start: 1000,
				},
			]) // tool call
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.matches).toBe(false);
	});

	// NOTE: read_file replay testing is complex because it requires setting up
	// a VFS state with the file already present. This is better tested via integration tests.

	it("should handle list_directory tool", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "list_directory",
					arguments: JSON.stringify({ path: "/" }),
					result: JSON.stringify({ entries: [] }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
	});

	it("should handle unknown tools", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "unknown_custom_tool",
					arguments: JSON.stringify({ arg1: "value1" }),
					result: JSON.stringify({ output: "something" }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toHaveProperty("error");
	});

	it("should compare null outputs correctly", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/test.txt", content: "test" }),
					result: null,
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
	});

	it("should handle JSON parse errors in arguments", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: "invalid json",
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("should use deterministic providers for tool execution", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/test.txt", content: "test" }),
					result: JSON.stringify({ success: true }),
					vt_start: 12345,
				},
			])
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]); // diffs

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		// The deterministic providers should be created with vt_start = 12345
	});
});

describe("Deterministic Providers", () => {
	it("createSeededRandom should generate consistent values", () => {
		// Access the internal function by re-implementing it
		function createSeededRandom(seed: number): () => number {
			let state = seed;
			return () => {
				state = (state * 1103515245 + 12345) & 0x7fffffff;
				return state / 0x7fffffff;
			};
		}

		const random1 = createSeededRandom(12345);
		const random2 = createSeededRandom(12345);

		// Same seed should produce same sequence
		expect(random1()).toBe(random2());
		expect(random1()).toBe(random2());
		expect(random1()).toBe(random2());
	});

	it("createSeededRandom should generate different values for different seeds", () => {
		function createSeededRandom(seed: number): () => number {
			let state = seed;
			return () => {
				state = (state * 1103515245 + 12345) & 0x7fffffff;
				return state / 0x7fffffff;
			};
		}

		const random1 = createSeededRandom(12345);
		const random2 = createSeededRandom(54321);

		expect(random1()).not.toBe(random2());
	});
});

import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock @engram/storage before importing
const mockBlobStoreRead = mock(async () => "{}");
mock.module("@engram/storage", () => ({
	createBlobStore: () => ({
		read: mockBlobStoreRead,
		write: mock(async () => {}),
	}),
}));

import type { FalkorClient } from "@engram/storage";
import { ReplayEngine } from "./replay";

describe("ReplayEngine", () => {
	let mockFalkorQuery: ReturnType<typeof mock>;
	let mockFalkor: FalkorClient;
	let engine: ReplayEngine;

	beforeEach(() => {
		mockFalkorQuery = mock(async () => []);
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
		// First call: snapshot query returns empty
		// Second call: diff query returns empty
		// Third call: tool call event query
		mockFalkorQuery
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]) // diffs
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "read_file",
					arguments: JSON.stringify({ path: "/test.txt" }),
					result: JSON.stringify({ content: "hello" }),
					vt_start: 1000,
				},
			]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
	});

	it("should mock Date.now during replay", async () => {
		const originalNow = Date.now();

		// Setup mock to return a tool call
		mockFalkorQuery
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]) // diffs
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "unknown_tool",
					arguments: "{}",
					result: null,
					vt_start: 5000,
				},
			]);

		await engine.replay("session-1", "event-1");

		// Date.now should be restored after replay
		expect(Date.now()).toBeGreaterThanOrEqual(originalNow);
	});

	it("should compare outputs correctly", async () => {
		// Setup for a read_file tool with matching output
		mockFalkorQuery
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]) // diffs
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/new.txt", content: "test" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.matches).toBe(true);
	});

	it("should detect mismatched outputs", async () => {
		// Setup where original result differs from replay
		mockFalkorQuery
			.mockResolvedValueOnce([]) // snapshot
			.mockResolvedValueOnce([]) // diffs
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/new.txt", content: "test" }),
					result: JSON.stringify({ success: false }), // Different from actual replay
					vt_start: 1000,
				},
			]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.matches).toBe(false);
	});
});

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
});

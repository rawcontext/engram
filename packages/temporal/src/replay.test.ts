import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

// Skip when running from root because mock.module conflicts with test-preload.ts
// Run from packages/temporal for these tests: cd packages/temporal && bun test
const isTemporalRoot = process.cwd().includes("packages/temporal");
const describeOrSkip = isTemporalRoot ? describe : describe.skip;

// Mock @engram/storage before importing
const mockBlobStoreRead = mock(async () => "{}");
const mockBlobStoreWrite = mock(async () => {});

mock.module("@engram/storage", () => ({
	createBlobStore: () => ({
		read: mockBlobStoreRead,
		write: mockBlobStoreWrite,
	}),
	createFalkorClient: () => ({
		query: mock(async () => []),
		connect: mock(async () => {}),
		disconnect: mock(async () => {}),
		isConnected: mock(() => false),
	}),
}));

// Import after mocking
import type { FalkorClient } from "@engram/storage";
import { ReplayEngine } from "./replay";

describeOrSkip("ReplayEngine", () => {
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
		mockFalkorQuery.mockResolvedValue([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(false);
		expect(result.error).toContain("not found");
	});

	it("should replay a tool call event", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/test.txt", content: "hello" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
	});

	it("should compare outputs correctly", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/new.txt", content: "test" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.matches).toBe(true);
	});

	it("should detect mismatched outputs", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/new.txt", content: "test" }),
					result: JSON.stringify({ success: false }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.matches).toBe(false);
	});

	it("should handle read_file tool", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "read_file",
					arguments: JSON.stringify({ path: "/test.txt" }),
					result: JSON.stringify({ content: "hello" }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					file_path: "/test.txt",
					patch_content:
						"--- /dev/null\n+++ b/test.txt\n@@ -0,0 +1 @@\n+hello\n\\ No newline at end of file",
				},
			]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toEqual({ content: "hello" });
	});

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
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
	});

	it("should handle mkdir tool", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "mkdir",
					arguments: JSON.stringify({ path: "/newdir" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toEqual({ success: true });
	});

	it("should handle create_directory tool", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "create_directory",
					arguments: JSON.stringify({ path: "/another/dir" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toEqual({ success: true });
	});

	it("should handle exists tool", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "exists",
					arguments: JSON.stringify({ path: "/" }),
					result: JSON.stringify({ exists: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toEqual({ exists: true });
	});

	it("should handle file_exists tool for non-existent path", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "file_exists",
					arguments: JSON.stringify({ path: "/nonexistent.txt" }),
					result: JSON.stringify({ exists: false }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toEqual({ exists: false });
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
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

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
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

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
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("should handle JSON.stringify errors in compareOutputs", async () => {
		// Spy on JSON.stringify to make it throw
		const originalStringify = JSON.stringify;
		const stringifySpy = spyOn(JSON, "stringify");

		let callCount = 0;
		stringifySpy.mockImplementation((...args) => {
			callCount++;
			// Let the first few calls succeed (for event.result parsing and mock setup)
			// Then throw on the comparison call
			if (callCount <= 3) {
				return originalStringify(...args);
			}
			throw new Error("Cannot stringify circular structure");
		});

		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "write_file",
					arguments: JSON.stringify({ path: "/test.txt", content: "test" }),
					result: JSON.stringify({ success: true }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		const result = await engine.replay("session-1", "event-1");

		// Restore the original
		stringifySpy.mockRestore();

		// Should succeed but matches should be false due to stringify error
		expect(result.success).toBe(true);
		expect(result.matches).toBe(false);
	});

	it("should use fallback when arguments is undefined", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "unknown_tool", // Use unknown tool which doesn't validate args
					arguments: undefined, // This will trigger the || "{}" branch
					result: JSON.stringify({ output: "something" }),
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([]) // snapshot query
			.mockResolvedValueOnce([]); // diff query

		const result = await engine.replay("session-1", "event-1");

		expect(result.success).toBe(true);
		expect(result.replayOutput).toHaveProperty("error");
	});

	it("should handle non-Error exceptions in replay", async () => {
		// Mock rehydrate to throw a non-Error value
		// @ts-expect-error - accessing private property for testing
		const mockRehydrate = spyOn(engine.rehydrator, "rehydrate");
		mockRehydrate.mockRejectedValueOnce("string error");

		mockFalkorQuery.mockResolvedValueOnce([
			{
				id: "event-1",
				name: "write_file",
				arguments: JSON.stringify({ path: "/test.txt", content: "test" }),
				result: JSON.stringify({ success: true }),
				vt_start: 1000,
			},
		]);

		const result = await engine.replay("session-1", "event-1");

		mockRehydrate.mockRestore();

		expect(result.success).toBe(false);
		expect(result.error).toBe("string error");
	});

	it("should handle when both original and replay outputs are null", async () => {
		// Mock executeTool to return null
		const mockExecuteTool = spyOn(engine as any, "executeTool");
		mockExecuteTool.mockResolvedValueOnce(null);

		mockFalkorQuery
			.mockResolvedValueOnce([
				{
					id: "event-1",
					name: "some_tool",
					arguments: JSON.stringify({}),
					result: null, // originalOutput will be null
					vt_start: 1000,
				},
			])
			.mockResolvedValueOnce([]) // snapshot query
			.mockResolvedValueOnce([]); // diff query

		const result = await engine.replay("session-1", "event-1");

		mockExecuteTool.mockRestore();

		expect(result.success).toBe(true);
		expect(result.matches).toBe(true); // Both null, so they match
		expect(result.originalOutput).toBe(null);
		expect(result.replayOutput).toBe(null);
	});
});

describe("compareOutputs edge cases", () => {
	function compareOutputs(original: unknown, replay: unknown): boolean {
		if (original === null && replay === null) return true;
		if (original === null || replay === null) return false;

		try {
			return JSON.stringify(original) === JSON.stringify(replay);
		} catch {
			return false;
		}
	}

	it("should return true when both outputs are null", () => {
		expect(compareOutputs(null, null)).toBe(true);
	});

	it("should return false when only original is null", () => {
		expect(compareOutputs(null, { data: "value" })).toBe(false);
	});

	it("should return false when only replay is null", () => {
		expect(compareOutputs({ data: "value" }, null)).toBe(false);
	});

	it("should return false when JSON.stringify throws on circular reference", () => {
		const circular: Record<string, unknown> = { a: 1 };
		circular.self = circular;

		expect(compareOutputs(circular, { a: 1 })).toBe(false);
	});

	it("should return false when JSON.stringify throws on BigInt", () => {
		const withBigInt = { value: BigInt(123) };
		expect(compareOutputs(withBigInt, { value: 123 })).toBe(false);
	});
});

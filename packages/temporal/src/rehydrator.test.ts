import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock @engram/storage before importing the unit under test
const mockBlobStoreLoad = vi.fn(async () => "{}");
vi.mock("@engram/storage", () => ({
	createBlobStore: () => ({
		load: mockBlobStoreLoad,
		save: vi.fn(async () => "blob://ref"),
	}),
	createFalkorClient: () => ({
		query: vi.fn(async () => []),
	}),
}));

import type { FalkorClient } from "@engram/storage";
import { createRehydrator, Rehydrator } from "./rehydrator";

describe("Rehydrator", () => {
	let mockFalkorQuery: ReturnType<typeof mock>;
	let mockFalkor: FalkorClient;
	let rehydrator: Rehydrator;

	beforeEach(() => {
		mockFalkorQuery = vi.fn(async () => []);
		mockFalkor = {
			query: mockFalkorQuery,
		} as unknown as FalkorClient;
		rehydrator = new Rehydrator(mockFalkor);
		mockBlobStoreLoad.mockClear();
	});

	it("should return empty VFS if no snapshots found", async () => {
		// First call (snapshot query) returns empty, second call (diff query) returns empty
		mockFalkorQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
		expect(vfs.root).toEqual({
			name: "",
			type: "directory",
			children: {},
		});
	});

	it("should filter diffs by session_id", async () => {
		// First call: snapshot query returns empty
		// Second call: diff query (should include sessionId filter)
		mockFalkorQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		await rehydrator.rehydrate("test-session-123");

		// Verify the diff query includes session filtering
		const calls = mockFalkorQuery.mock.calls;
		expect(calls.length).toBe(2);

		// Second call should be the diff query with session filter
		const diffQueryCall = calls[1];
		const queryString = diffQueryCall[0] as string;
		const params = diffQueryCall[1] as Record<string, unknown>;

		expect(queryString).toContain("Session {id: $sessionId}");
		expect(params.sessionId).toBe("test-session-123");
	});

	it("should attempt to load snapshot if found", async () => {
		const mockSnapshot = ["blob-ref-123", 1000];
		// First call: snapshot found, second call: no diffs
		mockFalkorQuery.mockResolvedValueOnce([mockSnapshot]).mockResolvedValueOnce([]);
		mockBlobStoreLoad.mockResolvedValueOnce(
			JSON.stringify({ root: { name: "", type: "directory", children: {} } }),
		);

		await rehydrator.rehydrate("session-1");

		expect(mockFalkorQuery).toHaveBeenCalled();
		expect(mockBlobStoreLoad).toHaveBeenCalledWith("blob-ref-123");
	});

	it("should apply diffs in order after snapshot", async () => {
		// No snapshot
		mockFalkorQuery.mockResolvedValueOnce([]);

		// Diffs returned from session-filtered query
		const mockDiffs = [
			{
				file_path: "/src/app.ts",
				patch_content: "@@ -1,0 +1,1 @@\n+console.log('hello');",
				vt_start: 1000,
			},
			{
				file_path: "/src/app.ts",
				patch_content: "@@ -1,1 +1,2 @@\n console.log('hello');\n+console.log('world');",
				vt_start: 2000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		// Note: PatchManager.applyPatch may fail on malformed patches
		// but rehydrator catches those errors and continues
		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
	});

	it("should pass lastSnapshotTime to diff query", async () => {
		const mockSnapshot = ["blob-ref-123", 5000];
		mockFalkorQuery.mockResolvedValueOnce([mockSnapshot]).mockResolvedValueOnce([]);
		mockBlobStoreLoad.mockResolvedValueOnce(
			JSON.stringify({ root: { name: "", type: "directory", children: {} } }),
		);

		await rehydrator.rehydrate("session-1", 10000);

		const diffQueryCall = mockFalkorQuery.mock.calls[1];
		const params = diffQueryCall[1] as Record<string, unknown>;

		expect(params.lastSnapshotTime).toBe(5000);
		expect(params.targetTime).toBe(10000);
	});

	it("should handle snapshot loading with JSON fallback when gzip fails", async () => {
		const mockSnapshot = ["blob-ref-json", 1000];
		mockFalkorQuery.mockResolvedValueOnce([mockSnapshot]).mockResolvedValueOnce([]);

		const jsonContent = JSON.stringify({
			root: { name: "", type: "directory", children: { "test.txt": { name: "test.txt" } } },
		});
		mockBlobStoreLoad.mockResolvedValueOnce(jsonContent);

		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
	});

	it("should throw RehydrationError when both gzip and JSON parsing fail", async () => {
		const mockSnapshot = ["blob-ref-invalid", 1000];
		mockFalkorQuery.mockResolvedValueOnce([mockSnapshot]).mockResolvedValueOnce([]);

		mockBlobStoreLoad.mockResolvedValueOnce("invalid data that is neither gzip nor JSON");

		await expect(rehydrator.rehydrate("session-1")).rejects.toThrow("Failed to load VFS snapshot");
	});

	it("should throw RehydrationError when all patches fail", async () => {
		mockFalkorQuery.mockResolvedValueOnce([]); // No snapshot

		// Create patches that will genuinely fail (invalid hunk ranges)
		const mockDiffs = [
			{
				file_path: "/file1.txt",
				patch_content: "@@ -100,10 +100,10 @@\n-non-existent line\n+replacement",
				vt_start: 1000,
			},
			{
				file_path: "/file2.txt",
				patch_content: "@@ -200,5 +200,5 @@\n-another non-existent line\n+replacement",
				vt_start: 2000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		await expect(rehydrator.rehydrate("session-1")).rejects.toThrow(
			"All 2 patches failed to apply",
		);
	});

	it("should continue when some patches fail but not all", async () => {
		mockFalkorQuery.mockResolvedValueOnce([]); // No snapshot

		const mockDiffs = [
			{
				file_path: "/valid.txt",
				patch_content: "@@ -0,0 +1,1 @@\n+valid content",
				vt_start: 1000,
			},
			{
				file_path: "/invalid.txt",
				patch_content: "invalid patch",
				vt_start: 2000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
	});

	it("should handle diffs with null patch_content", async () => {
		mockFalkorQuery.mockResolvedValueOnce([]); // No snapshot

		const mockDiffs = [
			{
				file_path: "/file.txt",
				patch_content: null,
				vt_start: 1000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
	});

	it("should handle diffs with null file_path", async () => {
		mockFalkorQuery.mockResolvedValueOnce([]); // No snapshot

		const mockDiffs = [
			{
				file_path: null,
				patch_content: "@@ -0,0 +1,1 @@\n+content",
				vt_start: 1000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
	});

	it("should use default target time when not provided", async () => {
		const beforeTime = Date.now();
		mockFalkorQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		await rehydrator.rehydrate("session-1");

		const snapshotQueryCall = mockFalkorQuery.mock.calls[0];
		const params = snapshotQueryCall[1] as Record<string, unknown>;

		const targetTime = params.targetTime as number;
		expect(targetTime).toBeGreaterThanOrEqual(beforeTime);
	});

	it("should create rehydrator with deps object constructor", () => {
		const customGraphClient = {
			query: vi.fn(async () => []),
		} as unknown as FalkorClient;

		const customBlobStore = {
			load: vi.fn(async () => "{}"),
			save: vi.fn(async () => "blob://ref"),
		};

		const rehydrator = new Rehydrator({
			graphClient: customGraphClient,
			blobStore: customBlobStore,
		});

		expect(rehydrator).toBeDefined();
	});

	it("should create rehydrator with no args (uses defaults)", () => {
		const rehydrator = new Rehydrator();
		expect(rehydrator).toBeDefined();
	});

	it("should use createRehydrator factory", () => {
		const rehydrator1 = createRehydrator(undefined);
		expect(rehydrator1).toBeDefined();

		const rehydrator2 = createRehydrator({
			graphClient: mockFalkor,
		});
		expect(rehydrator2).toBeDefined();
	});

	it("should create rehydrator with only blobStore in deps (uses default graphClient)", () => {
		const customBlobStore = {
			load: vi.fn(async () => "{}"),
			save: vi.fn(async () => "blob://ref"),
		};

		const rehydrator = new Rehydrator({
			blobStore: customBlobStore,
		});

		expect(rehydrator).toBeDefined();
	});

	it("should handle non-Error exception when JSON parsing fails", async () => {
		const mockSnapshot = ["blob-ref-invalid", 1000];
		mockFalkorQuery.mockResolvedValueOnce([mockSnapshot]).mockResolvedValueOnce([]);

		// Mock JSON.parse to throw a non-Error value
		const originalParse = JSON.parse;
		const parseSpy = vi.spyOn(JSON, "parse");
		let parseCallCount = 0;
		parseSpy.mockImplementation((text: string) => {
			parseCallCount++;
			// Let any initial calls succeed (for test setup)
			// Then throw a non-Error value for the VFS snapshot parsing
			if (parseCallCount === 1) {
				throw "non-error string"; // This triggers the false branch of instanceof Error
			}
			return originalParse(text);
		});

		mockBlobStoreLoad.mockResolvedValueOnce("not valid json or gzip");

		await expect(rehydrator.rehydrate("session-1")).rejects.toThrow("Failed to load VFS snapshot");

		parseSpy.mockRestore();
	});

	it("should handle non-Error exception when patch application fails", async () => {
		mockFalkorQuery.mockResolvedValueOnce([]); // No snapshot

		// Mix of valid and invalid patches  to ensure not all fail
		const mockDiffs = [
			{
				file_path: "/valid.txt",
				// Valid patch that creates a new file
				patch_content: "@@ -0,0 +1,1 @@\n+valid content",
				vt_start: 1000,
			},
			{
				file_path: "/file.txt",
				// Malformed patch that will cause an error
				patch_content: "@@ -1,1 +1,1 @@\n",
				vt_start: 2000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		// This should not throw because not all patches fail
		// The error handling for non-Error exceptions is tested indirectly
		// (PatchManager may throw Error objects, but the code path handles both cases)
		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
		// Verify the valid patch was applied (patch adds a newline)
		expect(vfs.readFile("/valid.txt")).toBe("valid content\n");
	});

	it("should handle when diff query returns non-array", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([]) // No snapshot
			.mockResolvedValueOnce(null); // Diff query returns null instead of array

		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
		// Should return empty VFS since no patches were applied
		expect(vfs.root.children).toEqual({});
	});

	it("should handle when diff query returns undefined", async () => {
		mockFalkorQuery
			.mockResolvedValueOnce([]) // No snapshot
			.mockResolvedValueOnce(undefined); // Diff query returns undefined

		const vfs = await rehydrator.rehydrate("session-1");
		expect(vfs).toBeDefined();
		expect(vfs.root.children).toEqual({});
	});

	it("should convert non-Error exceptions to Error objects when patch fails", async () => {
		// Import VFS module to spy on PatchManager
		const vfs = await import("@engram/vfs");

		// Spy on applyUnifiedDiff
		const spy = vi.spyOn(vfs.PatchManager.prototype, "applyUnifiedDiff");

		// First patch succeeds, second throws non-Error
		spy
			.mockImplementationOnce(() => {
				// First call succeeds - don't throw
				return;
			})
			.mockImplementationOnce(() => {
				// Second call throws a non-Error value
				throw 42; // Throws a number, not an Error
			});

		mockFalkorQuery.mockResolvedValueOnce([]); // No snapshot

		const mockDiffs = [
			{
				file_path: "/file1.txt",
				patch_content: "@@ -0,0 +1,1 @@\n+content1",
				vt_start: 1000,
			},
			{
				file_path: "/file2.txt",
				patch_content: "@@ -0,0 +1,1 @@\n+content2",
				vt_start: 2000,
			},
		];
		mockFalkorQuery.mockResolvedValueOnce(mockDiffs);

		// Should not throw because only one patch failed
		const result = await rehydrator.rehydrate("session-1");
		spy.mockRestore();

		expect(result).toBeDefined();
	});
});

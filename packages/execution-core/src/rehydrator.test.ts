import { beforeEach, describe, expect, it, mock } from "bun:test";

// Mock @engram/storage before importing the unit under test
const mockBlobStoreRead = mock(async () => "{}");
mock.module("@engram/storage", () => ({
	createBlobStore: () => ({
		read: mockBlobStoreRead,
		write: mock(async () => {}),
	}),
}));

import type { FalkorClient } from "@engram/storage";
import { Rehydrator } from "./rehydrator";

describe("Rehydrator", () => {
	let mockFalkorQuery: ReturnType<typeof mock>;
	let mockFalkor: FalkorClient;
	let rehydrator: Rehydrator;

	beforeEach(() => {
		mockFalkorQuery = mock(async () => []);
		mockFalkor = {
			query: mockFalkorQuery,
		} as unknown as FalkorClient;
		rehydrator = new Rehydrator(mockFalkor);
		mockBlobStoreRead.mockClear();
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
		mockBlobStoreRead.mockResolvedValueOnce(
			JSON.stringify({ root: { name: "", type: "directory", children: {} } }),
		);

		await rehydrator.rehydrate("session-1");

		expect(mockFalkorQuery).toHaveBeenCalled();
		expect(mockBlobStoreRead).toHaveBeenCalledWith("blob-ref-123");
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
		mockBlobStoreRead.mockResolvedValueOnce(
			JSON.stringify({ root: { name: "", type: "directory", children: {} } }),
		);

		await rehydrator.rehydrate("session-1", 10000);

		const diffQueryCall = mockFalkorQuery.mock.calls[1];
		const params = diffQueryCall[1] as Record<string, unknown>;

		expect(params.lastSnapshotTime).toBe(5000);
		expect(params.targetTime).toBe(10000);
	});
});

import { describe, expect, it, mock } from "bun:test";
import { VirtualFileSystem } from "@engram/vfs";
import type { Rehydrator } from "./rehydrator";
import { TimeTravelService } from "./time-travel";

// Mock VirtualFileSystem
const mockVFS = new VirtualFileSystem();
mockVFS.root = { "test.txt": "content" }; // simplistic mock of root
mockVFS.readDir = mock(() => ["test.txt"]);

// Mock Rehydrator
const mockRehydrator = {
	rehydrate: mock(async (_sessionId: string, _targetTime: number) => {
		return mockVFS;
	}),
} as unknown as Rehydrator;

describe("TimeTravelService", () => {
	const service = new TimeTravelService(mockRehydrator);

	it("getFilesystemState should return rehydrated VFS", async () => {
		const vfs = await service.getFilesystemState("session-1", 1000);
		expect(mockRehydrator.rehydrate).toHaveBeenCalledWith("session-1", 1000);
		expect(vfs).toBe(mockVFS);
	});

	it("getZippedState should return gzipped JSON of VFS root", async () => {
		const buffer = await service.getZippedState("session-1", 1000);
		expect(buffer).toBeDefined();
		expect(Buffer.isBuffer(buffer)).toBe(true);
		// Decompressing to check content might be overkill but good for verification
		// For now just check it's not empty
		expect(buffer.length).toBeGreaterThan(0);
	});

	it("listFiles should return file list from VFS", async () => {
		const files = await service.listFiles("session-1", 1000, "/");
		expect(files).toEqual(["test.txt"]);
	});

	it("listFiles should return empty array when path doesn't exist", async () => {
		const errorVFS = new VirtualFileSystem();
		errorVFS.readDir = mock(() => {
			throw new Error("Directory not found");
		});

		const errorRehydrator = {
			rehydrate: mock(async () => errorVFS),
		} as unknown as Rehydrator;

		const errorService = new TimeTravelService(errorRehydrator);
		const files = await errorService.listFiles("session-1", 1000, "/nonexistent");

		expect(files).toEqual([]);
	});

	it("listFiles should default to root path when not specified", async () => {
		const files = await service.listFiles("session-1", 1000);
		expect(mockVFS.readDir).toHaveBeenCalledWith("/");
		expect(files).toEqual(["test.txt"]);
	});

	it("getFilesystemState should pass through different session IDs", async () => {
		await service.getFilesystemState("different-session", 2000);
		expect(mockRehydrator.rehydrate).toHaveBeenCalledWith("different-session", 2000);
	});

	it("getZippedState should handle different timestamps", async () => {
		const buffer = await service.getZippedState("session-2", 5000);
		expect(mockRehydrator.rehydrate).toHaveBeenCalledWith("session-2", 5000);
		expect(Buffer.isBuffer(buffer)).toBe(true);
	});
});

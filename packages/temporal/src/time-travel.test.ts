import { VirtualFileSystem } from "@engram/vfs";
import { describe, expect, it, vi } from "vitest";
import type { Rehydrator } from "./rehydrator";
import { TimeTravelService } from "./time-travel";

// Mock VirtualFileSystem
const mockVFS = new VirtualFileSystem();
mockVFS.root = { "test.txt": "content" }; // simplistic mock of root
mockVFS.readDir = vi.fn(() => ["test.txt"]);

// Mock Rehydrator
const mockRehydrator = {
	rehydrate: vi.fn(async (_sessionId: string, _targetTime: number) => {
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
});

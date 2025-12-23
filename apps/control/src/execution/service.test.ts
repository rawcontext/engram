import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Mock external dependencies - must be defined before mock.module calls
const mockCreateNodeLogger = mock(() => ({
	info: mock(),
	error: mock(),
	warn: mock(),
	debug: mock(),
}));

const mockCreateFalkorClient = mock(() => ({
	connect: mock().mockResolvedValue(undefined),
	disconnect: mock().mockResolvedValue(undefined),
	query: mock().mockResolvedValue([]),
	isConnected: mock().mockReturnValue(false),
}));

const mockCreateBlobStore = mock(() => ({
	save: mock().mockResolvedValue("blob://test"),
	load: mock().mockResolvedValue(Buffer.from("{}")),
	exists: mock().mockResolvedValue(false),
}));

mock.module("@engram/logger", () => ({
	createNodeLogger: mockCreateNodeLogger,
}));

mock.module("@engram/storage", () => ({
	createFalkorClient: mockCreateFalkorClient,
	createBlobStore: mockCreateBlobStore,
}));

// Import after mocking
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { Rehydrator, TimeTravelService } from "@engram/temporal";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";
import { createExecutionService, ExecutionService } from "./service";

describe("ExecutionService", () => {
	beforeEach(() => {
		// vi.clearAllMocks(); // TODO: Clear individual mocks
	});

	afterEach(() => {
		// vi.restoreAllMocks(); // TODO: Restore individual mocks
	});

	describe("Construction", () => {
		it("should create service with default dependencies", () => {
			const service = new ExecutionService();

			expect(service.vfs).toBeInstanceOf(VirtualFileSystem);
			expect(service.patchManager).toBeInstanceOf(PatchManager);
			expect(service.rehydrator).toBeInstanceOf(Rehydrator);
			expect(service.timeTravelService).toBeInstanceOf(TimeTravelService);
			expect(service.graphClient).toBeDefined();
			expect(service.logger).toBeDefined();
		});

		it("should use injected VFS when provided", () => {
			const customVfs = new VirtualFileSystem();
			customVfs.writeFile("/test.txt", "test content");

			const service = new ExecutionService({ vfs: customVfs });

			expect(service.vfs).toBe(customVfs);
			expect(service.vfs.readFile("/test.txt")).toBe("test content");
		});

		it("should use injected PatchManager when provided", () => {
			const customVfs = new VirtualFileSystem();
			const customPatchManager = new PatchManager(customVfs);

			const service = new ExecutionService({ patchManager: customPatchManager });

			expect(service.patchManager).toBe(customPatchManager);
		});

		it("should use injected graphClient when provided", () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};

			const service = new ExecutionService({ graphClient: mockGraphClient });

			expect(service.graphClient).toBe(mockGraphClient);
		});

		it("should use injected logger when provided", () => {
			const mockLogger = {
				info: mock(),
				error: mock(),
				warn: mock(),
				debug: mock(),
			} as unknown as Logger;

			const service = new ExecutionService({ logger: mockLogger });

			expect(service.logger).toBe(mockLogger);
		});
	});

	describe("createExecutionService Factory", () => {
		it("should create service with defaults", () => {
			const service = createExecutionService();

			expect(service).toBeInstanceOf(ExecutionService);
			expect(service.vfs).toBeInstanceOf(VirtualFileSystem);
		});

		it("should create service with custom dependencies", () => {
			const customVfs = new VirtualFileSystem();
			const service = createExecutionService({ vfs: customVfs });

			expect(service.vfs).toBe(customVfs);
		});
	});

	describe("readFile", () => {
		it("should return file content for existing file", async () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/test.txt", "test content");
			const service = new ExecutionService({ vfs });

			const result = await service.readFile("/test.txt");

			expect(result.success).toBe(true);
			expect(result.data).toBe("test content");
		});

		it("should return error for non-existent file", async () => {
			const service = new ExecutionService();

			const result = await service.readFile("/nonexistent.txt");

			expect(result.success).toBe(false);
			expect(result.error).toContain("File not found");
		});

		it("should handle non-Error exceptions", async () => {
			const mockVfs = {
				readFile: mock().mockImplementation(() => {
					throw "string error";
				}),
			} as unknown as VirtualFileSystem;
			const service = new ExecutionService({ vfs: mockVfs });

			const result = await service.readFile("/test.txt");

			expect(result.success).toBe(false);
			expect(result.error).toBe("string error");
		});
	});

	describe("applyPatch", () => {
		it("should successfully apply a patch", async () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/file.txt", "Hello, World!");
			const service = new ExecutionService({ vfs });

			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-Hello, World!
+Hello, Universe!
`;

			const result = await service.applyPatch("/file.txt", diff);

			expect(result.success).toBe(true);
			expect(result.data).toBe("Successfully patched /file.txt");
			expect(vfs.readFile("/file.txt")).toBe("Hello, Universe!");
		});

		it("should return error when patch fails", async () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/file.txt", "completely different content");
			const service = new ExecutionService({ vfs });

			const badDiff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+new line2
 line3
`;

			const result = await service.applyPatch("/file.txt", badDiff);

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});
	});

	describe("applySearchReplace", () => {
		it("should successfully apply search/replace", async () => {
			const service = new ExecutionService();
			service.writeFile("/file.txt", "Hello, World!");

			const result = await service.applySearchReplace("/file.txt", "World", "Universe");

			expect(result.success).toBe(true);
			expect(result.data).toBe("Successfully replaced text in /file.txt");
			expect(service.vfs.readFile("/file.txt")).toBe("Hello, Universe!");
		});

		it("should return error when search text not found", async () => {
			const service = new ExecutionService();
			service.writeFile("/file.txt", "Hello, World!");

			const result = await service.applySearchReplace("/file.txt", "Missing", "Replacement");

			expect(result.success).toBe(false);
			expect(result.error).toContain("Search block not found");
		});

		it("should handle file not found", async () => {
			const service = new ExecutionService();

			const result = await service.applySearchReplace("/nonexistent.txt", "search", "replace");

			expect(result.success).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should handle non-Error exceptions in applySearchReplace", async () => {
			const mockPatchManager = {
				applySearchReplace: mock().mockImplementation(() => {
					throw "string error";
				}),
			} as unknown as PatchManager;

			const service = new ExecutionService({ patchManager: mockPatchManager });

			const result = await service.applySearchReplace("/test.txt", "search", "replace");

			expect(result.success).toBe(false);
			expect(result.error).toBe("string error");
		});
	});

	describe("listFilesAtTime", () => {
		it("should return list of files", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};
			const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const timeTravelService = new TimeTravelService(rehydrator);
			const service = new ExecutionService({
				graphClient: mockGraphClient,
				rehydrator,
				timeTravelService,
			});

			const result = await service.listFilesAtTime("test-session", Date.now(), "/");

			expect(result.success).toBe(true);
			expect(result.data).toBe("[]");
			expect(mockGraphClient.connect).toHaveBeenCalled();
		});

		it("should return error when connection fails", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockRejectedValue(new Error("Connection failed")),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(false),
			};
			const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const timeTravelService = new TimeTravelService(rehydrator);
			const service = new ExecutionService({
				graphClient: mockGraphClient,
				rehydrator,
				timeTravelService,
			});

			const result = await service.listFilesAtTime("test-session", Date.now(), "/");

			expect(result.success).toBe(false);
			expect(result.error).toContain("Connection failed");
		});

		it("should handle non-Error exceptions in listFilesAtTime", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockImplementation(() => {
					throw "string error";
				}),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(false),
			};
			const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const timeTravelService = new TimeTravelService(rehydrator);
			const service = new ExecutionService({
				graphClient: mockGraphClient,
				rehydrator,
				timeTravelService,
			});

			const result = await service.listFilesAtTime("test-session", Date.now(), "/");

			expect(result.success).toBe(false);
			expect(result.error).toBe("string error");
		});

		it("should always disconnect graph client in finally block", async () => {
			const disconnectMock = mock().mockResolvedValue(undefined);
			const mockGraphClient: GraphClient = {
				connect: mock().mockRejectedValue(new Error("Connection failed")),
				disconnect: disconnectMock,
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(false),
			};
			const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const timeTravelService = new TimeTravelService(rehydrator);
			const service = new ExecutionService({
				graphClient: mockGraphClient,
				rehydrator,
				timeTravelService,
			});

			await service.listFilesAtTime("test-session", Date.now(), "/");

			expect(disconnectMock).toHaveBeenCalled();
		});
	});

	describe("VFS Operations", () => {
		it("should write and read files", () => {
			const service = new ExecutionService();

			service.writeFile("/test.txt", "content");
			const content = service.vfs.readFile("/test.txt");

			expect(content).toBe("content");
		});

		it("should check file existence", () => {
			const service = new ExecutionService();

			service.writeFile("/exists.txt", "content");

			expect(service.exists("/exists.txt")).toBe(true);
			expect(service.exists("/nonexistent.txt")).toBe(false);
		});

		it("should create directories", () => {
			const service = new ExecutionService();

			service.mkdir("/test/nested/dir");

			expect(service.exists("/test")).toBe(true);
			expect(service.exists("/test/nested")).toBe(true);
			expect(service.exists("/test/nested/dir")).toBe(true);
		});

		it("should list directory contents", () => {
			const service = new ExecutionService();
			service.writeFile("/dir/file1.txt", "content1");
			service.writeFile("/dir/file2.txt", "content2");

			const contents = service.readDir("/dir");

			expect(contents).toContain("file1.txt");
			expect(contents).toContain("file2.txt");
		});
	});

	describe("Time Travel", () => {
		it("should get filesystem state at a point in time", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};
			const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const timeTravelService = new TimeTravelService(rehydrator);
			const service = new ExecutionService({
				graphClient: mockGraphClient,
				rehydrator,
				timeTravelService,
			});

			const vfsState = await service.getFilesystemState("session-123", Date.now());

			expect(vfsState).toBeInstanceOf(VirtualFileSystem);
		});

		it("should get zipped state at a point in time", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};
			const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const timeTravelService = new TimeTravelService(rehydrator);
			const service = new ExecutionService({
				graphClient: mockGraphClient,
				rehydrator,
				timeTravelService,
			});

			const zippedState = await service.getZippedState("session-123", Date.now());

			expect(zippedState).toBeInstanceOf(Buffer);
		});
	});

	describe("PatchManager Integration", () => {
		it("should apply search/replace patch", async () => {
			const service = new ExecutionService();
			service.writeFile("/file.txt", "Hello, World!");

			service.patchManager.applySearchReplace("/file.txt", "World", "Universe");

			expect(service.vfs.readFile("/file.txt")).toBe("Hello, Universe!");
		});

		it("should apply unified diff to existing file", async () => {
			const service = new ExecutionService();
			service.writeFile("/file.txt", "line1\nline2\nline3\n");
			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified line2
 line3
`;

			service.patchManager.applyUnifiedDiff("/file.txt", diff);

			expect(service.vfs.readFile("/file.txt")).toBe("line1\nmodified line2\nline3\n");
		});

		it("should apply creation patch to new file", async () => {
			const service = new ExecutionService();
			const diff = `--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+new line 1
+new line 2
`;

			service.patchManager.applyUnifiedDiff("/newfile.txt", diff);

			expect(service.vfs.readFile("/newfile.txt")).toBe("new line 1\nnew line 2\n");
		});
	});

	describe("Edge Cases", () => {
		it("should handle empty file content", () => {
			const service = new ExecutionService();

			service.writeFile("/empty.txt", "");

			expect(service.vfs.readFile("/empty.txt")).toBe("");
		});

		it("should handle file names with special characters", () => {
			const service = new ExecutionService();
			const specialName = "file-with_special.chars-123.txt";

			service.writeFile(`/${specialName}`, "special content");

			expect(service.vfs.readFile(`/${specialName}`)).toBe("special content");
		});

		it("should handle deeply nested directories", () => {
			const service = new ExecutionService();
			const deepPath = "/a/b/c/d/e/f/g/h/i/j";

			service.mkdir(deepPath);
			service.writeFile(`${deepPath}/deep.txt`, "very deep");

			expect(service.exists(`${deepPath}/deep.txt`)).toBe(true);
		});

		it("should handle unicode content", () => {
			const service = new ExecutionService();
			const unicodeContent = "Hello - 中文 - 日本語 - 😀";

			service.writeFile("/unicode.txt", unicodeContent);

			expect(service.vfs.readFile("/unicode.txt")).toBe(unicodeContent);
		});

		it("should handle large file content", () => {
			const service = new ExecutionService();
			const largeContent = "x".repeat(1000000);

			service.writeFile("/large.txt", largeContent);

			expect(service.vfs.readFile("/large.txt")).toBe(largeContent);
		});
	});

	describe("Concurrent Operations", () => {
		it("should handle concurrent file writes", async () => {
			const service = new ExecutionService();
			const writePromises: Promise<void>[] = [];

			for (let i = 0; i < 100; i++) {
				writePromises.push(
					Promise.resolve().then(() => {
						service.writeFile(`/file${i}.txt`, `content${i}`);
					}),
				);
			}
			await Promise.all(writePromises);

			for (let i = 0; i < 100; i++) {
				expect(service.vfs.readFile(`/file${i}.txt`)).toBe(`content${i}`);
			}
		});

		it("should handle concurrent reads", async () => {
			const service = new ExecutionService();
			service.writeFile("/shared.txt", "shared content");
			const readPromises: Promise<string>[] = [];

			for (let i = 0; i < 100; i++) {
				readPromises.push(Promise.resolve().then(() => service.vfs.readFile("/shared.txt")));
			}
			const results = await Promise.all(readPromises);

			expect(results.every((r) => r === "shared content")).toBe(true);
		});
	});

	describe("Snapshot Operations", () => {
		it("should create and load VFS snapshots", async () => {
			const service = new ExecutionService();
			service.writeFile("/file1.txt", "content1");
			service.writeFile("/dir/file2.txt", "content2");

			const snapshot = await service.vfs.createSnapshot();

			const restoredVfs = new VirtualFileSystem();
			await restoredVfs.loadSnapshot(snapshot);

			expect(restoredVfs.readFile("/file1.txt")).toBe("content1");
			expect(restoredVfs.readFile("/dir/file2.txt")).toBe("content2");
		});

		it("should preserve directory structure in snapshots", async () => {
			const service = new ExecutionService();
			service.mkdir("/a/b/c");
			service.writeFile("/a/b/c/deep.txt", "deep content");

			const snapshot = await service.vfs.createSnapshot();
			const restoredVfs = new VirtualFileSystem();
			await restoredVfs.loadSnapshot(snapshot);

			expect(restoredVfs.exists("/a/b/c/deep.txt")).toBe(true);
			expect(restoredVfs.readFile("/a/b/c/deep.txt")).toBe("deep content");
		});
	});

	describe("Full Dependency Injection", () => {
		it("should allow full dependency override for testing", () => {
			const mockVfs = new VirtualFileSystem();
			const mockPatchManager = new PatchManager(mockVfs);
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};
			const mockRehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const mockTimeTravel = new TimeTravelService(mockRehydrator);
			const mockLogger = {
				info: mock(),
				error: mock(),
				warn: mock(),
				debug: mock(),
			} as unknown as Logger;

			const service = new ExecutionService({
				vfs: mockVfs,
				patchManager: mockPatchManager,
				graphClient: mockGraphClient,
				rehydrator: mockRehydrator,
				timeTravelService: mockTimeTravel,
				logger: mockLogger,
			});

			expect(service.vfs).toBe(mockVfs);
			expect(service.patchManager).toBe(mockPatchManager);
			expect(service.graphClient).toBe(mockGraphClient);
			expect(service.rehydrator).toBe(mockRehydrator);
			expect(service.timeTravelService).toBe(mockTimeTravel);
			expect(service.logger).toBe(mockLogger);
		});
	});

	describe("replayToolCall", () => {
		it("should replay a tool call successfully", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};

			const mockReplayEngine = {
				replay: mock().mockResolvedValue({
					success: true,
					matches: true,
					originalOutput: "original",
					replayOutput: "original",
				}),
			};

			const service = new ExecutionService({
				graphClient: mockGraphClient,
				replayEngine: mockReplayEngine as any,
			});

			const result = await service.replayToolCall("session-123", "event-456");

			expect(result.success).toBe(true);
			expect(result.data).toBeDefined();
			expect(result.data).toContain("matches");
			expect(mockGraphClient.connect).toHaveBeenCalled();
			expect(mockGraphClient.disconnect).toHaveBeenCalled();
		});

		it("should handle replay failures", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};

			const mockReplayEngine = {
				replay: mock().mockResolvedValue({
					success: false,
					error: "Replay failed",
				}),
			};

			const service = new ExecutionService({
				graphClient: mockGraphClient,
				replayEngine: mockReplayEngine as any,
			});

			const result = await service.replayToolCall("session-123", "event-456");

			expect(result.success).toBe(false);
			expect(result.error).toBe("Replay failed");
		});

		it("should handle replay exceptions", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};

			const mockReplayEngine = {
				replay: mock().mockRejectedValue(new Error("Replay exception")),
			};

			const service = new ExecutionService({
				graphClient: mockGraphClient,
				replayEngine: mockReplayEngine as any,
			});

			const result = await service.replayToolCall("session-123", "event-456");

			expect(result.success).toBe(false);
			expect(result.error).toBe("Replay exception");
			expect(mockGraphClient.disconnect).toHaveBeenCalled();
		});

		it("should handle non-Error exceptions in replay", async () => {
			const mockGraphClient: GraphClient = {
				connect: mock().mockResolvedValue(undefined),
				disconnect: mock().mockResolvedValue(undefined),
				query: mock().mockResolvedValue([]),
				isConnected: mock().mockReturnValue(true),
			};

			const mockReplayEngine = {
				replay: mock().mockRejectedValue("string error"),
			};

			const service = new ExecutionService({
				graphClient: mockGraphClient,
				replayEngine: mockReplayEngine as any,
			});

			const result = await service.replayToolCall("session-123", "event-456");

			expect(result.success).toBe(false);
			expect(result.error).toBe("string error");
		});
	});
});

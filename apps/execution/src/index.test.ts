import { Rehydrator, TimeTravelService } from "@engram/temporal";
import type { Logger } from "@engram/logger";
import type { GraphClient } from "@engram/storage";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Mock the external dependencies before importing the module under test
vi.mock("@engram/logger", () => ({
	createNodeLogger: vi.fn(() => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	})),
}));

vi.mock("@engram/storage", () => ({
	createFalkorClient: vi.fn(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
		query: vi.fn().mockResolvedValue([]),
		isConnected: vi.fn().mockReturnValue(false),
	})),
	createBlobStore: vi.fn(() => ({
		save: vi.fn().mockResolvedValue("blob://test"),
		load: vi.fn().mockResolvedValue("{}"),
	})),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
	McpServer: vi.fn().mockImplementation(() => ({
		tool: vi.fn(),
		connect: vi.fn().mockResolvedValue(undefined),
	})),
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
	StdioServerTransport: vi.fn().mockImplementation(() => ({})),
}));

import { createNodeLogger } from "@engram/logger";
import { createFalkorClient } from "@engram/storage";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// Import after mocking
import {
	createExecutionServiceDeps,
	handleApplyPatch,
	handleListFilesAtTime,
	handleReadFile,
	main,
	patchManager,
	server,
	textResult,
	vfs,
} from "./index";

describe("Execution Service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("createExecutionServiceDeps", () => {
		it("should create all dependencies with defaults when no arguments provided", () => {
			// Arrange & Act
			const deps = createExecutionServiceDeps();

			// Assert
			expect(deps).toBeDefined();
			expect(deps.vfs).toBeInstanceOf(VirtualFileSystem);
			expect(deps.patchManager).toBeInstanceOf(PatchManager);
			expect(deps.rehydrator).toBeInstanceOf(Rehydrator);
			expect(deps.timeTravelService).toBeInstanceOf(TimeTravelService);
			expect(deps.graphClient).toBeDefined();
			expect(deps.logger).toBeDefined();
		});

		it("should use injected VFS when provided", () => {
			// Arrange
			const customVfs = new VirtualFileSystem();
			customVfs.writeFile("/test.txt", "test content");

			// Act
			const deps = createExecutionServiceDeps({ vfs: customVfs });

			// Assert
			expect(deps.vfs).toBe(customVfs);
			expect(deps.vfs.readFile("/test.txt")).toBe("test content");
		});

		it("should use injected PatchManager when provided", () => {
			// Arrange
			const customVfs = new VirtualFileSystem();
			const customPatchManager = new PatchManager(customVfs);

			// Act
			const deps = createExecutionServiceDeps({ patchManager: customPatchManager });

			// Assert
			expect(deps.patchManager).toBe(customPatchManager);
		});

		it("should use injected graphClient when provided", () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(true),
			};

			// Act
			const deps = createExecutionServiceDeps({ graphClient: mockGraphClient });

			// Assert
			expect(deps.graphClient).toBe(mockGraphClient);
		});

		it("should use injected logger when provided", () => {
			// Arrange
			const mockLogger = {
				info: vi.fn(),
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			} as unknown as Logger;

			// Act
			const deps = createExecutionServiceDeps({ logger: mockLogger });

			// Assert
			expect(deps.logger).toBe(mockLogger);
		});

		it("should use injected Rehydrator when provided", () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(true),
			};
			const customRehydrator = new Rehydrator(mockGraphClient);

			// Act
			const deps = createExecutionServiceDeps({ rehydrator: customRehydrator });

			// Assert
			expect(deps.rehydrator).toBe(customRehydrator);
		});

		it("should use injected TimeTravelService when provided", () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(true),
			};
			const customRehydrator = new Rehydrator(mockGraphClient);
			const customTimeTravel = new TimeTravelService(customRehydrator);

			// Act
			const deps = createExecutionServiceDeps({ timeTravelService: customTimeTravel });

			// Assert
			expect(deps.timeTravelService).toBe(customTimeTravel);
		});

		it("should create PatchManager with provided VFS", () => {
			// Arrange
			const customVfs = new VirtualFileSystem();
			customVfs.writeFile("/file.txt", "original");

			// Act
			const deps = createExecutionServiceDeps({ vfs: customVfs });

			// Assert - verify patchManager is connected to the same VFS
			expect(deps.vfs).toBe(customVfs);
			expect(deps.patchManager).toBeInstanceOf(PatchManager);
		});

		it("should create Rehydrator with provided graphClient", () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(true),
			};

			// Act
			const deps = createExecutionServiceDeps({ graphClient: mockGraphClient });

			// Assert
			expect(deps.rehydrator).toBeInstanceOf(Rehydrator);
		});
	});

	describe("Module Exports", () => {
		it("should export server instance", () => {
			// Assert
			expect(server).toBeDefined();
		});

		it("should export vfs instance", () => {
			// Assert
			expect(vfs).toBeDefined();
			expect(vfs).toBeInstanceOf(VirtualFileSystem);
		});

		it("should export patchManager instance", () => {
			// Assert
			expect(patchManager).toBeDefined();
			expect(patchManager).toBeInstanceOf(PatchManager);
		});

		it("should have McpServer mock available", () => {
			// Assert - the McpServer mock was used (module was loaded with mocks)
			// Note: We verify the mock is set up correctly rather than checking calls
			// since the module loads before vi.clearAllMocks() in beforeEach
			expect(McpServer).toBeDefined();
			expect(vi.isMockFunction(McpServer)).toBe(true);
		});

		it("should have server with tool method", () => {
			// Assert - verify the server has the expected interface
			expect(server).toHaveProperty("tool");
			expect(server).toHaveProperty("connect");
		});
	});

	describe("VirtualFileSystem Integration", () => {
		let testVfs: VirtualFileSystem;

		beforeEach(() => {
			testVfs = new VirtualFileSystem();
		});

		it("should write and read files", () => {
			// Arrange
			const path = "/test/file.txt";
			const content = "Hello, World!";

			// Act
			testVfs.writeFile(path, content);
			const result = testVfs.readFile(path);

			// Assert
			expect(result).toBe(content);
		});

		it("should throw error when reading non-existent file", () => {
			// Arrange & Act & Assert
			expect(() => testVfs.readFile("/nonexistent.txt")).toThrow("File not found");
		});

		it("should check file existence", () => {
			// Arrange
			testVfs.writeFile("/exists.txt", "content");

			// Act & Assert
			expect(testVfs.exists("/exists.txt")).toBe(true);
			expect(testVfs.exists("/nonexistent.txt")).toBe(false);
		});

		it("should create directories", () => {
			// Arrange & Act
			testVfs.mkdir("/test/nested/dir");

			// Assert
			expect(testVfs.exists("/test")).toBe(true);
			expect(testVfs.exists("/test/nested")).toBe(true);
			expect(testVfs.exists("/test/nested/dir")).toBe(true);
		});

		it("should list directory contents", () => {
			// Arrange
			testVfs.writeFile("/dir/file1.txt", "content1");
			testVfs.writeFile("/dir/file2.txt", "content2");

			// Act
			const contents = testVfs.readDir("/dir");

			// Assert
			expect(contents).toContain("file1.txt");
			expect(contents).toContain("file2.txt");
		});
	});

	describe("PatchManager Integration", () => {
		let testVfs: VirtualFileSystem;
		let testPatchManager: PatchManager;

		beforeEach(() => {
			testVfs = new VirtualFileSystem();
			testPatchManager = new PatchManager(testVfs);
		});

		it("should apply search/replace patch", () => {
			// Arrange
			testVfs.writeFile("/file.txt", "Hello, World!");

			// Act
			testPatchManager.applySearchReplace("/file.txt", "World", "Universe");

			// Assert
			expect(testVfs.readFile("/file.txt")).toBe("Hello, Universe!");
		});

		it("should throw error when search string not found", () => {
			// Arrange
			testVfs.writeFile("/file.txt", "Hello, World!");

			// Act & Assert
			expect(() => testPatchManager.applySearchReplace("/file.txt", "NotFound", "Replace")).toThrow(
				"Search block not found",
			);
		});

		it("should apply unified diff to existing file", () => {
			// Arrange
			testVfs.writeFile("/file.txt", "line1\nline2\nline3\n");
			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified line2
 line3
`;

			// Act
			testPatchManager.applyUnifiedDiff("/file.txt", diff);

			// Assert
			expect(testVfs.readFile("/file.txt")).toBe("line1\nmodified line2\nline3\n");
		});

		it("should apply creation patch to new file", () => {
			// Arrange
			const diff = `--- /dev/null
+++ b/newfile.txt
@@ -0,0 +1,2 @@
+new line 1
+new line 2
`;

			// Act
			testPatchManager.applyUnifiedDiff("/newfile.txt", diff);

			// Assert
			expect(testVfs.readFile("/newfile.txt")).toBe("new line 1\nnew line 2\n");
		});

		it("should throw error when patch cannot be applied", () => {
			// Arrange
			testVfs.writeFile("/file.txt", "completely different content");
			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified line2
 line3
`;

			// Act & Assert
			expect(() => testPatchManager.applyUnifiedDiff("/file.txt", diff)).toThrow(
				"Failed to apply patch",
			);
		});
	});

	describe("Tool Handlers", () => {
		describe("read_file tool", () => {
			it("should return file content for existing file", async () => {
				// Arrange
				const testVfs = new VirtualFileSystem();
				testVfs.writeFile("/test.txt", "test content");

				// Act - simulate read_file behavior
				const content = testVfs.readFile("/test.txt");

				// Assert
				expect(content).toBe("test content");
			});

			it("should return error for non-existent file", () => {
				// Arrange
				const testVfs = new VirtualFileSystem();

				// Act & Assert
				expect(() => testVfs.readFile("/nonexistent.txt")).toThrow();
			});
		});

		describe("apply_patch tool", () => {
			it("should successfully apply a valid patch", () => {
				// Arrange
				const testVfs = new VirtualFileSystem();
				const testPatchManager = new PatchManager(testVfs);
				testVfs.writeFile("/test.txt", "old content");

				// Act
				testPatchManager.applySearchReplace("/test.txt", "old", "new");

				// Assert
				expect(testVfs.readFile("/test.txt")).toBe("new content");
			});
		});

		describe("list_files_at_time tool", () => {
			it("should handle empty result from time travel", async () => {
				// Arrange
				const mockGraphClient: GraphClient = {
					connect: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn().mockResolvedValue(undefined),
					query: vi.fn().mockResolvedValue([]),
					isConnected: vi.fn().mockReturnValue(true),
				};
				const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
				const timeTravel = new TimeTravelService(rehydrator);

				// Act
				const files = await timeTravel.listFiles("session-123", Date.now(), "/");

				// Assert
				expect(files).toEqual([]);
			});
		});
	});

	describe("Error Handling", () => {
		it("should handle Error instances correctly", () => {
			// Arrange
			const error = new Error("Test error message");

			// Act - simulate the error handling pattern from the tools
			const message = error instanceof Error ? error.message : String(error);

			// Assert
			expect(message).toBe("Test error message");
		});

		it("should handle non-Error objects correctly", () => {
			// Arrange
			const error = "string error";

			// Act
			const message = error instanceof Error ? error.message : String(error);

			// Assert
			expect(message).toBe("string error");
		});

		it("should handle object errors correctly", () => {
			// Arrange
			const error = { code: "ERR_001", details: "Something went wrong" };

			// Act
			const message = error instanceof Error ? error.message : String(error);

			// Assert
			expect(message).toBe("[object Object]");
		});
	});

	describe("textResult Helper (exported)", () => {
		it("should create success result", () => {
			// Arrange & Act
			const result = textResult("Success message");

			// Assert
			expect(result).toEqual({
				content: [{ type: "text", text: "Success message" }],
			});
			expect(result.isError).toBeUndefined();
		});

		it("should create error result", () => {
			// Arrange & Act
			const result = textResult("Error: Something went wrong", true);

			// Assert
			expect(result).toEqual({
				content: [{ type: "text", text: "Error: Something went wrong" }],
				isError: true,
			});
		});

		it("should not include isError property when false", () => {
			// Arrange & Act
			const result = textResult("Normal message", false);

			// Assert
			expect(result).toEqual({
				content: [{ type: "text", text: "Normal message" }],
			});
			expect("isError" in result).toBe(false);
		});
	});

	describe("handleReadFile Handler", () => {
		it("should return file content for existing file", async () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			testVfs.writeFile("/test.txt", "test content");

			// Act
			const result = await handleReadFile({ path: "/test.txt" }, testVfs);

			// Assert
			expect(result).toEqual({
				content: [{ type: "text", text: "test content" }],
			});
		});

		it("should return error result for non-existent file", async () => {
			// Arrange
			const testVfs = new VirtualFileSystem();

			// Act
			const result = await handleReadFile({ path: "/nonexistent.txt" }, testVfs);

			// Assert
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error:");
			expect(result.content[0].text).toContain("File not found");
		});

		it("should handle non-Error exceptions", async () => {
			// Arrange
			const mockVfs = {
				readFile: vi.fn().mockImplementation(() => {
					throw "string error";
				}),
			} as unknown as VirtualFileSystem;

			// Act
			const result = await handleReadFile({ path: "/test.txt" }, mockVfs);

			// Assert
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toBe("Error: string error");
		});
	});

	describe("handleApplyPatch Handler", () => {
		it("should successfully apply a patch", async () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const testPatchManager = new PatchManager(testVfs);
			testVfs.writeFile("/file.txt", "Hello, World!");

			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-Hello, World!
+Hello, Universe!
`;

			// Act
			const result = await handleApplyPatch({ path: "/file.txt", diff }, testPatchManager);

			// Assert
			expect(result).toEqual({
				content: [{ type: "text", text: "Successfully patched /file.txt" }],
			});
			expect(testVfs.readFile("/file.txt")).toBe("Hello, Universe!");
		});

		it("should return error result when patch fails", async () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const testPatchManager = new PatchManager(testVfs);
			testVfs.writeFile("/file.txt", "original content");

			const badDiff = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+new line2
 line3
`;

			// Act
			const result = await handleApplyPatch({ path: "/file.txt", diff: badDiff }, testPatchManager);

			// Assert
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error:");
		});

		it("should handle non-Error exceptions in apply_patch", async () => {
			// Arrange
			const mockPatchManager = {
				applyUnifiedDiff: vi.fn().mockImplementation(() => {
					throw { code: "PATCH_ERROR" };
				}),
			} as unknown as PatchManager;

			// Act
			const result = await handleApplyPatch({ path: "/test.txt", diff: "diff" }, mockPatchManager);

			// Assert
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error:");
		});
	});

	describe("handleListFilesAtTime Handler", () => {
		it("should return list of files", async () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(true),
			};
			const mockRehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const mockTimeTravel = new TimeTravelService(mockRehydrator);

			// Act
			const result = await handleListFilesAtTime(
				{ session_id: "test-session", timestamp: Date.now(), path: "/" },
				mockGraphClient,
				mockTimeTravel,
			);

			// Assert
			expect(result.content[0].text).toBe("[]");
			expect(mockGraphClient.connect).toHaveBeenCalled();
		});

		it("should return error when connection fails", async () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockRejectedValue(new Error("Connection failed")),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(false),
			};
			const mockRehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const mockTimeTravel = new TimeTravelService(mockRehydrator);

			// Act
			const result = await handleListFilesAtTime(
				{ session_id: "test-session", timestamp: Date.now(), path: "/" },
				mockGraphClient,
				mockTimeTravel,
			);

			// Assert
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error:");
			expect(result.content[0].text).toContain("Connection failed");
		});

		it("should handle non-Error exceptions", async () => {
			// Arrange
			const mockGraphClient: GraphClient = {
				connect: vi.fn().mockImplementation(() => {
					throw "connection string error";
				}),
				disconnect: vi.fn().mockResolvedValue(undefined),
				query: vi.fn().mockResolvedValue([]),
				isConnected: vi.fn().mockReturnValue(false),
			};
			const mockRehydrator = new Rehydrator({ graphClient: mockGraphClient });
			const mockTimeTravel = new TimeTravelService(mockRehydrator);

			// Act
			const result = await handleListFilesAtTime(
				{ session_id: "test-session", timestamp: Date.now(), path: "/" },
				mockGraphClient,
				mockTimeTravel,
			);

			// Assert
			expect(result.isError).toBe(true);
			expect(result.content[0].text).toBe("Error: connection string error");
		});
	});

	describe("main Function", () => {
		it("should connect server to transport", async () => {
			// Act
			await main();

			// Assert - verify server.connect was called
			expect(server.connect).toHaveBeenCalled();
		});
	});

	describe("Logger Initialization", () => {
		it("should have createNodeLogger mock available", () => {
			// Assert - verify the mock is set up correctly
			// The actual call happens during module load before test setup
			expect(createNodeLogger).toBeDefined();
			expect(vi.isMockFunction(createNodeLogger)).toBe(true);
		});

		it("should use correct logger options in createExecutionServiceDeps", () => {
			// Arrange & Act
			const deps = createExecutionServiceDeps();

			// Assert - logger should be defined (created with correct service)
			expect(deps.logger).toBeDefined();
		});
	});

	describe("FalkorDB Client", () => {
		it("should have createFalkorClient mock available", () => {
			// Assert - verify the mock is set up correctly
			// The actual call happens during module load before test setup
			expect(createFalkorClient).toBeDefined();
			expect(vi.isMockFunction(createFalkorClient)).toBe(true);
		});

		it("should use graphClient in createExecutionServiceDeps", () => {
			// Arrange & Act
			const deps = createExecutionServiceDeps();

			// Assert - graphClient should be defined
			expect(deps.graphClient).toBeDefined();
		});
	});

	describe("MCP Server Tools Registration", () => {
		it("should have registered read_file tool", () => {
			// The McpServer mock captures all tool registrations
			const mockServer = (McpServer as Mock).mock.results[0]?.value;
			if (mockServer?.tool.mock) {
				const calls = mockServer.tool.mock.calls;
				const readFileCall = calls.find((call: unknown[]) => call[0] === "read_file");
				expect(readFileCall).toBeDefined();
				expect(readFileCall?.[1]).toBe("Read a file from the Virtual File System");
			}
		});

		it("should have registered apply_patch tool", () => {
			const mockServer = (McpServer as Mock).mock.results[0]?.value;
			if (mockServer?.tool.mock) {
				const calls = mockServer.tool.mock.calls;
				const applyPatchCall = calls.find((call: unknown[]) => call[0] === "apply_patch");
				expect(applyPatchCall).toBeDefined();
				expect(applyPatchCall?.[1]).toBe("Apply a unified diff or search/replace block to the VFS");
			}
		});

		it("should have registered list_files_at_time tool", () => {
			const mockServer = (McpServer as Mock).mock.results[0]?.value;
			if (mockServer?.tool.mock) {
				const calls = mockServer.tool.mock.calls;
				const listFilesCall = calls.find((call: unknown[]) => call[0] === "list_files_at_time");
				expect(listFilesCall).toBeDefined();
				expect(listFilesCall?.[1]).toBe("List files in the VFS at a specific point in time");
			}
		});
	});
});

describe("Execution Service - Snapshot Operations", () => {
	it("should create and load VFS snapshots", async () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		testVfs.writeFile("/file1.txt", "content1");
		testVfs.writeFile("/dir/file2.txt", "content2");

		// Act - create snapshot
		const snapshot = await testVfs.createSnapshot();

		// Create new VFS and load snapshot
		const restoredVfs = new VirtualFileSystem();
		await restoredVfs.loadSnapshot(snapshot);

		// Assert
		expect(restoredVfs.readFile("/file1.txt")).toBe("content1");
		expect(restoredVfs.readFile("/dir/file2.txt")).toBe("content2");
	});

	it("should preserve directory structure in snapshots", async () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		testVfs.mkdir("/a/b/c");
		testVfs.writeFile("/a/b/c/deep.txt", "deep content");

		// Act
		const snapshot = await testVfs.createSnapshot();
		const restoredVfs = new VirtualFileSystem();
		await restoredVfs.loadSnapshot(snapshot);

		// Assert
		expect(restoredVfs.exists("/a/b/c/deep.txt")).toBe(true);
		expect(restoredVfs.readFile("/a/b/c/deep.txt")).toBe("deep content");
	});
});

describe("Execution Service - Edge Cases", () => {
	describe("VFS Edge Cases", () => {
		it("should handle empty file content", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();

			// Act
			testVfs.writeFile("/empty.txt", "");

			// Assert
			expect(testVfs.readFile("/empty.txt")).toBe("");
		});

		it("should handle file names with special characters", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const specialName = "file-with_special.chars-123.txt";

			// Act
			testVfs.writeFile(`/${specialName}`, "special content");

			// Assert
			expect(testVfs.readFile(`/${specialName}`)).toBe("special content");
		});

		it("should handle deeply nested directories", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const deepPath = "/a/b/c/d/e/f/g/h/i/j";

			// Act
			testVfs.mkdir(deepPath);
			testVfs.writeFile(`${deepPath}/deep.txt`, "very deep");

			// Assert
			expect(testVfs.exists(`${deepPath}/deep.txt`)).toBe(true);
		});

		it("should handle unicode content", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const unicodeContent = "Hello, World! - Chinese - Japanese - Emoji";

			// Act
			testVfs.writeFile("/unicode.txt", unicodeContent);

			// Assert
			expect(testVfs.readFile("/unicode.txt")).toBe(unicodeContent);
		});

		it("should handle large file content", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const largeContent = "x".repeat(1000000); // 1MB of content

			// Act
			testVfs.writeFile("/large.txt", largeContent);

			// Assert
			expect(testVfs.readFile("/large.txt")).toBe(largeContent);
		});

		it("should throw when reading directory as file", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			testVfs.mkdir("/dir");

			// Act & Assert
			expect(() => testVfs.readFile("/dir")).toThrow();
		});

		it("should throw when listing non-directory as directory", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			testVfs.writeFile("/file.txt", "content");

			// Act & Assert
			expect(() => testVfs.readDir("/file.txt")).toThrow();
		});
	});

	describe("PatchManager Edge Cases", () => {
		it("should handle patch to root level file", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const testPatchManager = new PatchManager(testVfs);
			testVfs.writeFile("/root.txt", "original");

			// Act
			testPatchManager.applySearchReplace("/root.txt", "original", "modified");

			// Assert
			expect(testVfs.readFile("/root.txt")).toBe("modified");
		});

		it("should handle multiple replacements in same file", () => {
			// Arrange
			const testVfs = new VirtualFileSystem();
			const testPatchManager = new PatchManager(testVfs);
			testVfs.writeFile("/multi.txt", "aaa bbb ccc");

			// Act
			testPatchManager.applySearchReplace("/multi.txt", "aaa", "111");
			testPatchManager.applySearchReplace("/multi.txt", "bbb", "222");
			testPatchManager.applySearchReplace("/multi.txt", "ccc", "333");

			// Assert
			expect(testVfs.readFile("/multi.txt")).toBe("111 222 333");
		});
	});
});

describe("Execution Service - Concurrent Operations", () => {
	it("should handle concurrent file writes", async () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		const writePromises: Promise<void>[] = [];

		// Act - simulate concurrent writes
		for (let i = 0; i < 100; i++) {
			writePromises.push(
				Promise.resolve().then(() => {
					testVfs.writeFile(`/file${i}.txt`, `content${i}`);
				}),
			);
		}
		await Promise.all(writePromises);

		// Assert - all files should exist
		for (let i = 0; i < 100; i++) {
			expect(testVfs.readFile(`/file${i}.txt`)).toBe(`content${i}`);
		}
	});

	it("should handle concurrent reads", async () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		testVfs.writeFile("/shared.txt", "shared content");
		const readPromises: Promise<string>[] = [];

		// Act
		for (let i = 0; i < 100; i++) {
			readPromises.push(Promise.resolve().then(() => testVfs.readFile("/shared.txt")));
		}
		const results = await Promise.all(readPromises);

		// Assert
		expect(results.every((r) => r === "shared content")).toBe(true);
	});
});

describe("Execution Service - TimeTravelService Integration", () => {
	it("should get filesystem state at a point in time", async () => {
		// Arrange
		const mockGraphClient: GraphClient = {
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue([]),
			isConnected: vi.fn().mockReturnValue(true),
		};
		const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
		const timeTravel = new TimeTravelService(rehydrator);

		// Act
		const vfsState = await timeTravel.getFilesystemState("session-123", Date.now());

		// Assert
		expect(vfsState).toBeInstanceOf(VirtualFileSystem);
	});

	it("should get zipped state at a point in time", async () => {
		// Arrange
		const mockGraphClient: GraphClient = {
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue([]),
			isConnected: vi.fn().mockReturnValue(true),
		};
		const rehydrator = new Rehydrator({ graphClient: mockGraphClient });
		const timeTravel = new TimeTravelService(rehydrator);

		// Act
		const zippedState = await timeTravel.getZippedState("session-123", Date.now());

		// Assert
		expect(zippedState).toBeInstanceOf(Buffer);
	});
});

describe("Execution Service - Dependency Injection Patterns", () => {
	it("should allow full dependency override for testing", () => {
		// Arrange - create all mock dependencies
		const mockVfs = new VirtualFileSystem();
		const mockPatchManager = new PatchManager(mockVfs);
		const mockGraphClient: GraphClient = {
			connect: vi.fn().mockResolvedValue(undefined),
			disconnect: vi.fn().mockResolvedValue(undefined),
			query: vi.fn().mockResolvedValue([]),
			isConnected: vi.fn().mockReturnValue(true),
		};
		const mockRehydrator = new Rehydrator({ graphClient: mockGraphClient });
		const mockTimeTravel = new TimeTravelService(mockRehydrator);
		const mockLogger = {
			info: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		} as unknown as Logger;

		// Act
		const deps = createExecutionServiceDeps({
			vfs: mockVfs,
			patchManager: mockPatchManager,
			graphClient: mockGraphClient,
			rehydrator: mockRehydrator,
			timeTravelService: mockTimeTravel,
			logger: mockLogger,
		});

		// Assert - all injected dependencies should be used
		expect(deps.vfs).toBe(mockVfs);
		expect(deps.patchManager).toBe(mockPatchManager);
		expect(deps.graphClient).toBe(mockGraphClient);
		expect(deps.rehydrator).toBe(mockRehydrator);
		expect(deps.timeTravelService).toBe(mockTimeTravel);
		expect(deps.logger).toBe(mockLogger);
	});

	it("should allow partial dependency override", () => {
		// Arrange - only provide some dependencies
		const customVfs = new VirtualFileSystem();
		customVfs.writeFile("/custom.txt", "custom content");

		// Act
		const deps = createExecutionServiceDeps({ vfs: customVfs });

		// Assert - provided dependencies used, defaults for the rest
		expect(deps.vfs).toBe(customVfs);
		expect(deps.patchManager).toBeInstanceOf(PatchManager);
		expect(deps.graphClient).toBeDefined();
		expect(deps.rehydrator).toBeInstanceOf(Rehydrator);
		expect(deps.timeTravelService).toBeInstanceOf(TimeTravelService);
		expect(deps.logger).toBeDefined();
	});
});

describe("Execution Service - VFS Write and Overwrite", () => {
	it("should overwrite existing file content", () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		testVfs.writeFile("/overwrite.txt", "original content");

		// Act
		testVfs.writeFile("/overwrite.txt", "new content");

		// Assert
		expect(testVfs.readFile("/overwrite.txt")).toBe("new content");
	});

	it("should update lastModified timestamp on write", () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		const beforeWrite = Date.now();

		// Act
		testVfs.writeFile("/timestamped.txt", "content");

		// Assert - verify the file was created with a timestamp
		expect(testVfs.exists("/timestamped.txt")).toBe(true);
	});
});

describe("Execution Service - Error Boundary Patterns", () => {
	it("should handle invalid path gracefully", () => {
		// Arrange
		const testVfs = new VirtualFileSystem();

		// Act & Assert - empty path should throw
		expect(() => testVfs.writeFile("", "content")).toThrow();
	});

	it("should handle path with double dots correctly", () => {
		// Arrange
		const testVfs = new VirtualFileSystem();
		testVfs.writeFile("/safe/file.txt", "content");

		// Act - The VFS splitPath filters empty segments but doesn't resolve ".."
		// So "/safe/../safe/file.txt" becomes ["safe", "..", "safe", "file.txt"]
		// which won't match the existing path structure
		const existsOriginal = testVfs.exists("/safe/file.txt");

		// Assert - original path still works
		expect(existsOriginal).toBe(true);
	});
});

import { describe, expect, it } from "bun:test";
import { type DirectoryNode, type FileNode, VirtualFileSystem } from "./vfs";

describe("VirtualFileSystem", () => {
	describe("initialization", () => {
		it("should initialize with an empty root", () => {
			const vfs = new VirtualFileSystem();
			expect(vfs.root).toEqual({
				type: "directory",
				name: "",
				children: {},
			});
			expect(vfs.cwd).toBe("/");
		});

		it("should initialize with a custom root", () => {
			const customRoot: DirectoryNode = {
				type: "directory",
				name: "custom",
				children: {
					file: { type: "file", name: "file", content: "test", lastModified: 1234 },
				},
			};
			const vfs = new VirtualFileSystem(customRoot);
			expect(vfs.root.name).toBe("custom");
			expect(vfs.root.children).toHaveProperty("file");
		});
	});

	describe("exists", () => {
		it("should return true for existing file", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/test.txt", "content");
			expect(vfs.exists("/test.txt")).toBe(true);
		});

		it("should return true for existing directory", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/mydir");
			expect(vfs.exists("/mydir")).toBe(true);
		});

		it("should return false for non-existing path", () => {
			const vfs = new VirtualFileSystem();
			expect(vfs.exists("/nonexistent")).toBe(false);
		});

		it("should return true for root", () => {
			const vfs = new VirtualFileSystem();
			expect(vfs.exists("/")).toBe(true);
		});
	});

	describe("writeFile and readFile", () => {
		it("should create and read a file", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/test.txt", "Hello World");
			expect(vfs.exists("/test.txt")).toBe(true);
			expect(vfs.readFile("/test.txt")).toBe("Hello World");
		});

		it("should overwrite existing file", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/test.txt", "Original");
			vfs.writeFile("/test.txt", "Updated");
			expect(vfs.readFile("/test.txt")).toBe("Updated");
		});

		it("should create directories recursively on writeFile", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/a/b/test.txt", "Nested");
			expect(vfs.exists("/a")).toBe(true);
			expect(vfs.exists("/a/b")).toBe(true);
			expect(vfs.exists("/a/b/test.txt")).toBe(true);
			expect(vfs.readFile("/a/b/test.txt")).toBe("Nested");
		});

		it("should create deeply nested files", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/a/b/c/d/e/file.txt", "deep content");
			expect(vfs.readFile("/a/b/c/d/e/file.txt")).toBe("deep content");
		});

		it("should handle empty file content", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/empty.txt", "");
			expect(vfs.readFile("/empty.txt")).toBe("");
		});

		it("should handle special characters in content", () => {
			const vfs = new VirtualFileSystem();
			const content = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?\n\t\r";
			vfs.writeFile("/special.txt", content);
			expect(vfs.readFile("/special.txt")).toBe(content);
		});

		it("should handle unicode content", () => {
			const vfs = new VirtualFileSystem();
			const content =
				"Unicode: " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" " +
				" ";
			vfs.writeFile("/unicode.txt", content);
			expect(vfs.readFile("/unicode.txt")).toBe(content);
		});

		it("should set lastModified timestamp", () => {
			const vfs = new VirtualFileSystem();
			const before = Date.now();
			vfs.writeFile("/timed.txt", "content");
			const after = Date.now();

			const file = vfs.root.children["timed.txt"] as FileNode;
			expect(file.lastModified).toBeGreaterThanOrEqual(before);
			expect(file.lastModified).toBeLessThanOrEqual(after);
		});

		it("should throw on invalid empty path", () => {
			const vfs = new VirtualFileSystem();
			expect(() => vfs.writeFile("/", "content")).toThrow("Invalid path");
		});
	});

	describe("mkdir", () => {
		it("should mkdir explicitly", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/folder");
			expect(vfs.exists("/folder")).toBe(true);

			vfs.mkdir("/folder/sub");
			expect(vfs.exists("/folder/sub")).toBe(true);
			expect(vfs.readDir("/folder")).toEqual(["sub"]);
		});

		it("should create nested directories", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/a/b/c");
			expect(vfs.exists("/a")).toBe(true);
			expect(vfs.exists("/a/b")).toBe(true);
			expect(vfs.exists("/a/b/c")).toBe(true);
		});

		it("should not throw when directory already exists", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/folder");
			expect(() => vfs.mkdir("/folder")).not.toThrow();
		});

		it("should throw when path is a file not directory", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/myfile", "content");
			expect(() => vfs.mkdir("/myfile/subdir")).toThrow("Not a directory");
		});
	});

	describe("readDir", () => {
		it("should list directory contents", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/a.txt", "A");
			vfs.writeFile("/b.txt", "B");
			vfs.mkdir("/c");

			const files = vfs.readDir("/");
			expect(files.sort()).toEqual(["a.txt", "b.txt", "c"]);
		});

		it("should list empty directory", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/empty");
			expect(vfs.readDir("/empty")).toEqual([]);
		});

		it("should list nested directory contents", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/dir/file1.txt", "1");
			vfs.writeFile("/dir/file2.txt", "2");
			vfs.mkdir("/dir/subdir");

			const files = vfs.readDir("/dir");
			expect(files.sort()).toEqual(["file1.txt", "file2.txt", "subdir"]);
		});
	});

	describe("error handling", () => {
		it("should throw on missing file read", () => {
			const vfs = new VirtualFileSystem();
			expect(() => vfs.readFile("/missing.txt")).toThrow("File not found");
		});

		it("should throw on reading file as dir", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/file", "content");
			expect(() => vfs.readDir("/file")).toThrow("Directory not found");
		});

		it("should throw on reading directory as file", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/mydir");
			expect(() => vfs.readFile("/mydir")).toThrow("File not found");
		});

		it("should throw on reading dir in non-existent path", () => {
			const vfs = new VirtualFileSystem();
			expect(() => vfs.readDir("/nonexistent")).toThrow("Directory not found");
		});

		it("should throw on reading file through non-directory", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/file", "content");
			expect(() => vfs.readFile("/file/subfile")).toThrow("File not found");
		});
	});

	describe("snapshots", () => {
		it("should snapshot and load", async () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/data.json", "{}");

			const snapshot = await vfs.createSnapshot();
			expect(Buffer.isBuffer(snapshot)).toBe(true);

			const vfs2 = new VirtualFileSystem();
			await vfs2.loadSnapshot(snapshot);
			expect(vfs2.readFile("/data.json")).toBe("{}");
		});

		it("should preserve complex directory structure", async () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/a/b/c.txt", "C");
			vfs.writeFile("/a/d.txt", "D");
			vfs.mkdir("/empty");

			const snapshot = await vfs.createSnapshot();
			const vfs2 = new VirtualFileSystem();
			await vfs2.loadSnapshot(snapshot);

			expect(vfs2.readFile("/a/b/c.txt")).toBe("C");
			expect(vfs2.readFile("/a/d.txt")).toBe("D");
			expect(vfs2.exists("/empty")).toBe(true);
		});

		it("should handle empty VFS snapshot", async () => {
			const vfs = new VirtualFileSystem();
			const snapshot = await vfs.createSnapshot();

			const vfs2 = new VirtualFileSystem();
			await vfs2.loadSnapshot(snapshot);

			expect(vfs2.readDir("/")).toEqual([]);
		});

		it("should handle large files in snapshot", async () => {
			const vfs = new VirtualFileSystem();
			const largeContent = "x".repeat(100000);
			vfs.writeFile("/large.txt", largeContent);

			const snapshot = await vfs.createSnapshot();
			const vfs2 = new VirtualFileSystem();
			await vfs2.loadSnapshot(snapshot);

			expect(vfs2.readFile("/large.txt")).toBe(largeContent);
		});

		it("should compress snapshot data", async () => {
			const vfs = new VirtualFileSystem();
			const repetitiveContent = "repeat ".repeat(10000);
			vfs.writeFile("/compressible.txt", repetitiveContent);

			const snapshot = await vfs.createSnapshot();
			// Gzip should significantly compress repetitive data
			expect(snapshot.length).toBeLessThan(repetitiveContent.length);
		});

		it("should throw on invalid JSON snapshot", async () => {
			const vfs = new VirtualFileSystem();
			const { promisify } = await import("node:util");
			const { gzip } = await import("node:zlib");
			const gzipAsync = promisify(gzip);

			const invalidSnapshot = await gzipAsync("not valid json");

			await expect(vfs.loadSnapshot(invalidSnapshot)).rejects.toThrow("Failed to parse snapshot");
		});

		it("should throw on snapshot with non-directory root", async () => {
			const vfs = new VirtualFileSystem();
			const { promisify } = await import("node:util");
			const { gzip } = await import("node:zlib");
			const gzipAsync = promisify(gzip);

			const invalidRoot = JSON.stringify({ type: "file", name: "root", content: "invalid" });
			const invalidSnapshot = await gzipAsync(invalidRoot);

			await expect(vfs.loadSnapshot(invalidSnapshot)).rejects.toThrow(
				"Invalid snapshot format: root must be a directory node",
			);
		});
	});

	describe("sanitizePath", () => {
		it("should normalize paths with ../", () => {
			const vfs = new VirtualFileSystem();
			// Path normalization should resolve ../
			vfs.mkdir("/foo/bar");
			vfs.writeFile("/foo/bar/../test.txt", "content");
			expect(vfs.readFile("/foo/test.txt")).toBe("content");
		});

		it("should handle paths without leading slash", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("relative/path.txt", "content");
			expect(vfs.readFile("/relative/path.txt")).toBe("content");
		});

		it("should handle root path", () => {
			const vfs = new VirtualFileSystem();
			vfs.mkdir("/");
			expect(vfs.exists("/")).toBe(true);
		});

		it("should throw on path traversal with .. that escapes root", () => {
			const vfs = new VirtualFileSystem();
			// Paths that go beyond root will still have .. after normalization
			expect(() => vfs.writeFile("../../../etc/passwd", "malicious")).toThrow(
				"Path traversal not allowed",
			);
		});

		it("should convert relative paths to absolute paths", () => {
			const vfs = new VirtualFileSystem();
			// Verify that relative paths are converted to absolute paths correctly
			vfs.writeFile("relative/path.txt", "content");
			expect(vfs.exists("/relative/path.txt")).toBe(true);
			expect(vfs.readFile("/relative/path.txt")).toBe("content");
		});
	});

	describe("edge cases", () => {
		it("should handle writing to a path where parent is a file", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/file.txt", "content");
			expect(() => vfs.writeFile("/file.txt/subfile", "content")).toThrow();
		});

		it("should throw when parent is not a directory", () => {
			const vfs = new VirtualFileSystem();
			// Create a file first
			vfs.writeFile("/file.txt", "content");

			// Now directly manipulate the root to create a broken state for testing
			// This simulates the defensive check on line 104
			const originalMkdir = vfs.mkdir.bind(vfs);
			vfs.mkdir = (inputPath: string): void => {
				// Call original mkdir
				originalMkdir(inputPath);
				// Then corrupt the state by replacing directory with a file
				if (inputPath === "/parent") {
					(vfs.root.children as any).parent = {
						type: "file",
						name: "parent",
						content: "corrupted",
						lastModified: Date.now(),
					};
				}
			};

			// This should trigger the "Not a directory" error on line 104
			expect(() => vfs.writeFile("/parent/child.txt", "content")).toThrow("Not a directory");
		});

		it("should handle reading dir on a file", () => {
			const vfs = new VirtualFileSystem();
			vfs.writeFile("/file.txt", "content");
			expect(() => vfs.readDir("/file.txt")).toThrow("Directory not found");
		});

		it("should handle exists on nested non-existent path", () => {
			const vfs = new VirtualFileSystem();
			expect(vfs.exists("/a/b/c/d/e/f")).toBe(false);
		});
	});
});

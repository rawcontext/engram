import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryFileSystem } from "./memory-fs";

describe("InMemoryFileSystem", () => {
	let fs: InMemoryFileSystem;

	beforeEach(() => {
		fs = new InMemoryFileSystem();
	});

	describe("exists / existsAsync", () => {
		it("should return true for root directory", () => {
			expect(fs.exists("/")).toBe(true);
		});

		it("should return false for non-existent path", () => {
			expect(fs.exists("/nonexistent")).toBe(false);
		});

		it("should return true for existing file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");
			expect(fs.exists("/dir/file.txt")).toBe(true);
		});

		it("should return true for existing directory", () => {
			fs.mkdir("/mydir");
			expect(fs.exists("/mydir")).toBe(true);
		});

		it("should work async", async () => {
			fs.mkdir("/dir");
			expect(await fs.existsAsync("/dir")).toBe(true);
			expect(await fs.existsAsync("/nope")).toBe(false);
		});
	});

	describe("mkdir / mkdirAsync", () => {
		it("should create a directory", () => {
			fs.mkdir("/testdir");
			expect(fs.exists("/testdir")).toBe(true);
		});

		it("should throw when parent does not exist (non-recursive)", () => {
			expect(() => fs.mkdir("/a/b")).toThrow("ENOENT");
		});

		it("should create nested directories with recursive option", () => {
			fs.mkdir("/a/b/c", { recursive: true });
			expect(fs.exists("/a")).toBe(true);
			expect(fs.exists("/a/b")).toBe(true);
			expect(fs.exists("/a/b/c")).toBe(true);
		});

		it("should not throw when directory already exists", () => {
			fs.mkdir("/existing");
			expect(() => fs.mkdir("/existing")).not.toThrow();
		});

		it("should throw when path is a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file", "content");
			expect(() => fs.mkdir("/dir/file")).toThrow("EEXIST");
		});

		it("should work async", async () => {
			await fs.mkdirAsync("/asyncdir", { recursive: true });
			expect(fs.exists("/asyncdir")).toBe(true);
		});
	});

	describe("writeFile / writeFileAsync", () => {
		it("should write a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/test.txt", "hello");
			expect(fs.readFile("/dir/test.txt")).toBe("hello");
		});

		it("should overwrite existing file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/test.txt", "original");
			fs.writeFile("/dir/test.txt", "updated");
			expect(fs.readFile("/dir/test.txt")).toBe("updated");
		});

		it("should throw when parent directory does not exist", () => {
			expect(() => fs.writeFile("/nonexistent/file.txt", "content")).toThrow("ENOENT");
		});

		it("should handle Buffer content", () => {
			fs.mkdir("/dir");
			const buffer = Buffer.from("binary content");
			fs.writeFile("/dir/binary.bin", buffer);
			expect(fs.readFile("/dir/binary.bin")).toBe("binary content");
		});

		it("should work async", async () => {
			fs.mkdir("/dir");
			await fs.writeFileAsync("/dir/async.txt", "async content");
			expect(fs.readFile("/dir/async.txt")).toBe("async content");
		});
	});

	describe("readFile / readFileAsync", () => {
		it("should read a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/test.txt", "content");
			expect(fs.readFile("/dir/test.txt")).toBe("content");
		});

		it("should throw when file does not exist", () => {
			expect(() => fs.readFile("/nonexistent.txt")).toThrow("ENOENT");
		});

		it("should throw when trying to read a directory", () => {
			fs.mkdir("/mydir");
			expect(() => fs.readFile("/mydir")).toThrow("EISDIR");
		});

		it("should work async", async () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/test.txt", "async read");
			expect(await fs.readFileAsync("/dir/test.txt")).toBe("async read");
		});
	});

	describe("readDir / readDirAsync", () => {
		it("should list directory contents", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/a.txt", "a");
			fs.writeFile("/dir/b.txt", "b");
			fs.mkdir("/dir/subdir");

			const contents = fs.readDir("/dir");
			expect(contents).toEqual(["a.txt", "b.txt", "subdir"]);
		});

		it("should return empty array for empty directory", () => {
			fs.mkdir("/empty");
			expect(fs.readDir("/empty")).toEqual([]);
		});

		it("should throw when directory does not exist", () => {
			expect(() => fs.readDir("/nonexistent")).toThrow("ENOENT");
		});

		it("should throw when path is a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file", "content");
			expect(() => fs.readDir("/dir/file")).toThrow("ENOTDIR");
		});

		it("should list root directory contents", () => {
			fs.mkdir("/a");
			fs.mkdir("/b");
			const contents = fs.readDir("/");
			expect(contents).toEqual(["a", "b"]);
		});

		it("should work async", async () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");
			expect(await fs.readDirAsync("/dir")).toEqual(["file.txt"]);
		});
	});

	describe("unlink / unlinkAsync", () => {
		it("should delete a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");
			fs.unlink("/dir/file.txt");
			expect(fs.exists("/dir/file.txt")).toBe(false);
		});

		it("should throw when file does not exist", () => {
			expect(() => fs.unlink("/nonexistent.txt")).toThrow("ENOENT");
		});

		it("should throw when trying to unlink a directory", () => {
			fs.mkdir("/mydir");
			expect(() => fs.unlink("/mydir")).toThrow("EISDIR");
		});

		it("should work async", async () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");
			await fs.unlinkAsync("/dir/file.txt");
			expect(fs.exists("/dir/file.txt")).toBe(false);
		});
	});

	describe("rmdir / rmdirAsync", () => {
		it("should remove an empty directory", () => {
			fs.mkdir("/emptydir");
			fs.rmdir("/emptydir");
			expect(fs.exists("/emptydir")).toBe(false);
		});

		it("should throw when directory is not empty (non-recursive)", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");
			expect(() => fs.rmdir("/dir")).toThrow("ENOTEMPTY");
		});

		it("should remove directory and contents with recursive option", () => {
			fs.mkdir("/dir/subdir", { recursive: true });
			fs.writeFile("/dir/file.txt", "content");
			fs.writeFile("/dir/subdir/nested.txt", "nested");

			fs.rmdir("/dir", { recursive: true });

			expect(fs.exists("/dir")).toBe(false);
			expect(fs.exists("/dir/file.txt")).toBe(false);
			expect(fs.exists("/dir/subdir")).toBe(false);
		});

		it("should throw when directory does not exist", () => {
			expect(() => fs.rmdir("/nonexistent")).toThrow("ENOENT");
		});

		it("should throw when path is a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file", "content");
			expect(() => fs.rmdir("/dir/file")).toThrow("ENOTDIR");
		});

		it("should work async", async () => {
			fs.mkdir("/asyncdir");
			await fs.rmdirAsync("/asyncdir");
			expect(fs.exists("/asyncdir")).toBe(false);
		});
	});

	describe("stat / statAsync", () => {
		it("should return stats for a file", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");
			const stats = fs.stat("/dir/file.txt");

			expect(stats.isFile()).toBe(true);
			expect(stats.isDirectory()).toBe(false);
			expect(stats.size).toBe(7); // "content" is 7 bytes
			expect(stats.mtime).toBeInstanceOf(Date);
		});

		it("should return stats for a directory", () => {
			fs.mkdir("/mydir");
			const stats = fs.stat("/mydir");

			expect(stats.isFile()).toBe(false);
			expect(stats.isDirectory()).toBe(true);
			expect(stats.size).toBe(0);
			expect(stats.mtime).toBeInstanceOf(Date);
		});

		it("should throw when path does not exist", () => {
			expect(() => fs.stat("/nonexistent")).toThrow("ENOENT");
		});

		it("should work async", async () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "async");
			const stats = await fs.statAsync("/dir/file.txt");
			expect(stats.isFile()).toBe(true);
		});
	});

	describe("test helper methods", () => {
		it("should clear all entries", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file.txt", "content");

			fs.clear();

			expect(fs.exists("/")).toBe(true);
			expect(fs.exists("/dir")).toBe(false);
			expect(fs.getFileCount()).toBe(0);
		});

		it("should count files correctly", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/a.txt", "a");
			fs.writeFile("/dir/b.txt", "b");

			expect(fs.getFileCount()).toBe(2);
		});

		it("should count directories correctly", () => {
			fs.mkdir("/a");
			fs.mkdir("/b");
			fs.mkdir("/a/c");

			// Root + 3 created directories
			expect(fs.getDirectoryCount()).toBe(4);
		});

		it("should list all file paths", () => {
			fs.mkdir("/dir/subdir", { recursive: true });
			fs.writeFile("/dir/a.txt", "a");
			fs.writeFile("/dir/subdir/b.txt", "b");

			expect(fs.getAllFilePaths()).toEqual(["/dir/a.txt", "/dir/subdir/b.txt"]);
		});
	});

	describe("path normalization", () => {
		it("should handle paths without leading slash", () => {
			fs.mkdir("dir");
			expect(fs.exists("/dir")).toBe(true);
		});

		it("should handle trailing slashes", () => {
			fs.mkdir("/dir/");
			expect(fs.exists("/dir")).toBe(true);
		});

		it("should handle multiple slashes", () => {
			fs.mkdir("//dir///subdir//", { recursive: true });
			expect(fs.exists("/dir/subdir")).toBe(true);
		});
	});

	describe("edge cases", () => {
		it("should handle Buffer content with byteLength calculation", () => {
			fs.mkdir("/dir");
			const buffer = Buffer.from("test content");
			fs.writeFile("/dir/binary.bin", buffer);

			const stats = fs.stat("/dir/binary.bin");
			expect(stats.size).toBe(buffer.length);
		});

		it("should throw ENOTDIR when creating directory in file path", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file", "content");
			expect(() => fs.mkdir("/dir/file/subdir", { recursive: true })).toThrow("ENOTDIR");
		});

		it("should throw ENOTDIR when parent is a file (non-recursive mkdir)", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file", "content");
			// Trying to create a child of a file should throw ENOTDIR (parent is not a directory)
			expect(() => fs.mkdir("/dir/file/child")).toThrow("ENOTDIR");
		});

		it("should throw ENOTDIR when parent is a file (writeFile)", () => {
			fs.mkdir("/dir");
			fs.writeFile("/dir/file", "content");
			expect(() => fs.writeFile("/dir/file/nested.txt", "nested")).toThrow("ENOTDIR");
		});

		it("should handle async variants consistently", async () => {
			await fs.mkdirAsync("/dir");
			await fs.writeFileAsync("/dir/file.txt", "content");
			const content = await fs.readFileAsync("/dir/file.txt");
			expect(content).toBe("content");

			const entries = await fs.readDirAsync("/dir");
			expect(entries).toEqual(["file.txt"]);

			const stats = await fs.statAsync("/dir/file.txt");
			expect(stats.isFile()).toBe(true);

			await fs.unlinkAsync("/dir/file.txt");
			expect(fs.exists("/dir/file.txt")).toBe(false);

			await fs.rmdirAsync("/dir");
			expect(fs.exists("/dir")).toBe(false);
		});
	});
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { NodeFileSystem } from "./node-fs";

describe("NodeFileSystem", () => {
	let nodeFs: NodeFileSystem;
	let testDir: string;

	beforeEach(() => {
		// Create a unique temporary directory for each test
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), "node-fs-test-"));
		// Pass testDir as baseDir so all operations are within allowed directory
		nodeFs = new NodeFileSystem(testDir);
	});

	afterEach(() => {
		// Clean up test directory
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	describe("exists / existsAsync", () => {
		it("should return true for existing path", () => {
			const filePath = path.join(testDir, "test.txt");
			fs.writeFileSync(filePath, "content");
			expect(nodeFs.exists(filePath)).toBe(true);
		});

		it("should return false for non-existing path", () => {
			expect(nodeFs.exists(path.join(testDir, "nonexistent"))).toBe(false);
		});

		it("should work async", async () => {
			const filePath = path.join(testDir, "async.txt");
			fs.writeFileSync(filePath, "content");
			expect(await nodeFs.existsAsync(filePath)).toBe(true);
			expect(await nodeFs.existsAsync(path.join(testDir, "nope"))).toBe(false);
		});
	});

	describe("mkdir / mkdirAsync", () => {
		it("should create a directory", () => {
			const dirPath = path.join(testDir, "newdir");
			nodeFs.mkdir(dirPath);
			expect(fs.existsSync(dirPath)).toBe(true);
			expect(fs.statSync(dirPath).isDirectory()).toBe(true);
		});

		it("should create nested directories with recursive option", () => {
			const nestedPath = path.join(testDir, "a", "b", "c");
			nodeFs.mkdir(nestedPath, { recursive: true });
			expect(fs.existsSync(nestedPath)).toBe(true);
		});

		it("should work async", async () => {
			const dirPath = path.join(testDir, "asyncdir");
			await nodeFs.mkdirAsync(dirPath, { recursive: true });
			expect(fs.existsSync(dirPath)).toBe(true);
		});
	});

	describe("writeFile / writeFileAsync", () => {
		it("should write a file", () => {
			const filePath = path.join(testDir, "write.txt");
			nodeFs.writeFile(filePath, "test content");
			expect(fs.readFileSync(filePath, "utf-8")).toBe("test content");
		});

		it("should write Buffer content", () => {
			const filePath = path.join(testDir, "buffer.bin");
			const buffer = Buffer.from([0x01, 0x02, 0x03]);
			nodeFs.writeFile(filePath, buffer);
			expect(fs.readFileSync(filePath)).toEqual(buffer);
		});

		it("should work async", async () => {
			const filePath = path.join(testDir, "async-write.txt");
			await nodeFs.writeFileAsync(filePath, "async content");
			expect(fs.readFileSync(filePath, "utf-8")).toBe("async content");
		});
	});

	describe("readFile / readFileAsync", () => {
		it("should read a file", () => {
			const filePath = path.join(testDir, "read.txt");
			fs.writeFileSync(filePath, "read content");
			expect(nodeFs.readFile(filePath)).toBe("read content");
		});

		it("should work async", async () => {
			const filePath = path.join(testDir, "async-read.txt");
			fs.writeFileSync(filePath, "async read");
			expect(await nodeFs.readFileAsync(filePath)).toBe("async read");
		});
	});

	describe("readDir / readDirAsync", () => {
		it("should list directory contents", () => {
			fs.writeFileSync(path.join(testDir, "a.txt"), "a");
			fs.writeFileSync(path.join(testDir, "b.txt"), "b");
			fs.mkdirSync(path.join(testDir, "subdir"));

			const contents = nodeFs.readDir(testDir);
			expect(contents.sort()).toEqual(["a.txt", "b.txt", "subdir"]);
		});

		it("should work async", async () => {
			fs.writeFileSync(path.join(testDir, "file.txt"), "content");
			const contents = await nodeFs.readDirAsync(testDir);
			expect(contents).toContain("file.txt");
		});
	});

	describe("unlink / unlinkAsync", () => {
		it("should delete a file", () => {
			const filePath = path.join(testDir, "delete.txt");
			fs.writeFileSync(filePath, "to delete");
			nodeFs.unlink(filePath);
			expect(fs.existsSync(filePath)).toBe(false);
		});

		it("should work async", async () => {
			const filePath = path.join(testDir, "async-delete.txt");
			fs.writeFileSync(filePath, "to delete");
			await nodeFs.unlinkAsync(filePath);
			expect(fs.existsSync(filePath)).toBe(false);
		});
	});

	describe("rmdir / rmdirAsync", () => {
		it("should remove an empty directory", () => {
			const dirPath = path.join(testDir, "emptydir");
			fs.mkdirSync(dirPath);
			nodeFs.rmdir(dirPath);
			expect(fs.existsSync(dirPath)).toBe(false);
		});

		it("should remove directory recursively", () => {
			const dirPath = path.join(testDir, "nonempty");
			fs.mkdirSync(dirPath);
			fs.writeFileSync(path.join(dirPath, "file.txt"), "content");
			fs.mkdirSync(path.join(dirPath, "subdir"));

			nodeFs.rmdir(dirPath, { recursive: true });
			expect(fs.existsSync(dirPath)).toBe(false);
		});

		it("should work async", async () => {
			const dirPath = path.join(testDir, "async-rm");
			fs.mkdirSync(dirPath);
			await nodeFs.rmdirAsync(dirPath);
			expect(fs.existsSync(dirPath)).toBe(false);
		});

		it("should remove directory recursively async", async () => {
			const dirPath = path.join(testDir, "async-nonempty");
			fs.mkdirSync(dirPath);
			fs.writeFileSync(path.join(dirPath, "file.txt"), "content");
			fs.mkdirSync(path.join(dirPath, "subdir"));

			await nodeFs.rmdirAsync(dirPath, { recursive: true });
			expect(fs.existsSync(dirPath)).toBe(false);
		});
	});

	describe("stat / statAsync", () => {
		it("should return stats for a file", () => {
			const filePath = path.join(testDir, "stat.txt");
			fs.writeFileSync(filePath, "content");
			const stats = nodeFs.stat(filePath);

			expect(stats.isFile()).toBe(true);
			expect(stats.isDirectory()).toBe(false);
			expect(stats.size).toBe(7); // "content" is 7 bytes
			expect(stats.mtime).toBeInstanceOf(Date);
		});

		it("should return stats for a directory", () => {
			const dirPath = path.join(testDir, "statdir");
			fs.mkdirSync(dirPath);
			const stats = nodeFs.stat(dirPath);

			expect(stats.isFile()).toBe(false);
			expect(stats.isDirectory()).toBe(true);
			expect(stats.mtime).toBeInstanceOf(Date);
		});

		it("should work async", async () => {
			const filePath = path.join(testDir, "async-stat.txt");
			fs.writeFileSync(filePath, "async");
			const stats = await nodeFs.statAsync(filePath);
			expect(stats.isFile()).toBe(true);
		});

		it("should return directory stats async", async () => {
			const dirPath = path.join(testDir, "async-statdir");
			fs.mkdirSync(dirPath);
			const stats = await nodeFs.statAsync(dirPath);
			expect(stats.isDirectory()).toBe(true);
			expect(stats.isFile()).toBe(false);
		});
	});

	describe("path traversal protection", () => {
		it("should prevent path traversal with ..", () => {
			expect(() => nodeFs.readFile("../../../etc/passwd")).toThrow("Path traversal detected");
		});

		it("should prevent path traversal with absolute paths outside base", () => {
			expect(() => nodeFs.readFile("/etc/passwd")).toThrow("Path traversal detected");
		});

		it("should allow files within base directory", () => {
			const filePath = path.join(testDir, "safe.txt");
			fs.writeFileSync(filePath, "safe content");
			expect(nodeFs.readFile(filePath)).toBe("safe content");
		});

		it("should prevent traversal in writeFile", () => {
			expect(() => nodeFs.writeFile("../../../tmp/malicious.txt", "bad")).toThrow(
				"Path traversal detected",
			);
		});

		it("should prevent traversal in mkdir", () => {
			expect(() => nodeFs.mkdir("../../../tmp/baddir")).toThrow("Path traversal detected");
		});

		it("should prevent traversal in exists", () => {
			expect(() => nodeFs.exists("../../../etc")).toThrow("Path traversal detected");
		});

		it("should prevent traversal in readDir", () => {
			expect(() => nodeFs.readDir("../../../etc")).toThrow("Path traversal detected");
		});

		it("should prevent traversal in unlink", () => {
			expect(() => nodeFs.unlink("../../../tmp/file.txt")).toThrow("Path traversal detected");
		});

		it("should prevent traversal in rmdir", () => {
			expect(() => nodeFs.rmdir("../../../tmp/dir")).toThrow("Path traversal detected");
		});

		it("should prevent traversal in stat", () => {
			expect(() => nodeFs.stat("../../../etc/passwd")).toThrow("Path traversal detected");
		});

		it("should allow access to base directory itself", () => {
			const stats = nodeFs.stat(testDir);
			expect(stats.isDirectory()).toBe(true);
		});
	});
});

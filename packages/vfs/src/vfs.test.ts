import { describe, expect, it } from "bun:test";
import { VirtualFileSystem } from "./vfs";

describe("VirtualFileSystem", () => {
	it("should initialize with an empty root", () => {
		const vfs = new VirtualFileSystem();
		expect(vfs.root).toEqual({
			type: "directory",
			name: "",
			children: {},
		});
		expect(vfs.cwd).toBe("/");
	});

	it("should create and read a file", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/test.txt", "Hello World");
		expect(vfs.exists("/test.txt")).toBe(true);
		expect(vfs.readFile("/test.txt")).toBe("Hello World");
	});

	it("should create directories recursively on writeFile", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/a/b/test.txt", "Nested");
		expect(vfs.exists("/a")).toBe(true);
		expect(vfs.exists("/a/b")).toBe(true);
		expect(vfs.exists("/a/b/test.txt")).toBe(true);
		expect(vfs.readFile("/a/b/test.txt")).toBe("Nested");
	});

	it("should mkdir explicitly", () => {
		const vfs = new VirtualFileSystem();
		vfs.mkdir("/folder");
		expect(vfs.exists("/folder")).toBe(true);

		vfs.mkdir("/folder/sub");
		expect(vfs.exists("/folder/sub")).toBe(true);
		expect(vfs.readDir("/folder")).toEqual(["sub"]);
	});

	it("should list directory contents", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/a.txt", "A");
		vfs.writeFile("/b.txt", "B");
		vfs.mkdir("/c");

		const files = vfs.readDir("/");
		expect(files.sort()).toEqual(["a.txt", "b.txt", "c"]);
	});

	it("should throw on missing file read", () => {
		const vfs = new VirtualFileSystem();
		expect(() => vfs.readFile("/missing.txt")).toThrow("File not found");
	});

	it("should throw on reading file as dir", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/file", "content");
		expect(() => vfs.readDir("/file")).toThrow("Directory not found");
	});

	it("should snapshot and load", async () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/data.json", "{}");

		const snapshot = await vfs.createSnapshot();
		expect(Buffer.isBuffer(snapshot)).toBe(true);

		const vfs2 = new VirtualFileSystem();
		await vfs2.loadSnapshot(snapshot);
		expect(vfs2.readFile("/data.json")).toBe("{}");
	});
});

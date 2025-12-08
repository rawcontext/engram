import { describe, expect, it } from "bun:test";
import { PatchManager } from "./patch";
import { VirtualFileSystem } from "./vfs";

describe("PatchManager", () => {
	it("should apply search and replace", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/code.ts", "const x = 1;");
		const pm = new PatchManager(vfs);

		pm.applySearchReplace("/code.ts", "const x = 1;", "const x = 2;");
		expect(vfs.readFile("/code.ts")).toBe("const x = 2;");
	});

	it("should throw if search block not found", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/code.ts", "const x = 1;");
		const pm = new PatchManager(vfs);

		expect(() => pm.applySearchReplace("/code.ts", "const y = 1;", "const y = 2;")).toThrow(
			"Search block not found",
		);
	});

	it("should apply unified diff", () => {
		const vfs = new VirtualFileSystem();
		vfs.writeFile("/file.txt", "line1\nline2\nline3");
		const pm = new PatchManager(vfs);

		// Simple patch to change line2 to modified
		const patch = `--- file.txt
+++ file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3`;

		pm.applyUnifiedDiff("/file.txt", patch);
		expect(vfs.readFile("/file.txt")).toBe("line1\nmodified\nline3");
	});

	it("should apply unified diff to create new file", () => {
		const vfs = new VirtualFileSystem();
		const pm = new PatchManager(vfs);

		const patch = `--- /dev/null
+++ new.txt
@@ -0,0 +1,1 @@
+content`;

		// The diff library might behave differently with creation patches dependent on headers.
		// Let's test if applyPatch handles empty original string correctly.
		pm.applyUnifiedDiff("/new.txt", patch);
		expect(vfs.readFile("/new.txt").trim()).toBe("content");
	});
});

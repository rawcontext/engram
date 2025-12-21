import { applyPatch } from "diff";
import type { VirtualFileSystem } from "./vfs";

export class PatchManager {
	private operationLocks = new Map<string, Promise<void>>();

	constructor(private vfs: VirtualFileSystem) {}

	public applyUnifiedDiff(filePath: string, diffContent: string) {
		// 1. Read original content
		let originalContent = "";
		try {
			originalContent = this.vfs.readFile(filePath);
		} catch (e) {
			// File not existing is expected for creation patches
			// Check if this is a "file not found" error vs an unexpected error
			const isNotFoundError =
				e instanceof Error &&
				(e.message.includes("not found") ||
					e.message.includes("ENOENT") ||
					e.message.includes("does not exist"));
			if (!isNotFoundError) {
				// Rethrow unexpected errors (permissions, corruption, etc.)
				throw e;
			}
			// File doesn't exist - this is a creation patch, continue with empty content
		}

		// 2. Validate hunk headers to catch off-by-one errors
		// Hunk format: @@ -start,count +start,count @@
		// Line numbers are 1-based, not 0-based
		const hunkRegex = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/g;
		const originalLines = originalContent.split("\n");
		const originalLineCount = originalLines.length;

		const matches = Array.from(diffContent.matchAll(hunkRegex));
		for (const match of matches) {
			const oldStart = Number.parseInt(match[1], 10);
			const oldCount = match[2] ? Number.parseInt(match[2], 10) : 1;

			// Validate old line range (1-based indexing)
			// Empty files have special case: @@ -0,0 +1,N @@
			if (oldStart > 0 && oldStart + oldCount - 1 > originalLineCount) {
				throw new Error(
					`Invalid hunk: line range ${oldStart}-${oldStart + oldCount - 1} exceeds file length ${originalLineCount}`,
				);
			}
		}

		// 3. Apply patch (the diff library's applyPatch already uses strict matching)
		const result = applyPatch(originalContent, diffContent);

		if (result === false) {
			throw new Error(`Failed to apply patch to ${filePath}: patch does not match file content`);
		}

		// 4. Write back
		this.vfs.writeFile(filePath, result);
	}

	// Search/Replace Block Logic (Simpler)
	public async applySearchReplace(
		filePath: string,
		search: string,
		replace: string,
	): Promise<void> {
		// Ensure operations on the same file are serialized to prevent race conditions
		const existingLock = this.operationLocks.get(filePath);
		const operation = (async () => {
			if (existingLock) {
				await existingLock;
			}

			const content = this.vfs.readFile(filePath);
			if (!content.includes(search)) {
				throw new Error(`Search block not found in ${filePath}`);
			}
			const newContent = content.replace(search, replace);
			this.vfs.writeFile(filePath, newContent);
		})();

		this.operationLocks.set(filePath, operation);
		try {
			await operation;
		} finally {
			// Clean up the lock if this was the last operation
			if (this.operationLocks.get(filePath) === operation) {
				this.operationLocks.delete(filePath);
			}
		}
	}
}

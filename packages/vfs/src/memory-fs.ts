import type { FileStat, IFileSystem } from "./interfaces";

interface FileEntry {
	type: "file";
	content: string | Buffer;
	mtime: Date;
}

interface DirectoryEntry {
	type: "directory";
	mtime: Date;
}

type Entry = FileEntry | DirectoryEntry;

/**
 * In-memory file system implementation for testing.
 * Provides a complete IFileSystem implementation without touching the real filesystem.
 */
export class InMemoryFileSystem implements IFileSystem {
	private entries = new Map<string, Entry>();

	constructor() {
		// Initialize root directory
		this.entries.set("/", { type: "directory", mtime: new Date() });
	}

	private normalizePath(path: string): string {
		// Normalize path separators and remove trailing slashes (except root)
		let normalized = path.replace(/\\/g, "/").replace(/\/+/g, "/");
		if (normalized !== "/" && normalized.endsWith("/")) {
			normalized = normalized.slice(0, -1);
		}
		// Ensure path starts with /
		if (!normalized.startsWith("/")) {
			normalized = `/${normalized}`;
		}
		return normalized;
	}

	private getParentPath(path: string): string {
		const normalized = this.normalizePath(path);
		const lastSlash = normalized.lastIndexOf("/");
		if (lastSlash === 0) return "/";
		return normalized.slice(0, lastSlash);
	}

	exists(path: string): boolean {
		return this.entries.has(this.normalizePath(path));
	}

	async existsAsync(path: string): Promise<boolean> {
		return this.exists(path);
	}

	mkdir(path: string, options?: { recursive?: boolean }): void {
		const normalized = this.normalizePath(path);

		if (this.entries.has(normalized)) {
			const entry = this.entries.get(normalized);
			if (entry?.type === "file") {
				throw new Error(`EEXIST: file already exists, mkdir '${path}'`);
			}
			// Directory already exists, that's fine
			return;
		}

		if (options?.recursive) {
			const parts = normalized.split("/").filter(Boolean);
			let current = "";
			for (const part of parts) {
				current = `${current}/${part}`;
				if (!this.entries.has(current)) {
					this.entries.set(current, { type: "directory", mtime: new Date() });
				} else {
					const entry = this.entries.get(current);
					if (entry?.type === "file") {
						throw new Error(`ENOTDIR: not a directory '${current}'`);
					}
				}
			}
		} else {
			const parent = this.getParentPath(normalized);
			if (!this.entries.has(parent)) {
				throw new Error(`ENOENT: no such file or directory '${parent}'`);
			}
			const parentEntry = this.entries.get(parent);
			if (parentEntry?.type !== "directory") {
				throw new Error(`ENOTDIR: not a directory '${parent}'`);
			}
			this.entries.set(normalized, { type: "directory", mtime: new Date() });
		}
	}

	async mkdirAsync(path: string, options?: { recursive?: boolean }): Promise<void> {
		this.mkdir(path, options);
	}

	readDir(path: string): string[] {
		const normalized = this.normalizePath(path);
		const entry = this.entries.get(normalized);

		if (!entry) {
			throw new Error(`ENOENT: no such file or directory '${path}'`);
		}
		if (entry.type !== "directory") {
			throw new Error(`ENOTDIR: not a directory '${path}'`);
		}

		const prefix = normalized === "/" ? "/" : `${normalized}/`;
		const results: string[] = [];

		for (const entryPath of this.entries.keys()) {
			if (entryPath === normalized) continue;
			if (!entryPath.startsWith(prefix)) continue;

			const remaining = entryPath.slice(prefix.length);
			// Only include direct children (no nested paths)
			if (!remaining.includes("/")) {
				results.push(remaining);
			}
		}

		return results.toSorted();
	}

	async readDirAsync(path: string): Promise<string[]> {
		return this.readDir(path);
	}

	rmdir(path: string, options?: { recursive?: boolean }): void {
		const normalized = this.normalizePath(path);
		const entry = this.entries.get(normalized);

		if (!entry) {
			throw new Error(`ENOENT: no such file or directory '${path}'`);
		}
		if (entry.type !== "directory") {
			throw new Error(`ENOTDIR: not a directory '${path}'`);
		}

		if (options?.recursive) {
			// Delete all entries under this path
			const prefix = normalized === "/" ? "/" : `${normalized}/`;
			const toDelete: string[] = [];

			for (const entryPath of this.entries.keys()) {
				if (entryPath === normalized || entryPath.startsWith(prefix)) {
					toDelete.push(entryPath);
				}
			}

			for (const p of toDelete) {
				this.entries.delete(p);
			}
		} else {
			// Check if directory is empty
			const children = this.readDir(path);
			if (children.length > 0) {
				throw new Error(`ENOTEMPTY: directory not empty '${path}'`);
			}
			this.entries.delete(normalized);
		}
	}

	async rmdirAsync(path: string, options?: { recursive?: boolean }): Promise<void> {
		this.rmdir(path, options);
	}

	writeFile(path: string, content: string | Buffer): void {
		const normalized = this.normalizePath(path);
		const parent = this.getParentPath(normalized);

		// Check parent exists
		if (!this.entries.has(parent)) {
			throw new Error(`ENOENT: no such file or directory '${parent}'`);
		}
		const parentEntry = this.entries.get(parent);
		if (parentEntry?.type !== "directory") {
			throw new Error(`ENOTDIR: not a directory '${parent}'`);
		}

		this.entries.set(normalized, {
			type: "file",
			content,
			mtime: new Date(),
		});
	}

	async writeFileAsync(path: string, content: string | Buffer): Promise<void> {
		this.writeFile(path, content);
	}

	readFile(path: string): string {
		const normalized = this.normalizePath(path);
		const entry = this.entries.get(normalized);

		if (!entry) {
			throw new Error(`ENOENT: no such file or directory '${path}'`);
		}
		if (entry.type !== "file") {
			throw new Error(`EISDIR: illegal operation on a directory '${path}'`);
		}

		return typeof entry.content === "string" ? entry.content : entry.content.toString("utf-8");
	}

	async readFileAsync(path: string): Promise<string> {
		return this.readFile(path);
	}

	unlink(path: string): void {
		const normalized = this.normalizePath(path);
		const entry = this.entries.get(normalized);

		if (!entry) {
			throw new Error(`ENOENT: no such file or directory '${path}'`);
		}
		if (entry.type !== "file") {
			throw new Error(`EISDIR: illegal operation on a directory '${path}'`);
		}

		this.entries.delete(normalized);
	}

	async unlinkAsync(path: string): Promise<void> {
		this.unlink(path);
	}

	stat(path: string): FileStat {
		const normalized = this.normalizePath(path);
		const entry = this.entries.get(normalized);

		if (!entry) {
			throw new Error(`ENOENT: no such file or directory '${path}'`);
		}

		if (entry.type === "file") {
			const size =
				typeof entry.content === "string" ? Buffer.byteLength(entry.content) : entry.content.length;
			return {
				isFile: () => true,
				isDirectory: () => false,
				size,
				mtime: entry.mtime,
			};
		}

		return {
			isFile: () => false,
			isDirectory: () => true,
			size: 0,
			mtime: entry.mtime,
		};
	}

	async statAsync(path: string): Promise<FileStat> {
		return this.stat(path);
	}

	// ========== Test Helper Methods ==========

	/**
	 * Clear all files and directories, resetting to initial state.
	 */
	clear(): void {
		this.entries.clear();
		this.entries.set("/", { type: "directory", mtime: new Date() });
	}

	/**
	 * Get the total number of files in the filesystem.
	 */
	getFileCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.type === "file") count++;
		}
		return count;
	}

	/**
	 * Get the total number of directories in the filesystem (including root).
	 */
	getDirectoryCount(): number {
		let count = 0;
		for (const entry of this.entries.values()) {
			if (entry.type === "directory") count++;
		}
		return count;
	}

	/**
	 * Get all file paths in the filesystem.
	 */
	getAllFilePaths(): string[] {
		const paths: string[] = [];
		for (const [path, entry] of this.entries) {
			if (entry.type === "file") {
				paths.push(path);
			}
		}
		return paths.toSorted();
	}
}

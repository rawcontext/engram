import * as path from "node:path";
import { promisify } from "node:util";
import * as zlib from "node:zlib";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface FileNode {
	type: "file";
	name: string;
	content: string;
	lastModified: number;
}

export interface DirectoryNode {
	type: "directory";
	name: string;
	children: Record<string, FileNode | DirectoryNode>;
}

/**
 * Virtual in-memory file system for agent sessions and time-travel.
 * Does not implement IFileSystem interface - designed specifically for
 * in-memory state management and snapshot creation.
 *
 * Use cases:
 * - Agent session VFS state (ExecutionService)
 * - Time-travel and state reconstruction
 * - Snapshot creation for bitemporal storage
 *
 * Compare to:
 * - NodeFileSystem: Real filesystem I/O implementing IFileSystem
 * - InMemoryFileSystem: Test implementation of IFileSystem interface
 */
export class VirtualFileSystem {
	public root: DirectoryNode;
	public cwd: string;

	constructor(root?: DirectoryNode) {
		this.root = root || { type: "directory", name: "", children: {} };
		this.cwd = "/";
	}

	/**
	 * Sanitizes and normalizes a path to prevent path traversal attacks.
	 * Ensures the resolved path stays within the virtual filesystem root.
	 */
	private sanitizePath(inputPath: string): string {
		// Normalize the path to resolve ../ and ./ segments
		const normalized = path.posix.normalize(inputPath);

		// Ensure the path is absolute or make it relative to root
		const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;

		// Check for path traversal attempts
		if (absolutePath.includes("..")) {
			throw new Error(`Path traversal not allowed: ${inputPath}`);
		}

		// Ensure the path starts with / (stays within root)
		if (!absolutePath.startsWith("/")) {
			throw new Error(`Invalid path, must be within root: ${inputPath}`);
		}

		return absolutePath;
	}

	// Basic CRUD (Simplified)
	public exists(inputPath: string): boolean {
		const sanitized = this.sanitizePath(inputPath);
		return !!this.resolve(sanitized);
	}

	public mkdir(inputPath: string): void {
		const sanitized = this.sanitizePath(inputPath);
		const parts = this.splitPath(sanitized);
		let current = this.root;

		for (const part of parts) {
			if (!current.children[part]) {
				current.children[part] = { type: "directory", name: part, children: {} };
			}
			const next = current.children[part];
			if (next.type !== "directory") {
				throw new Error(`Not a directory: ${part}`);
			}
			current = next;
		}
	}

	public writeFile(inputPath: string, content: string): void {
		const sanitized = this.sanitizePath(inputPath);
		const parts = this.splitPath(sanitized);
		const fileName = parts.pop() || "";
		if (!fileName) throw new Error("Invalid path");

		if (parts.length > 0) {
			this.mkdir(this.joinPath(parts));
		}

		const parentPath = parts.length > 0 ? this.joinPath(parts) : "/";
		const parent = this.resolve(parentPath);
		if (!parent || parent.type !== "directory") {
			throw new Error(`Not a directory: ${parentPath}`);
		}

		parent.children[fileName] = {
			type: "file",
			name: fileName,
			content,
			lastModified: Date.now(),
		};
	}

	public readFile(inputPath: string): string {
		const sanitized = this.sanitizePath(inputPath);
		const node = this.resolve(sanitized);
		if (!node || node.type !== "file") throw new Error(`File not found: ${inputPath}`);
		return node.content;
	}

	public readDir(inputPath: string): string[] {
		const sanitized = this.sanitizePath(inputPath);
		const node = this.resolve(sanitized);
		if (!node || node.type !== "directory") throw new Error(`Directory not found: ${inputPath}`);
		return Object.keys(node.children);
	}

	private resolve(path: string): FileNode | DirectoryNode | null {
		const parts = this.splitPath(path);
		let current: FileNode | DirectoryNode = this.root;
		for (const part of parts) {
			if (current.type !== "directory") return null;
			if (!current.children[part]) return null;
			current = current.children[part];
		}
		return current;
	}

	private splitPath(path: string): string[] {
		return path.split("/").filter(Boolean);
	}

	private joinPath(parts: string[]): string {
		return `/${parts.join("/")}`;
	}

	// Snapshot Logic
	public async createSnapshot(): Promise<Buffer> {
		const state = JSON.stringify(this.root);
		return gzip(state);
	}

	public async loadSnapshot(snapshot: Buffer): Promise<void> {
		const state = await gunzip(snapshot);
		this.root = JSON.parse(state.toString());
	}
}

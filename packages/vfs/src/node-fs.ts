import * as fs from "node:fs";
import * as path from "node:path";
import type { FileStat, IFileSystem } from "./interfaces";

/**
 * Path traversal error thrown when a path escapes the base directory.
 */
export class PathTraversalError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PathTraversalError";
	}
}

/**
 * Node.js file system implementation of IFileSystem.
 * Wraps the native fs module for production use with real filesystem operations.
 *
 * Use cases:
 * - Production environments requiring actual file I/O
 * - Integration with external tools that expect real files
 * - Scenarios where persistent storage beyond process lifetime is needed
 *
 * Compare to:
 * - VirtualFileSystem: In-memory only, used for agent sessions and time-travel
 * - InMemoryFileSystem: Test implementation of IFileSystem interface
 *
 * Security: All paths are validated against the base directory to prevent
 * path traversal attacks (e.g., ../../etc/passwd).
 */
export class NodeFileSystem implements IFileSystem {
	private readonly baseDir: string;

	/**
	 * Create a new NodeFileSystem instance.
	 * @param baseDir - Base directory for all operations. Paths are restricted to this directory.
	 *                  Defaults to current working directory.
	 */
	constructor(baseDir: string = process.cwd()) {
		this.baseDir = path.resolve(baseDir);
	}

	/**
	 * Validate that a path is contained within the base directory.
	 * Prevents path traversal attacks.
	 *
	 * @param filePath - The path to validate
	 * @returns The resolved, safe path
	 * @throws PathTraversalError if the path escapes the base directory
	 */
	private validatePath(filePath: string): string {
		// Resolve the path relative to base directory
		const resolved = path.resolve(this.baseDir, filePath);
		const resolvedBase = this.baseDir + path.sep;

		// Check if resolved path is within base directory
		if (!resolved.startsWith(resolvedBase) && resolved !== this.baseDir) {
			throw new PathTraversalError(
				`Path traversal detected: "${filePath}" resolves outside base directory`,
			);
		}

		return resolved;
	}

	exists(filePath: string): boolean {
		const safePath = this.validatePath(filePath);
		return fs.existsSync(safePath);
	}

	async existsAsync(filePath: string): Promise<boolean> {
		const safePath = this.validatePath(filePath);
		try {
			await fs.promises.access(safePath);
			return true;
		} catch {
			return false;
		}
	}

	mkdir(dirPath: string, options?: { recursive?: boolean }): void {
		const safePath = this.validatePath(dirPath);
		fs.mkdirSync(safePath, options);
	}

	async mkdirAsync(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
		const safePath = this.validatePath(dirPath);
		await fs.promises.mkdir(safePath, options);
	}

	readDir(dirPath: string): string[] {
		const safePath = this.validatePath(dirPath);
		return fs.readdirSync(safePath);
	}

	async readDirAsync(dirPath: string): Promise<string[]> {
		const safePath = this.validatePath(dirPath);
		return fs.promises.readdir(safePath);
	}

	rmdir(dirPath: string, options?: { recursive?: boolean }): void {
		const safePath = this.validatePath(dirPath);
		if (options?.recursive) {
			fs.rmSync(safePath, { recursive: true, force: true });
		} else {
			fs.rmdirSync(safePath);
		}
	}

	async rmdirAsync(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
		const safePath = this.validatePath(dirPath);
		if (options?.recursive) {
			await fs.promises.rm(safePath, { recursive: true, force: true });
		} else {
			await fs.promises.rmdir(safePath);
		}
	}

	writeFile(filePath: string, content: string | Buffer): void {
		const safePath = this.validatePath(filePath);
		fs.writeFileSync(safePath, content);
	}

	async writeFileAsync(filePath: string, content: string | Buffer): Promise<void> {
		const safePath = this.validatePath(filePath);
		await fs.promises.writeFile(safePath, content);
	}

	readFile(filePath: string): string {
		const safePath = this.validatePath(filePath);
		return fs.readFileSync(safePath, "utf-8");
	}

	async readFileAsync(filePath: string): Promise<string> {
		const safePath = this.validatePath(filePath);
		return fs.promises.readFile(safePath, "utf-8");
	}

	unlink(filePath: string): void {
		const safePath = this.validatePath(filePath);
		fs.unlinkSync(safePath);
	}

	async unlinkAsync(filePath: string): Promise<void> {
		const safePath = this.validatePath(filePath);
		await fs.promises.unlink(safePath);
	}

	stat(filePath: string): FileStat {
		const safePath = this.validatePath(filePath);
		const stats = fs.statSync(safePath);
		return {
			isFile: () => stats.isFile(),
			isDirectory: () => stats.isDirectory(),
			size: stats.size,
			mtime: stats.mtime,
		};
	}

	async statAsync(filePath: string): Promise<FileStat> {
		const safePath = this.validatePath(filePath);
		const stats = await fs.promises.stat(safePath);
		return {
			isFile: () => stats.isFile(),
			isDirectory: () => stats.isDirectory(),
			size: stats.size,
			mtime: stats.mtime,
		};
	}
}

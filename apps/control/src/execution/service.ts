import type { Logger } from "@engram/logger";
import { createNodeLogger } from "@engram/logger";
import { createFalkorClient, type GraphClient } from "@engram/storage";
import { Rehydrator, TimeTravelService } from "@engram/temporal";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";

/**
 * Dependencies for ExecutionService construction.
 * Supports dependency injection for testability.
 */
export interface ExecutionServiceDeps {
	/** Virtual file system. Defaults to new VirtualFileSystem. */
	vfs?: VirtualFileSystem;
	/** Patch manager for applying diffs. Defaults to new PatchManager(vfs). */
	patchManager?: PatchManager;
	/** Graph client for session persistence. Defaults to FalkorClient. */
	graphClient?: GraphClient;
	/** Rehydrator for session state reconstruction. */
	rehydrator?: Rehydrator;
	/** Time travel service. */
	timeTravelService?: TimeTravelService;
	/** Logger instance. */
	logger?: Logger;
}

/**
 * Result type for execution operations.
 */
export interface ExecutionResult {
	success: boolean;
	data?: string;
	error?: string;
}

/**
 * ExecutionService provides VFS operations and time-travel capabilities.
 * This is a direct replacement for the MCP-based execution service,
 * integrated directly into the Control service.
 */
export class ExecutionService {
	readonly vfs: VirtualFileSystem;
	readonly patchManager: PatchManager;
	readonly graphClient: GraphClient;
	readonly rehydrator: Rehydrator;
	readonly timeTravelService: TimeTravelService;
	readonly logger: Logger;

	constructor(deps?: ExecutionServiceDeps) {
		this.logger =
			deps?.logger ??
			createNodeLogger({
				service: "control-service",
				base: { component: "execution" },
				pretty: false,
			});

		this.vfs = deps?.vfs ?? new VirtualFileSystem();
		this.patchManager = deps?.patchManager ?? new PatchManager(this.vfs);
		this.graphClient = deps?.graphClient ?? createFalkorClient();
		this.rehydrator = deps?.rehydrator ?? new Rehydrator({ graphClient: this.graphClient });
		this.timeTravelService = deps?.timeTravelService ?? new TimeTravelService(this.rehydrator);
	}

	/**
	 * Read a file from the virtual file system.
	 */
	async readFile(path: string): Promise<ExecutionResult> {
		try {
			const content = this.vfs.readFile(path);
			return { success: true, data: content };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			this.logger.error({ path, error: message }, "Failed to read file");
			return { success: false, error: message };
		}
	}

	/**
	 * Apply a unified diff or search/replace block to a file.
	 */
	async applyPatch(path: string, diff: string): Promise<ExecutionResult> {
		try {
			this.patchManager.applyUnifiedDiff(path, diff);
			return { success: true, data: `Successfully patched ${path}` };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			this.logger.error({ path, error: message }, "Failed to apply patch");
			return { success: false, error: message };
		}
	}

	/**
	 * List files at a specific point in time.
	 */
	async listFilesAtTime(
		sessionId: string,
		timestamp: number,
		path = "/",
	): Promise<ExecutionResult> {
		try {
			await this.graphClient.connect();
			const files = await this.timeTravelService.listFiles(sessionId, timestamp, path);
			return { success: true, data: JSON.stringify(files) };
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			this.logger.error(
				{ sessionId, timestamp, path, error: message },
				"Failed to list files at time",
			);
			return { success: false, error: message };
		} finally {
			await this.graphClient.disconnect();
		}
	}

	/**
	 * Get the filesystem state at a specific point in time.
	 */
	async getFilesystemState(sessionId: string, timestamp: number): Promise<VirtualFileSystem> {
		return this.timeTravelService.getFilesystemState(sessionId, timestamp);
	}

	/**
	 * Get a zipped snapshot of the filesystem at a specific point in time.
	 */
	async getZippedState(sessionId: string, timestamp: number): Promise<Buffer> {
		return this.timeTravelService.getZippedState(sessionId, timestamp);
	}

	/**
	 * Write a file to the VFS.
	 */
	writeFile(path: string, content: string): void {
		this.vfs.writeFile(path, content);
	}

	/**
	 * Check if a file exists in the VFS.
	 */
	exists(path: string): boolean {
		return this.vfs.exists(path);
	}

	/**
	 * Create a directory in the VFS.
	 */
	mkdir(path: string): void {
		this.vfs.mkdir(path);
	}

	/**
	 * List directory contents.
	 */
	readDir(path: string): string[] {
		return this.vfs.readDir(path);
	}
}

/**
 * Factory function for creating ExecutionService with defaults.
 * Exported for backward compatibility and testing.
 */
export function createExecutionService(deps?: ExecutionServiceDeps): ExecutionService {
	return new ExecutionService(deps);
}

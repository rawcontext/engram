import type { Logger } from "@engram/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RootsListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

export interface Root {
	uri: string;
	name?: string;
	path: string; // Extracted file path without file:// prefix
}

/**
 * Wrapper for MCP roots capability.
 * Roots define workspace boundaries for project-scoped memory access.
 */
export class RootsService {
	private server: McpServer;
	private logger: Logger;
	private _enabled = false;
	private _roots: Root[] = [];
	private _onRootsChanged?: (roots: Root[]) => void;

	constructor(server: McpServer, logger: Logger) {
		this.server = server;
		this.logger = logger;
	}

	/**
	 * Enable roots after capability negotiation confirms client support
	 */
	enable(): void {
		this._enabled = true;
		this.logger.info("Roots capability enabled");

		// Set up notification handler for roots changes
		this.server.server.setNotificationHandler(RootsListChangedNotificationSchema, async () => {
			this.logger.debug("Received roots list changed notification");
			await this.refreshRoots();
		});
	}

	/**
	 * Check if roots capability is available
	 */
	get enabled(): boolean {
		return this._enabled;
	}

	/**
	 * Get current roots
	 */
	get roots(): Root[] {
		return this._roots;
	}

	/**
	 * Get project names from roots
	 */
	get projectNames(): string[] {
		return this._roots
			.map((r) => r.name ?? r.path.split("/").filter(Boolean).pop())
			.filter((name): name is string => Boolean(name));
	}

	/**
	 * Get primary project (first root)
	 */
	get primaryProject(): string | undefined {
		if (this._roots.length === 0) {
			return undefined;
		}
		const first = this._roots[0];
		return first.name ?? first.path.split("/").filter(Boolean).pop();
	}

	/**
	 * Get primary working directory
	 */
	get primaryWorkingDir(): string | undefined {
		return this._roots[0]?.path;
	}

	/**
	 * Set callback for roots changes
	 */
	onRootsChanged(callback: (roots: Root[]) => void): void {
		this._onRootsChanged = callback;
	}

	/**
	 * Refresh roots from client
	 */
	async refreshRoots(): Promise<Root[]> {
		if (!this._enabled) {
			this.logger.debug("Roots not available, returning empty");
			return [];
		}

		try {
			const response = await this.server.server.listRoots();

			this._roots = response.roots.map((root) => ({
				uri: root.uri,
				name: root.name,
				path: root.uri.replace(/^file:\/\//, ""),
			}));

			this.logger.debug({ roots: this._roots }, "Refreshed roots");

			// Notify callback
			if (this._onRootsChanged) {
				this._onRootsChanged(this._roots);
			}

			return this._roots;
		} catch (error) {
			this.logger.warn({ error }, "Failed to refresh roots");
			return this._roots;
		}
	}

	/**
	 * Check if a path is within any root
	 */
	isWithinRoots(path: string): boolean {
		if (this._roots.length === 0) {
			// No roots defined, allow all
			return true;
		}

		return this._roots.some((root) => path.startsWith(root.path));
	}

	/**
	 * Get the root that contains a path
	 */
	findRootForPath(path: string): Root | undefined {
		return this._roots.find((root) => path.startsWith(root.path));
	}

	/**
	 * Get project name for a path
	 */
	getProjectForPath(path: string): string | undefined {
		const root = this.findRootForPath(path);
		if (!root) {
			return undefined;
		}
		return root.name ?? root.path.split("/").filter(Boolean).pop();
	}

	/**
	 * Filter paths to only those within roots
	 */
	filterPathsToRoots(paths: string[]): string[] {
		if (this._roots.length === 0) {
			return paths;
		}
		return paths.filter((p) => this.isWithinRoots(p));
	}

	/**
	 * Build project filter for queries based on roots
	 */
	buildProjectFilter(): string[] | undefined {
		if (this._roots.length === 0) {
			return undefined;
		}

		return this.projectNames;
	}
}

import { Rehydrator, TimeTravelService } from "@engram/execution-core";
import { createNodeLogger, type Logger } from "@engram/logger";
import { createFalkorClient, type GraphClient } from "@engram/storage";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Dependencies for Execution Service construction.
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
 * Factory function for creating Execution Service dependencies.
 * Returns an object with all initialized services for the execution app.
 *
 * @example
 * // Production usage (uses defaults)
 * const deps = createExecutionServiceDeps();
 *
 * @example
 * // Test usage (inject mocks)
 * const deps = createExecutionServiceDeps({
 *   graphClient: mockGraphClient,
 *   vfs: mockVfs,
 * });
 */
export function createExecutionServiceDeps(
	deps?: ExecutionServiceDeps,
): Required<ExecutionServiceDeps> {
	const logger =
		deps?.logger ??
		createNodeLogger({
			service: "execution-service",
			base: { component: "main" },
			pretty: false,
		});

	const vfs = deps?.vfs ?? new VirtualFileSystem();
	const patchManager = deps?.patchManager ?? new PatchManager(vfs);
	const graphClient = deps?.graphClient ?? createFalkorClient();
	const rehydrator = deps?.rehydrator ?? new Rehydrator({ graphClient });
	const timeTravelService = deps?.timeTravelService ?? new TimeTravelService(rehydrator);

	return {
		vfs,
		patchManager,
		graphClient,
		rehydrator,
		timeTravelService,
		logger,
	};
}

const logger = createNodeLogger({
	service: "execution-service",
	base: { component: "main" },
	pretty: false,
});

// Initialize Core Services
const vfs = new VirtualFileSystem();
const patchManager = new PatchManager(vfs);
const falkor = createFalkorClient();
const rehydrator = new Rehydrator(falkor);
const timeTravel = new TimeTravelService(rehydrator);

const server = new McpServer({
	name: "engram-execution",
	version: "1.0.0",
});

// Define input interfaces for type-safe tool handlers
interface ReadFileArgs {
	path: string;
}

interface ApplyPatchArgs {
	path: string;
	diff: string;
}

interface ListFilesAtTimeArgs {
	session_id: string;
	timestamp: number;
	path: string;
}

// Helper to create text result - exported for testing
export const textResult = (text: string, isError = false): CallToolResult => ({
	content: [{ type: "text", text }],
	...(isError && { isError }),
});

/**
 * Tool handler for reading files from the VFS.
 * Exported for direct testing of the handler logic.
 */
export async function handleReadFile(
	args: ReadFileArgs,
	vfsInstance: VirtualFileSystem = vfs,
): Promise<CallToolResult> {
	try {
		const content = vfsInstance.readFile(args.path);
		return textResult(content);
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return textResult(`Error: ${message}`, true);
	}
}

/**
 * Tool handler for applying patches to files in the VFS.
 * Exported for direct testing of the handler logic.
 */
export async function handleApplyPatch(
	args: ApplyPatchArgs,
	patchManagerInstance: PatchManager = patchManager,
): Promise<CallToolResult> {
	try {
		patchManagerInstance.applyUnifiedDiff(args.path, args.diff);
		return textResult(`Successfully patched ${args.path}`);
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return textResult(`Error: ${message}`, true);
	}
}

/**
 * Tool handler for listing files at a specific point in time.
 * Exported for direct testing of the handler logic.
 */
export async function handleListFilesAtTime(
	args: ListFilesAtTimeArgs,
	graphClient: GraphClient = falkor,
	timeTravelService: TimeTravelService = timeTravel,
): Promise<CallToolResult> {
	try {
		await graphClient.connect();
		const files = await timeTravelService.listFiles(args.session_id, args.timestamp, args.path);
		return textResult(JSON.stringify(files));
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return textResult(`Error: ${message}`, true);
	} finally {
		await graphClient.disconnect();
	}
}

// Note: MCP SDK v1.24+ has deep type instantiation issues (TS2589) with Zod schemas.
// Using @ts-expect-error to suppress these known SDK type inference issues while
// maintaining runtime type safety through Zod validation at the SDK boundary.

server.tool(
	"read_file",
	"Read a file from the Virtual File System",
	{ path: z.string() },
	// @ts-expect-error MCP SDK TS2589 - deep type instantiation with Zod schemas
	async (args: ReadFileArgs) => {
		return handleReadFile(args);
	},
);

server.tool(
	"apply_patch",
	"Apply a unified diff or search/replace block to the VFS",
	{ path: z.string(), diff: z.string() },
	async (args: ApplyPatchArgs) => {
		return handleApplyPatch(args);
	},
);

server.tool(
	"list_files_at_time",
	"List files in the VFS at a specific point in time",
	{
		session_id: z.string(),
		timestamp: z.number().describe("Epoch timestamp"),
		path: z.string().optional().default("/"),
	},
	// @ts-expect-error MCP SDK TS2589 - deep type instantiation with Zod schemas
	async (args: ListFilesAtTimeArgs) => {
		return handleListFilesAtTime(args);
	},
);

// Export for testing
export { server, vfs, patchManager, falkor, timeTravel, logger };

/**
 * Main entry point for the MCP server.
 * Exported for testing.
 */
export async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info("Engram Execution MCP Server running on stdio");

	// Graceful shutdown handler
	const shutdown = async (signal: string) => {
		logger.info({ signal }, "Shutting down gracefully...");
		try {
			await falkor.disconnect();
			logger.info("FalkorDB connection closed");
		} catch (e) {
			logger.error({ err: e }, "Error disconnecting FalkorDB");
		}
		process.exit(0);
	};

	process.once("SIGTERM", () => shutdown("SIGTERM"));
	process.once("SIGINT", () => shutdown("SIGINT"));
}

if (import.meta.main) {
	main().catch((err) => {
		logger.error({ err }, "Fatal error");
		process.exit(1);
	});
}

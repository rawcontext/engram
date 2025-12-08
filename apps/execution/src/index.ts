import { Rehydrator, TimeTravelService } from "@engram/execution-core";
import { createNodeLogger } from "@engram/logger";
import { createFalkorClient } from "@engram/storage";
import { PatchManager, VirtualFileSystem } from "@engram/vfs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

const _ReadFileSchema = {
	path: z.string(),
};

server.registerTool(
	"read_file",
	{
		description: "Read a file from the Virtual File System",
		inputSchema: {
			path: z.string(),
		} as any,
	},
	(async ({ path }: { path: string }) => {
		try {
			const content = vfs.readFile(path);
			return {
				content: [{ type: "text", text: content }],
			};
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	}) as any,
);

server.registerTool(
	"apply_patch",
	{
		description: "Apply a unified diff or search/replace block to the VFS",
		inputSchema: {
			path: z.string(),
			diff: z.string(),
		} as any,
	},
	(async ({ path, diff }: { path: string; diff: string }) => {
		try {
			patchManager.applyUnifiedDiff(path, diff);
			return {
				content: [{ type: "text", text: `Successfully patched ${path}` }],
			};
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	}) as any,
);

// New Tool: Time Travel
server.registerTool(
	"list_files_at_time",
	{
		description: "List files in the VFS at a specific point in time",
		inputSchema: {
			session_id: z.string(),
			timestamp: z.number().describe("Epoch timestamp"),
			path: z.string().optional().default("/"),
		} as any,
	},
	(async ({
		session_id,
		timestamp,
		path,
	}: {
		session_id: string;
		timestamp: number;
		path: string;
	}) => {
		try {
			await falkor.connect();
			const files = await timeTravel.listFiles(session_id, timestamp, path);
			return {
				content: [{ type: "text", text: JSON.stringify(files) }],
			};
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			return {
				content: [{ type: "text", text: `Error: ${message}` }],
				isError: true,
			};
		}
	}) as any,
);

// Export for testing
export { server, vfs, patchManager };

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	logger.info("Engram Execution MCP Server running on stdio");
}

if (import.meta.main) {
	main().catch((err) => {
		logger.error({ err }, "Fatal error");
		process.exit(1);
	});
}

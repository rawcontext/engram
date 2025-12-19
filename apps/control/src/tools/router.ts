import type { ExecutionResult, ExecutionService } from "../execution";
import type { MultiMcpAdapter } from "./mcp_client";

/**
 * Tool definition for the AI to understand available tools.
 */
export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema?: unknown;
}

/**
 * Result from a tool call.
 */
export interface ToolCallResult {
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
}

/**
 * The execution tools that are now handled directly (not via MCP).
 */
const EXECUTION_TOOLS: ToolDefinition[] = [
	{
		name: "read_file",
		description: "Read a file from the Virtual File System",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file" },
			},
			required: ["path"],
		},
	},
	{
		name: "apply_patch",
		description: "Apply a unified diff or search/replace block to the VFS",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the file" },
				diff: { type: "string", description: "Unified diff to apply" },
			},
			required: ["path", "diff"],
		},
	},
	{
		name: "list_files_at_time",
		description: "List files in the VFS at a specific point in time",
		inputSchema: {
			type: "object",
			properties: {
				session_id: { type: "string", description: "Session ID" },
				timestamp: { type: "number", description: "Epoch timestamp" },
				path: { type: "string", description: "Directory path" },
			},
			required: ["session_id", "timestamp"],
		},
	},
];

/**
 * ToolRouter combines ExecutionService (direct) with MCP adapters (external).
 * Routes execution tools to ExecutionService and all others to MCP.
 */
export class ToolRouter {
	private executionToolNames = new Set(EXECUTION_TOOLS.map((t) => t.name));

	constructor(
		private executionService: ExecutionService,
		private mcpAdapter: MultiMcpAdapter,
	) {}

	/**
	 * List all available tools (execution + MCP).
	 */
	async listTools(): Promise<ToolDefinition[]> {
		const tools: ToolDefinition[] = [...EXECUTION_TOOLS];

		try {
			const mcpTools = await this.mcpAdapter.listTools();
			for (const tool of mcpTools) {
				// Don't duplicate execution tools if MCP also provides them
				if (!this.executionToolNames.has(tool.name)) {
					tools.push({
						name: tool.name,
						description: tool.description || `Execute ${tool.name}`,
						inputSchema: tool.inputSchema,
					});
				}
			}
		} catch {
			// MCP adapter may not be connected, that's okay
		}

		return tools;
	}

	/**
	 * Call a tool by name, routing to the appropriate handler.
	 */
	async callTool(toolName: string, args: Record<string, unknown>): Promise<ToolCallResult> {
		// Route execution tools directly
		if (this.executionToolNames.has(toolName)) {
			return this.callExecutionTool(toolName, args);
		}

		// Route all other tools to MCP
		const result = await this.mcpAdapter.callTool(toolName, args);
		return result as ToolCallResult;
	}

	/**
	 * Handle execution tool calls directly.
	 */
	private async callExecutionTool(
		toolName: string,
		args: Record<string, unknown>,
	): Promise<ToolCallResult> {
		let result: ExecutionResult;

		switch (toolName) {
			case "read_file":
				result = await this.executionService.readFile(args.path as string);
				break;
			case "apply_patch":
				result = await this.executionService.applyPatch(args.path as string, args.diff as string);
				break;
			case "list_files_at_time":
				result = await this.executionService.listFilesAtTime(
					args.session_id as string,
					args.timestamp as number,
					(args.path as string) || "/",
				);
				break;
			default:
				return {
					content: [{ type: "text", text: `Unknown execution tool: ${toolName}` }],
					isError: true,
				};
		}

		if (result.success) {
			return {
				content: [{ type: "text", text: result.data || "" }],
			};
		}
		return {
			content: [{ type: "text", text: `Error: ${result.error}` }],
			isError: true,
		};
	}
}

/**
 * Factory function for creating ToolRouter.
 */
export function createToolRouter(
	executionService: ExecutionService,
	mcpAdapter: MultiMcpAdapter,
): ToolRouter {
	return new ToolRouter(executionService, mcpAdapter);
}

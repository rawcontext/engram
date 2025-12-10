import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class McpToolAdapter {
	public client: Client;

	constructor(
		private serverCommand: string,
		private serverArgs: string[] = [],
	) {
		this.client = new Client({ name: "control-client", version: "1.0.0" }, { capabilities: {} });
	}

	async connect() {
		const transport = new StdioClientTransport({
			command: this.serverCommand,
			args: this.serverArgs,
		});
		await this.client.connect(transport);
	}

	async listTools() {
		const result = await this.client.listTools();
		return result.tools;
	}

	async callTool(toolName: string, args: Record<string, unknown>) {
		return this.client.callTool({ name: toolName, arguments: args });
	}
}

export class MultiMcpAdapter {
	private adapters: McpToolAdapter[] = [];
	private toolMap = new Map<string, McpToolAdapter>();

	addAdapter(adapter: McpToolAdapter) {
		this.adapters.push(adapter);
	}

	async connectAll() {
		await Promise.all(this.adapters.map((a) => a.connect()));
		await this.refreshTools();
	}

	async refreshTools() {
		this.toolMap.clear();
		for (const adapter of this.adapters) {
			try {
				const tools = await adapter.listTools();
				for (const tool of tools) {
					this.toolMap.set(tool.name, adapter);
				}
			} catch (e) {
				console.error("Failed to list tools from adapter", e);
			}
		}
	}

	async callTool(toolName: string, args: Record<string, unknown>) {
		const adapter = this.toolMap.get(toolName);
		if (!adapter) {
			throw new Error(`Tool ${toolName} not found in any connected MCP server`);
		}
		return adapter.callTool(toolName, args);
	}

	async listTools() {
		const allTools = [];
		for (const adapter of this.adapters) {
			const tools = await adapter.listTools();
			allTools.push(...tools);
		}
		return allTools;
	}
}

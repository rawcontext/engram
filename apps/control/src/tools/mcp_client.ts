import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class McpToolAdapter {
	public client: Client;
	private isConnected = false;

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
		this.isConnected = true;
	}

	async disconnect() {
		if (this.isConnected) {
			try {
				await this.client.close();
			} catch {
				// Ignore close errors
			}
			this.isConnected = false;
		}
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

	/**
	 * Disconnect all MCP client connections.
	 * Call this on shutdown to prevent resource leaks.
	 */
	async disconnectAll() {
		this.toolMap.clear();
		await Promise.all(this.adapters.map((a) => a.disconnect()));
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

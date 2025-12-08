import { createStep } from "@mastra/core/workflows";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

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

	// Convert MCP Tool to Mastra Step
	createMastraStep(toolName: string) {
		// Input schema is required. For V1 dynamic tools, we use z.any() or generic object.
		const inputSchema = z.object({}).passthrough();
		const outputSchema = z.object({}).passthrough();

		const executeFn = async ({ context }: { context: unknown }) => {
			const result = await this.client.callTool({
				name: toolName,
				arguments: context as Record<string, unknown>,
			});
			return result;
		};

		return createStep({
			id: toolName,
			inputSchema,
			outputSchema,
			execute: executeFn as typeof executeFn & (() => Promise<Record<string, unknown>>),
		});
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

	createMastraStep(toolName: string) {
		const adapter = this.toolMap.get(toolName);
		if (!adapter) {
			throw new Error(`Tool ${toolName} not found in any connected MCP server`);
		}
		return adapter.createMastraStep(toolName);
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

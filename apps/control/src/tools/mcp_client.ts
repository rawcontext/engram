import { createStep } from "@mastra/core/workflows";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";

export class McpToolAdapter {
  private client: Client;

  constructor(
    private serverCommand: string,
    private serverArgs: string[] = [],
  ) {
    const _transport = new StdioClientTransport({
      command: this.serverCommand,
      args: this.serverArgs,
    });
    // Note: In V1, connection should be managed lifecycle-wise.
    // We initialize the client here.
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
      // biome-ignore lint/suspicious/noExplicitAny: Dynamic typing requires bypass for Mastra integration
      execute: executeFn as any,
    });
  }
}

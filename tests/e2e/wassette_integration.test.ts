import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "bun:test";

const WASSETTE_PATH = `${process.env.HOME}/.local/bin/wassette`;

describe("Wassette Integration", () => {
	it("should connect to wassette binary and list tools", async () => {
		const transport = new StdioClientTransport({
			command: WASSETTE_PATH,
			args: ["serve", "--stdio"],
		});

		const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

		await client.connect(transport);

		const tools = await client.listTools();
		expect(tools).toBeDefined();
		// Wassette might not have tools loaded initially, or might have built-ins.
		// At least we expect the connection to succeed and return a list (empty or not).
		expect(Array.isArray(tools.tools)).toBe(true);

		await client.close();
	});

	// Note: Loading a component requires network access to OCI registry or local file.
	// We'll skip the actual loading/execution in this basic integration test
	// unless we have a guaranteed local wasm file.
	// But establishing the connection proves the binary works and protocol matches.
});

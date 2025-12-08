import { beforeEach, describe, expect, it, mock } from "bun:test";
import { McpToolAdapter, MultiMcpAdapter } from "./mcp_client";

// Mock Client
const mockConnect = mock(async () => {});
const mockListTools = mock(async () => ({ tools: [{ name: "test-tool" }] }));
const mockCallTool = mock(async () => ({ content: [] }));

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		constructor() {}
		connect = mockConnect;
		listTools = mockListTools;
		callTool = mockCallTool;
	},
}));

// Mock Transport
mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: class {
		constructor() {}
	},
}));

// Mock Mastra
mock.module("@mastra/core/workflows", () => ({
	createStep: (obj: any) => ({ ...obj, _isStep: true }),
}));

describe("MCP Client", () => {
	beforeEach(() => {
		mockConnect.mockClear();
		mockListTools.mockClear();
		mockCallTool.mockClear();
	});

	describe("McpToolAdapter", () => {
		it("should connect and list tools", async () => {
			const adapter = new McpToolAdapter("echo");
			await adapter.connect();
			expect(mockConnect).toHaveBeenCalled();

			const tools = await adapter.listTools();
			expect(mockListTools).toHaveBeenCalled();
			expect(tools).toHaveLength(1);
			expect(tools[0].name).toBe("test-tool");
		});

		it("should create mastra step", async () => {
			const adapter = new McpToolAdapter("echo");
			const step = adapter.createMastraStep("test-tool");
			expect(step).toHaveProperty("id", "test-tool");
			expect(step).toHaveProperty("_isStep", true);

			// Test execution logic wrapper
			// @ts-expect-error
			await step.execute({ context: { arg: 1 } });
			expect(mockCallTool).toHaveBeenCalledWith({
				name: "test-tool",
				arguments: { arg: 1 },
			});
		});
	});

	describe("MultiMcpAdapter", () => {
		it("should aggregate tools from multiple adapters", async () => {
			const multi = new MultiMcpAdapter();
			const adapter1 = new McpToolAdapter("echo");
			const adapter2 = new McpToolAdapter("cat");

			multi.addAdapter(adapter1);
			multi.addAdapter(adapter2);

			await multi.connectAll();
			expect(mockConnect).toHaveBeenCalledTimes(2);

			// refreshTools is called in connectAll
			// listTools called for each adapter
			const tools = await multi.listTools();
			// Since mock returns same list for each instance
			expect(tools).toHaveLength(2); // 1 from each
		});

		it("should dispatch step creation to correct adapter", async () => {
			const multi = new MultiMcpAdapter();
			const adapter = new McpToolAdapter("echo");
			multi.addAdapter(adapter);
			await multi.connectAll(); // populate map

			const step = multi.createMastraStep("test-tool");
			expect(step.id).toBe("test-tool");
		});

		it("should throw if tool not found", () => {
			const multi = new MultiMcpAdapter();
			expect(() => multi.createMastraStep("missing")).toThrow("not found");
		});
	});
});

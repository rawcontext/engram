import { spyOn, beforeEach, describe, expect, it, mock } from "bun:test";
import { McpToolAdapter, MultiMcpAdapter } from "./mcp_client";

// Mock Client
const mockConnect = mock(async () => {});
const mockListTools = mock(async () => ({ tools: [{ name: "test-tool" }] }));
const mockCallTool = mock(async () => ({ content: [] }));
const mockClose = mock(async () => {});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: class {
		connect = mockConnect;
		listTools = mockListTools;
		callTool = mockCallTool;
		close = mockClose;
	},
}));

// Mock Transport
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: class {},
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

		it("should create adapter with server args", async () => {
			const adapter = new McpToolAdapter("node", ["server.js", "--port", "3000"]);
			await adapter.connect();
			expect(mockConnect).toHaveBeenCalled();
		});

		it("should call tool directly", async () => {
			const adapter = new McpToolAdapter("echo");
			await adapter.callTool("test-tool", { arg: 1 });
			expect(mockCallTool).toHaveBeenCalledWith({
				name: "test-tool",
				arguments: { arg: 1 },
			});
		});

		it("should disconnect successfully", async () => {
			const adapter = new McpToolAdapter("echo");
			await adapter.connect();
			expect(mockConnect).toHaveBeenCalled();

			await adapter.disconnect();
			expect(mockClose).toHaveBeenCalled();
		});

		it("should handle disconnect errors gracefully", async () => {
			mockClose.mockRejectedValueOnce(new Error("Close failed"));

			const adapter = new McpToolAdapter("echo");
			await adapter.connect();

			await expect(adapter.disconnect()).resolves.not.toThrow();
		});

		it("should not disconnect if not connected", async () => {
			mockClose.mockClear();

			const adapter = new McpToolAdapter("echo");
			await adapter.disconnect();

			expect(mockClose).not.toHaveBeenCalled();
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

		it("should dispatch tool call to correct adapter", async () => {
			const multi = new MultiMcpAdapter();
			const adapter = new McpToolAdapter("echo");
			multi.addAdapter(adapter);
			await multi.connectAll(); // populate map

			await multi.callTool("test-tool", { arg: 1 });
			expect(mockCallTool).toHaveBeenCalledWith({
				name: "test-tool",
				arguments: { arg: 1 },
			});
		});

		it("should throw if tool not found", async () => {
			const multi = new MultiMcpAdapter();
			await expect(multi.callTool("missing", {})).rejects.toThrow("not found");
		});

		it("should disconnect all adapters", async () => {
			const multi = new MultiMcpAdapter();
			const adapter1 = new McpToolAdapter("echo");
			const adapter2 = new McpToolAdapter("cat");

			multi.addAdapter(adapter1);
			multi.addAdapter(adapter2);
			await multi.connectAll();

			mockClose.mockClear();
			await multi.disconnectAll();

			expect(mockClose).toHaveBeenCalledTimes(2);
		});

		it("should handle refreshTools errors gracefully", async () => {
			const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

			mockListTools.mockRejectedValueOnce(new Error("Failed to list tools"));

			const multi = new MultiMcpAdapter();
			const adapter = new McpToolAdapter("echo");
			multi.addAdapter(adapter);

			await multi.connectAll();

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				"Failed to list tools from adapter",
				expect.any(Error),
			);

			consoleErrorSpy.mockRestore();
		});

		it("should clear toolMap before refreshing tools", async () => {
			const multi = new MultiMcpAdapter();
			const adapter = new McpToolAdapter("echo");
			multi.addAdapter(adapter);

			await multi.connectAll();

			// toolMap should be populated
			const result1 = await multi.callTool("test-tool", {});
			expect(result1).toBeDefined();

			// Refresh should clear and repopulate
			await multi.refreshTools();

			// Should still work after refresh
			const result2 = await multi.callTool("test-tool", {});
			expect(result2).toBeDefined();
		});

		it("should clear toolMap when disconnecting all", async () => {
			const multi = new MultiMcpAdapter();
			const adapter = new McpToolAdapter("echo");
			multi.addAdapter(adapter);

			await multi.connectAll();

			// toolMap is populated
			await multi.disconnectAll();

			// After disconnect, toolMap should be cleared
			await expect(multi.callTool("test-tool", {})).rejects.toThrow("not found");
		});
	});
});

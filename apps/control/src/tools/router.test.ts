import { beforeEach, describe, expect, it, mock } from "bun:test";

// Logger and storage are mocked in root preload (test-preload.ts)

// Import after mocking
import { VirtualFileSystem } from "@engram/vfs";
import { ExecutionService } from "../execution";
import type { MultiMcpAdapter } from "./mcp_client";
import { createToolRouter, ToolRouter } from "./router";

describe("ToolRouter", () => {
	let executionService: ExecutionService;
	let mockMcpAdapter: MultiMcpAdapter;
	let router: ToolRouter;

	beforeEach(() => {
		// Create real ExecutionService with a VFS
		const vfs = new VirtualFileSystem();
		executionService = new ExecutionService({ vfs });

		// Create mock MCP adapter
		mockMcpAdapter = {
			listTools: mock().mockResolvedValue([
				{ name: "external_tool", description: "An external MCP tool" },
			]),
			callTool: mock().mockResolvedValue({
				content: [{ type: "text", text: "MCP result" }],
			}),
			connectAll: mock().mockResolvedValue(undefined),
			disconnectAll: mock().mockResolvedValue(undefined),
		} as unknown as MultiMcpAdapter;

		router = new ToolRouter(executionService, mockMcpAdapter);
	});

	describe("listTools", () => {
		it("should include execution tools", async () => {
			const tools = await router.listTools();

			const toolNames = tools.map((t) => t.name);
			expect(toolNames).toContain("read_file");
			expect(toolNames).toContain("apply_patch");
			expect(toolNames).toContain("list_files_at_time");
		});

		it("should include MCP tools", async () => {
			const tools = await router.listTools();

			const toolNames = tools.map((t) => t.name);
			expect(toolNames).toContain("external_tool");
		});

		it("should not duplicate execution tools from MCP", async () => {
			// MCP also returns read_file
			(mockMcpAdapter.listTools as ReturnType<typeof mock>).mockResolvedValue([
				{ name: "read_file", description: "MCP read_file" },
				{ name: "external_tool", description: "External tool" },
			]);

			const tools = await router.listTools();

			// Should only have one read_file (from execution)
			const readFileTools = tools.filter((t) => t.name === "read_file");
			expect(readFileTools).toHaveLength(1);
			expect(readFileTools[0].description).toBe("Read a file from the Virtual File System");
		});

		it("should handle MCP adapter connection failure gracefully", async () => {
			(mockMcpAdapter.listTools as ReturnType<typeof mock>).mockRejectedValue(
				new Error("Connection failed"),
			);

			const tools = await router.listTools();

			// Should still return execution tools
			expect(tools.length).toBeGreaterThanOrEqual(3);
			expect(tools.map((t) => t.name)).toContain("read_file");
		});

		it("should use default description for MCP tools without description", async () => {
			(mockMcpAdapter.listTools as ReturnType<typeof mock>).mockResolvedValue([
				{ name: "tool_without_desc" },
			]);

			const tools = await router.listTools();

			const mcpTool = tools.find((t) => t.name === "tool_without_desc");
			expect(mcpTool).toBeDefined();
			expect(mcpTool?.description).toBe("Execute tool_without_desc");
		});
	});

	describe("callTool - Execution Tools", () => {
		it("should route read_file to ExecutionService", async () => {
			executionService.writeFile("/test.txt", "test content");

			const result = await router.callTool("read_file", { path: "/test.txt" });

			expect(result.content[0].text).toBe("test content");
			expect(result.isError).toBeUndefined();
			expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
		});

		it("should route apply_patch to ExecutionService", async () => {
			executionService.writeFile("/file.txt", "Hello, World!");
			const diff = `--- a/file.txt
+++ b/file.txt
@@ -1 +1 @@
-Hello, World!
+Hello, Universe!
`;

			const result = await router.callTool("apply_patch", { path: "/file.txt", diff });

			expect(result.content[0].text).toBe("Successfully patched /file.txt");
			expect(executionService.vfs.readFile("/file.txt")).toBe("Hello, Universe!");
			expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
		});

		it("should return error for failed read_file", async () => {
			const result = await router.callTool("read_file", { path: "/nonexistent.txt" });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error:");
		});

		it("should route list_files_at_time to ExecutionService", async () => {
			const result = await router.callTool("list_files_at_time", {
				session_id: "test-session",
				timestamp: Date.now(),
				path: "/custom/path",
			});

			expect(result.content).toBeDefined();
			expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
		});

		it("should route get_filesystem_snapshot to ExecutionService", async () => {
			const result = await router.callTool("get_filesystem_snapshot", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.content).toBeDefined();
			expect(result.content[0].text).toContain("root");
			expect(result.content[0].text).toContain("timestamp");
			expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
		});

		it("should handle get_filesystem_snapshot errors", async () => {
			const mockExecutionService = {
				...executionService,
				getFilesystemState: mock().mockRejectedValue(new Error("Failed to get state")),
			} as unknown as ExecutionService;

			const errorRouter = new ToolRouter(mockExecutionService, mockMcpAdapter);

			const result = await errorRouter.callTool("get_filesystem_snapshot", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error: Failed to get state");
		});

		it("should route get_zipped_snapshot to ExecutionService", async () => {
			const result = await router.callTool("get_zipped_snapshot", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.content).toBeDefined();
			expect(result.content[0].text).toContain("Zipped snapshot");
			expect(result.content[0].text).toContain("bytes");
			expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
		});

		it("should handle get_zipped_snapshot errors", async () => {
			const mockExecutionService = {
				...executionService,
				getZippedState: mock().mockRejectedValue(new Error("Failed to zip")),
			} as unknown as ExecutionService;

			const errorRouter = new ToolRouter(mockExecutionService, mockMcpAdapter);

			const result = await errorRouter.callTool("get_zipped_snapshot", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error: Failed to zip");
		});

		it("should handle execution tools by calling specific handlers", async () => {
			// Test that all known execution tools are properly handled
			const executionTools = [
				"read_file",
				"apply_patch",
				"list_files_at_time",
				"get_filesystem_snapshot",
				"get_zipped_snapshot",
			];

			// All these tools should be handled without going to MCP
			for (const tool of executionTools) {
				mockMcpAdapter.callTool = mock();
				await router.callTool(tool, { path: "/test", session_id: "s1", timestamp: 0 });
				expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
			}
		});
	});

	describe("callTool - Execution Tools", () => {
		it("should use default path for list_files_at_time when not provided", async () => {
			const result = await router.callTool("list_files_at_time", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.content).toBeDefined();
			expect(mockMcpAdapter.callTool).not.toHaveBeenCalled();
		});

		it("should handle non-Error exceptions in get_filesystem_snapshot", async () => {
			const mockExecutionService = {
				...executionService,
				getFilesystemState: mock().mockImplementation(() => {
					throw "string error";
				}),
			} as unknown as ExecutionService;

			const errorRouter = new ToolRouter(mockExecutionService, mockMcpAdapter);

			const result = await errorRouter.callTool("get_filesystem_snapshot", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error: string error");
		});

		it("should handle non-Error exceptions in get_zipped_snapshot", async () => {
			const mockExecutionService = {
				...executionService,
				getZippedState: mock().mockImplementation(() => {
					throw "string error";
				}),
			} as unknown as ExecutionService;

			const errorRouter = new ToolRouter(mockExecutionService, mockMcpAdapter);

			const result = await errorRouter.callTool("get_zipped_snapshot", {
				session_id: "test-session",
				timestamp: Date.now(),
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Error: string error");
		});

		it("should return error for unknown execution tool", async () => {
			// Create a router with a custom execution tool names set that includes an unknown tool
			const customRouter = new ToolRouter(executionService, mockMcpAdapter);
			// Hack to add an unknown tool to the set
			(customRouter as any).executionToolNames.add("unknown_execution_tool");

			const result = await (customRouter as any).callExecutionTool("unknown_execution_tool", {});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain("Unknown execution tool");
		});
	});

	describe("callTool - MCP Tools", () => {
		it("should route non-execution tools to MCP adapter", async () => {
			const result = await router.callTool("external_tool", { arg: "value" });

			expect(mockMcpAdapter.callTool).toHaveBeenCalledWith("external_tool", { arg: "value" });
			expect(result.content[0].text).toBe("MCP result");
		});

		it("should pass through MCP errors", async () => {
			(mockMcpAdapter.callTool as ReturnType<typeof mock>).mockResolvedValue({
				content: [{ type: "text", text: "MCP error" }],
				isError: true,
			});

			const result = await router.callTool("external_tool", {});

			expect(result.isError).toBe(true);
		});
	});

	describe("createToolRouter Factory", () => {
		it("should create a ToolRouter instance", () => {
			const router = createToolRouter(executionService, mockMcpAdapter);

			expect(router).toBeInstanceOf(ToolRouter);
		});
	});
});

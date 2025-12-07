import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Executor, DEFAULT_CONFIG, SECURE_POLICY, WasmLoader } from "@the-soul/wassette";
import { VirtualFileSystem, PatchManager } from "@the-soul/vfs";

// Initialize VFS (Tabula Rasa for now, until Rehydrator integration)
const vfs = new VirtualFileSystem();
const patchManager = new PatchManager(vfs);
const loader = new WasmLoader();
const executor = new Executor(DEFAULT_CONFIG, SECURE_POLICY);

const server = new McpServer({
  name: "soul-execution",
  version: "1.0.0",
});

server.tool(
  "read_file",
  "Read a file from the Virtual File System",
  {
    path: z.string(),
  },
  async ({ path }) => {
    try {
      const content = vfs.readFile(path);
      return {
        content: [{ type: "text", text: content }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "apply_patch",
  "Apply a unified diff or search/replace block to the VFS",
  {
    path: z.string(),
    diff: z.string(),
  },
  async ({ path, diff }) => {
    try {
      patchManager.applyUnifiedDiff(path, diff);
      return {
        content: [{ type: "text", text: `Successfully patched ${path}` }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "execute_tool",
  "Execute a tool (function) inside the Wasm sandbox",
  {
    tool_name: z.string(),
    args_json: z.string(),
  },
  async ({ tool_name, args_json }) => {
    try {
      // 1. Load Runtime (Python/JS)
      // For V1, assuming 'python'
      const module = await loader.load('python'); 
      
      // 2. Prepare VFS (Write args to stdin or file?)
      // Executor handles args?
      // In our design, wrapper reads stdin.
      // DEFAULT_CONFIG.stdin = args_json; // simplified config update
      
      // 3. Execute
      const result = await executor.execute(module, [tool_name]); // Pass tool name as arg to wrapper?
      
      return {
        content: [{ type: "text", text: result.stdout }],
      };
    } catch (e: any) {
       return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Soul Execution MCP Server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

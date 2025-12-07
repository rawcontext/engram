export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  // TODO: Implement semantic selection
  // async selectTools(query: string): Promise<Tool[]> { ... }
}

export const CORE_TOOLS: Tool[] = [
  {
    name: "read_file",
    description: "Read a file from the virtual file system",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "execute_tool",
    description: "Execute a script in the sandbox",
    parameters: {
      type: "object",
      properties: {
        tool_name: { type: "string" },
        args_json: { type: "string" },
      },
      required: ["tool_name", "args_json"],
    },
  },
  {
    name: "search_memory",
    description: "Search for information in the knowledge graph",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
];

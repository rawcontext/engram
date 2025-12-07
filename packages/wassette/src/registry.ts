import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  runtime: 'python' | 'javascript';
  entryPoint: string; 
  parameters: z.ZodSchema;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}

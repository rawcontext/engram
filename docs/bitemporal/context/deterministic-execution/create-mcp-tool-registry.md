# Bead: Create MCP Tool Registry

## Context
The system needs to know which tools are available.

## Goal
Define a registry mapping `tool_name` -> `ExecutionConfig`.

## Config
```typescript
interface ToolDefinition {
  name: string;
  description: string;
  runtime: 'python' | 'javascript';
  entryPoint: string; // e.g., 'utils.math.calculate'
  parameters: ZodSchema;
}
```

## Acceptance Criteria
-   [ ] `ToolRegistry` class implemented.
-   [ ] Method to register generic tools.
-   [ ] Method to export MCP-compatible tool lists.

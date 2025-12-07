# Bead: Implement Graphiti MCP Client Integration

## Context
The Agent needs to talk to the **Bitemporal Memory** service. We exposed it as an MCP Server in Phase 3.

## Goal
Create an adapter that connects to the Memory MCP Server and exposes its tools to the Mastra Agent.

## Logic
1.  Connect to Memory MCP (SSE/Stdio).
2.  List Tools (`read_graph`, `search_memory`).
3.  Wrap them as Vercel AI SDK `tool()` objects.
4.  Inject into Mastra Agent.

## Acceptance Criteria
-   [ ] `src/tools/memory_client.ts` implemented.
-   [ ] Adapter converts MCP Tool Schema -> Vercel AI SDK Schema.

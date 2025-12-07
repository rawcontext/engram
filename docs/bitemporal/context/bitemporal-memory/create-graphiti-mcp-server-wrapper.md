# Bead: Create Graphiti MCP Server Wrapper

## Context
The **Agent Control** layer needs to query memory. It uses the Model Context Protocol (MCP).

## Goal
Expose the Bitemporal Memory capabilities as an MCP Server.

## Tools to Expose
1.  `read_graph`: Execute Cypher (read-only).
2.  `search_memory`: Semantic + Graph hybrid search.
3.  `get_session_history`: Retrieve linear thought history for a user.

## Acceptance Criteria
-   [ ] MCP Server setup in `apps/memory`.
-   [ ] `read_graph` tool implemented.
-   [ ] `get_session_history` tool implemented.

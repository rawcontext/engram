# Bead: Implement Wassette MCP Client

## Context
The **Agent Control** layer interacts with this context via MCP.

## Goal
Implement the MCP Server interface for Deterministic Execution.

## Tools
1.  `execute_tool`: Run a specific tool with args.
2.  `apply_patch`: Modify the VFS.
3.  `read_file`: Read from VFS.
4.  `list_files`: LS the VFS.

## Acceptance Criteria
-   [ ] MCP Server configured in `apps/execution`.
-   [ ] Tools registered using the `@modelcontextprotocol/sdk`.
-   [ ] Integration tests ensure MCP calls trigger internal logic.

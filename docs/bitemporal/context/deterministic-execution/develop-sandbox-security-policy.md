# Bead: Develop Sandbox Security Policy

## Context
Executing code is dangerous.

## Goal
Define the hard constraints for the execution environment.

## Policy Rules
1.  **Network**: DISABLED. WASI sockets must be blocked or strictly allow-listed (if absolutely necessary for a specific tool, but generally blocked for "Pure" calculation).
2.  **Filesystem**:
    -   Read-Only: `/sys`, `/lib` (Runtime files).
    -   Read-Write: `/app` (User VFS).
    -   No access to Host OS files.
3.  **Resource Limits**:
    -   Max CPU time: 5 seconds.
    -   Max Memory: 512MB.
    -   Max Output Size: 1MB (stdout/stderr).

## Implementation
-   Use `node:wasi` options or `wasmtime` config to enforce these. Bun's `WASI` implementation allows restricting preopens. Resource limits might need an external supervisor or `performance.now()` checks if the runtime doesn't natively support instruction counting limits easily in JS-hosted WASI.

## Acceptance Criteria
-   [ ] `SecurityPolicy` configuration object defined.
-   [ ] Helper function `enforcePolicy(wasiInstance)` created.

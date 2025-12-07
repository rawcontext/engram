# Bead: Implement Tool Execution Monitor

## Context
We need to run the tool and wait for completion.

## Goal
Orchestrate the `WASI` start, monitor for exit code, and capture timing.

## Implementation
-   **Bun WASI**:
    ```typescript
    const wasi = new WASI({ ... });
    const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
    const exitCode = wasi.start(instance); // Note: verify async behavior in Bun docs
    ```
-   **Monitoring**: Wrap `wasi.start` in a `Promise.race` with a timeout timer.

## Acceptance Criteria
-   [ ] `Executor` class implemented.
-   [ ] Handles timeouts gracefully (terminating the instance if possible, or rejecting the promise).

# Bead: Implement Wasm Module Loader

## Context
We need to load Wasm binaries. For interpreted languages (Python, JS) running *inside* Wasm, we strictly load the **Interpreter's Wasm Binary** (e.g., `python.wasm`) and mount the user's code into the VFS.

## Goal
Implement logic to load and cache standard Wasm binaries (Python, QuickJS).

## Implementation
-   **Registry**: A local or remote (GCS) store of verified `python-3.11.wasm`, `quickjs.wasm` binaries.
-   **Cache**: Keep frequently used runtimes in memory/disk cache.
-   **Loader**: `loadRuntime('python')` returns `WebAssembly.Module`.

## Acceptance Criteria
-   [ ] `WasmRegistry` class implemented.
-   [ ] Mechanisms to fetch and cache `.wasm` files.

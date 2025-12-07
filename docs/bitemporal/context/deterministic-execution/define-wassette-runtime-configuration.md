# Bead: Define Wassette Runtime Configuration

## Context
"Wassette" is our specific Wasm Runtime environment (likely based on `node:wasi` in Bun or `wasmtime`).

## Goal
Define the configuration schema for initializing a Wasm container.

## Configuration
```typescript
interface WassetteConfig {
  memoryLimit: number; // Pages or MB
  timeoutMs: number; // Execution time limit
  env: Record<string, string>; // Environment variables
  preopens: Record<string, string>; // Host path -> Guest path mapping
  stdin?: string; // Input for the process
}
```

## Research & Rationale
-   **Preopens**: In a cloud environment, we can't map arbitrary host paths. We map the **Rehydrated VFS** (which might exist in a temp dir on the host) to `/src` or `/app` inside the Wasm guest.
-   **Security**: `env` should be scrubbed. No network access allowed by default.

## Acceptance Criteria
-   [ ] `WassetteConfig` interface defined.
-   [ ] Default "Secure Profile" defined (no network, limited memory).

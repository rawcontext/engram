# Bead: Create Execution Service Dockerfile

## Context
The **Execution Service** runs untrusted code or Wasm modules. It requires strict sandboxing.
*Security Note*: Running this on Cloud Run is safe *if* we use WebAssembly (Wassette) as the sandbox. If we use Docker-in-Docker, Cloud Run is not suitable (privileged mode issues). We assume **Wasm-based execution**.

## Goal
Create a `Dockerfile` for the Execution Service.

## Specifications
-   **Base Image**: `oven/bun:1-alpine`.
-   **Dependencies**: `wasm-mercury` (or project equivalent `wassette`).

## Dockerfile

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=execution...

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S soul && adduser -S soul -G soul

COPY --from=builder /app/apps/execution/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# Copy any pre-compiled Wasm shims if needed
# COPY --from=builder /app/packages/wassette/shims ./shims

USER soul
EXPOSE 8080
CMD ["bun", "run", "dist/index.js"]
```

## Acceptance Criteria
-   [ ] Dockerfile builds.
-   [ ] Wasm runtime initializes correctly inside the container.

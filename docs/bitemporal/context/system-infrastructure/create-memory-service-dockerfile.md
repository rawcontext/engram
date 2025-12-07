# Bead: Create Memory Service Dockerfile

## Context
The **Memory Service** interacts with FalkorDB and Redpanda. It requires robust error handling and potentially native bindings for Redis clients.

## Goal
Create a `Dockerfile` for the Memory Service.

## Specifications
-   **Base Image**: `node:20-alpine` (If specific native bindings for FalkorDB require Node over Bun, otherwise default to `oven/bun:1-alpine`. *Decision: Stick to Bun unless proven incompatible.*)
-   **Ports**: Expose `8080`.

## Dockerfile

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=memory...

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S soul && adduser -S soul -G soul

COPY --from=builder /app/apps/memory/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

USER soul
EXPOSE 8080
CMD ["bun", "run", "dist/index.js"]
```

## Acceptance Criteria
-   [ ] Dockerfile builds successfully.
-   [ ] Native dependencies for Redis/FalkorDB client (if any) are correctly linked.
-   [ ] Container passes local smoke test.

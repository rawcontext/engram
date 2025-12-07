# Bead: Create Search Service Dockerfile

## Context
The **Search Service** calculates embeddings and talks to Qdrant. It may require Python for heavy ML lifting, OR we use a remote Embedding API (OpenAI/Voyage).
*Assumption*: We use a Node/Bun service that calls an external Embedding API or a sidecar. If local embeddings are required (e.g., `transformers.js` or ONNX), image size increases.
*Decision*: Keep it lightweight TS/Bun calling external APIs for now.

## Goal
Create a `Dockerfile` for the Search Service.

## Specifications
-   **Base Image**: `oven/bun:1-alpine`.
-   **Ports**: Expose `8080`.

## Dockerfile

```dockerfile
FROM oven/bun:1 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=search...

FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S soul && adduser -S soul -G soul

COPY --from=builder /app/apps/search/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

USER soul
EXPOSE 8080
CMD ["bun", "run", "dist/index.js"]
```

## Acceptance Criteria
-   [ ] Dockerfile builds successfully.
-   [ ] ONNX Runtime (if added later) functionality is verified.

# Bead: Create Ingestion Service Dockerfile

## Context
The **Ingestion Service** handles high-throughput raw event streams. It must be lightweight, fast, and capable of buffering data.

## Goal
Create a production-ready `Dockerfile` for the Ingestion Service, optimized for Cloud Run deployment.

## Specifications
-   **Base Image**: `oven/bun:1-alpine` (Smallest footprint, fastest startup).
-   **Ports**: Expose `8080` (Cloud Run default).
-   **Optimization**: Multi-stage build to prune dev dependencies.

## Dockerfile

```dockerfile
# Stage 1: Builder
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lockb turbo.json ./
COPY apps/ingestion ./apps/ingestion
COPY packages ./packages
# Install dependencies (including dev for build steps)
RUN bun install --frozen-lockfile
# Build the application
RUN bun run build --filter=ingestion...

# Stage 2: Runner
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S soul && adduser -S soul -G soul

# Copy built artifacts and necessary node_modules
# Note: In a real Turborepo, we might use 'turbo prune' to isolate the lockfile per app
COPY --from=builder /app/apps/ingestion/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/ingestion/package.json ./

USER soul
EXPOSE 8080

CMD ["bun", "run", "dist/index.js"]
```

## Acceptance Criteria
-   [ ] Dockerfile creates a valid image.
-   [ ] Image size is < 200MB.
-   [ ] Container starts successfully locally.
-   [ ] Health check endpoint (`/health`) returns 200 OK.

# syntax=docker/dockerfile:1.4
FROM oven/bun:1.3.5 AS builder
WORKDIR /app

# Copy everything for dependency resolution and codegen
COPY . .

# Install with BuildKit cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install

# Generate graph query builders
RUN bun run --filter=@engram/graph generate

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

COPY --from=builder --chown=engram:engram /app/apps/api ./apps/api
COPY --from=builder --chown=engram:engram /app/packages ./packages
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./package.json

USER engram
EXPOSE 6174
CMD ["bun", "run", "apps/api/src/index.ts"]

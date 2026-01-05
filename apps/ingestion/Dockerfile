# syntax=docker/dockerfile:1.4
FROM oven/bun:1.3.5 AS builder
WORKDIR /app

# Copy everything for dependency resolution
COPY . .

# Install with BuildKit cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

COPY --from=builder --chown=engram:engram /app/apps/ingestion ./apps/ingestion
COPY --from=builder --chown=engram:engram /app/packages ./packages
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./package.json

USER engram
EXPOSE 6175
CMD ["bun", "run", "apps/ingestion/src/index.ts"]

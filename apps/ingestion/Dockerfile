# syntax=docker/dockerfile:1.4
FROM oven/bun:1.3.5 AS builder
WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lock turbo.json ./
COPY apps/ingestion/package.json apps/ingestion/
COPY packages/common/package.json packages/common/
COPY packages/events/package.json packages/events/
COPY packages/logger/package.json packages/logger/
COPY packages/parser/package.json packages/parser/
COPY packages/storage/package.json packages/storage/

# Install with BuildKit cache mount for faster rebuilds
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install

# Copy source code
COPY . .

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

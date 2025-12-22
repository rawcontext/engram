# Stage 1: Builder
FROM oven/bun:1.3.5 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api ./apps/api
COPY packages ./packages
# Install dependencies
RUN bun install
# Build dependencies first, then api
WORKDIR /app/packages/common
RUN bun run build
WORKDIR /app/packages/logger
RUN bun run build
WORKDIR /app/packages/events
RUN bun run build
WORKDIR /app/packages/storage
RUN bun run build
WORKDIR /app/packages/graph
RUN bun run build
WORKDIR /app/apps/api
RUN bun run build

# Stage 2: Runner
FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S engram && adduser -S engram -G engram

# Copy built app and dependencies
COPY --from=builder --chown=engram:engram /app/apps/api ./apps/api
COPY --from=builder --chown=engram:engram /app/packages ./packages
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./

USER engram
EXPOSE 8080

WORKDIR /app/apps/api
CMD ["bun", "run", "dist/index.js"]

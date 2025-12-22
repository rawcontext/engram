# Stage 1: Builder
FROM oven/bun:1.3.5 AS builder
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/ingestion ./apps/ingestion
COPY packages ./packages
# Install dependencies
RUN bun install
# Build dependencies
WORKDIR /app/packages/common
RUN bun run build
WORKDIR /app/packages/logger
RUN bun run build
WORKDIR /app/packages/events
RUN bun run build
WORKDIR /app/packages/storage
RUN bun run build
WORKDIR /app/packages/parser
RUN bun run build

# Stage 2: Runner - use Node.js for Kafka native bindings compatibility
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S engram && adduser -S engram -G engram

# Copy source files and built packages
COPY --from=builder --chown=engram:engram /app/apps/ingestion ./apps/ingestion
COPY --from=builder --chown=engram:engram /app/packages ./packages
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./

USER engram
EXPOSE 5001

WORKDIR /app/apps/ingestion
CMD ["node", "--import", "tsx", "src/index.ts"]

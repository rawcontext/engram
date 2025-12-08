FROM oven/bun:1.3.4 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=memory-service...

FROM oven/bun:1.3.4-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

COPY --from=builder /app/apps/memory/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

USER engram
EXPOSE 8080
CMD ["bun", "run", "dist/index.js"]

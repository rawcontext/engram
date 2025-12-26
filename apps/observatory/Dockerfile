FROM oven/bun:1.3.5 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=observatory...

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

# Copy full workspace for custom server dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages

# Next.js standalone output (we use .next but not server.js)
COPY --from=builder /app/apps/observatory/.next ./apps/observatory/.next
RUN mkdir -p ./apps/observatory/public

# Custom server source and WebSocket handlers
COPY --from=builder /app/apps/observatory/server.ts ./apps/observatory/
COPY --from=builder /app/apps/observatory/lib ./apps/observatory/lib
COPY --from=builder /app/apps/observatory/app ./apps/observatory/app
COPY --from=builder /app/apps/observatory/package.json ./apps/observatory/
# Next.js config (required for image remotePatterns)
COPY --from=builder /app/apps/observatory/next.config.mjs ./apps/observatory/

USER engram
EXPOSE 3000
WORKDIR /app/apps/observatory
# Use custom server with WebSocket support - bun natively runs TypeScript
CMD ["bun", "run", "server.ts"]

FROM oven/bun:1.3.4 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=interface-service...

FROM oven/bun:1.3.4-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

# Next.js standalone output
COPY --from=builder /app/apps/interface/.next/standalone ./
COPY --from=builder /app/apps/interface/.next/static ./apps/interface/.next/static
COPY --from=builder /app/apps/interface/public ./apps/interface/public

USER engram
EXPOSE 3000
WORKDIR /app/apps/interface
CMD ["bun", "run", "server.js"]

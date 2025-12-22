FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && npm install -g bun@1.3.5
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build --filter=observatory...

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

# Next.js standalone output
COPY --from=builder /app/apps/observatory/.next/standalone ./
COPY --from=builder /app/apps/observatory/.next/static ./apps/observatory/.next/static
COPY --from=builder /app/apps/observatory/public ./apps/observatory/public

USER engram
EXPOSE 3000
WORKDIR /app/apps/observatory
CMD ["bun", "run", "server.js"]

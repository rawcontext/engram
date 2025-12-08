FROM oven/bun:1.3.4 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.4-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

# Control runs TypeScript directly with Bun
COPY --from=builder /app/apps/control ./apps/control
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER engram
EXPOSE 8080
CMD ["bun", "run", "apps/control/src/index.ts"]

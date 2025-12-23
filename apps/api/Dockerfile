FROM oven/bun:1.3.5 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

USER engram
EXPOSE 6174
CMD ["bun", "run", "apps/api/src/index.ts"]

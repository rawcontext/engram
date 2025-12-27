FROM oven/bun:1.3.5 AS builder
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

# Control runs TypeScript directly with Bun
COPY --from=builder --chown=engram:engram /app/apps/control ./apps/control
COPY --from=builder --chown=engram:engram /app/packages ./packages
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./package.json

USER engram
EXPOSE 8080
CMD ["bun", "run", "apps/control/src/index.ts"]

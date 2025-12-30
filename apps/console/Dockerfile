FROM oven/bun:1.3.5 AS builder
WORKDIR /app
COPY . .
RUN bun install
# Build-time env vars needed for Next.js page collection (overridden at runtime)
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-placeholder
# Create placeholder .env.local (symlink target excluded in build context)
RUN touch apps/console/.env.local apps/observatory/.env.local
RUN bun run build --filter=console...

FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S engram && adduser -S engram -G engram

# Copy workspace dependencies
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./package.json
COPY --from=builder --chown=engram:engram /app/packages ./packages

# Next.js build output
COPY --from=builder --chown=engram:engram /app/apps/console/.next ./apps/console/.next
COPY --from=builder --chown=engram:engram /app/apps/console/public ./apps/console/public
COPY --from=builder --chown=engram:engram /app/apps/console/package.json ./apps/console/
COPY --from=builder --chown=engram:engram /app/apps/console/next.config.ts ./apps/console/

USER engram
EXPOSE 3000
WORKDIR /app/apps/console
CMD ["bun", "run", "next", "start", "--port", "3000"]

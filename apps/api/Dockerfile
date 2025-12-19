FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/common/package*.json ./packages/common/
COPY packages/logger/package*.json ./packages/logger/
COPY packages/graph/package*.json ./packages/graph/
COPY packages/storage/package*.json ./packages/storage/
COPY packages/search/package*.json ./packages/search/
COPY packages/tsconfig/package*.json ./packages/tsconfig/

# Install dependencies
RUN npm ci --workspace=@engram/api

# Copy source
COPY packages ./packages
COPY apps/api ./apps/api

# Build
RUN npm run build --workspace=@engram/api

# Production image
FROM node:24-alpine AS runner

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S engram -u 1001 && \
    chown -R engram:nodejs /app

USER engram

EXPOSE 8080

ENV NODE_ENV=production
ENV PORT=8080

CMD ["node", "dist/index.js"]

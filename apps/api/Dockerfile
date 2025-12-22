# Stage 1: Builder - use Node.js for Kafka native bindings compatibility
FROM node:24-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY apps/api ./apps/api
COPY packages ./packages

# Install dependencies with npm for Node.js native bindings
RUN npm ci

# Build dependencies using npm scripts
WORKDIR /app/packages/common
RUN npm run build
WORKDIR /app/packages/logger
RUN npm run build
WORKDIR /app/packages/events
RUN npm run build
WORKDIR /app/packages/storage
RUN npm run build
WORKDIR /app/packages/graph
RUN npm run build
WORKDIR /app/apps/api
RUN npm run build

# Stage 2: Runner
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S engram && adduser -S engram -G engram

# Copy built app and dependencies
COPY --from=builder --chown=engram:engram /app/apps/api ./apps/api
COPY --from=builder --chown=engram:engram /app/packages ./packages
COPY --from=builder --chown=engram:engram /app/node_modules ./node_modules
COPY --from=builder --chown=engram:engram /app/package.json ./

USER engram
EXPOSE 8080

WORKDIR /app/apps/api
CMD ["node", "dist/index.js"]

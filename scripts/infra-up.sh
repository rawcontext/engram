#!/bin/bash
# Start Engram infrastructure and services

set -e

echo "=============================================="
echo "Starting Engram Infrastructure"
echo "=============================================="

# Start Docker containers (exclude services that don't work on ARM64)
echo "Starting Docker containers..."
docker-compose -f docker-compose.dev.yml up -d nats falkordb qdrant postgres

# Wait for services to be healthy
echo "Waiting for infrastructure to be ready..."
sleep 5

# Check health
echo ""
echo "=== Infrastructure Status ==="
docker ps --filter name=engram --format "table {{.Names}}\t{{.Status}}" | head -10

# Initialize NATS JetStream streams
echo ""
echo "=== Initializing NATS Streams ==="
bun run scripts/init-nats-streams.ts

# Start TypeScript services
echo ""
echo "=== Starting TypeScript Services ==="
(cd apps/memory && bun run dev) > /tmp/engram-memory.log 2>&1 &
echo "Memory service started (logs: /tmp/engram-memory.log)"

(cd apps/ingestion && bun run dev) > /tmp/engram-ingestion.log 2>&1 &
echo "Ingestion service started (logs: /tmp/engram-ingestion.log)"

(cd apps/control && bun run dev) > /tmp/engram-control.log 2>&1 &
echo "Control service started (logs: /tmp/engram-control.log)"

(cd apps/observatory && bun run dev) > /tmp/engram-observatory.log 2>&1 &
echo "Observatory service started (logs: /tmp/engram-observatory.log)"

# Start Python search service
echo ""
echo "=== Starting Python Services ==="
(cd apps/search && uv run search) > /tmp/engram-search.log 2>&1 &
echo "Search service started (logs: /tmp/engram-search.log)"

echo ""
echo "=============================================="
echo "Engram Infrastructure Started"
echo "=============================================="
echo ""
echo "Services:"
echo "  Memory:      http://localhost:stdio (MCP)"
echo "  Ingestion:   http://localhost:5001"
echo "  Control:     http://localhost:stdio (MCP)"
echo "  Observatory: http://localhost:5000"
echo "  Search:      http://localhost:5002"
echo ""
echo "Infrastructure:"
echo "  NATS:      localhost:4222 (JetStream)"
echo "  FalkorDB:  localhost:6379"
echo "  Qdrant:    localhost:6333"
echo "  Postgres:  localhost:5432"
echo ""
echo "Logs: /tmp/engram-*.log"
echo ""

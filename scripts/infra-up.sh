#!/bin/bash
# Start Engram infrastructure and services

set -e

echo "=============================================="
echo "Starting Engram Infrastructure"
echo "=============================================="

# Start Docker containers (exclude services that don't work on ARM64)
echo "Starting Docker containers..."
docker-compose -f docker-compose.dev.yml up -d redpanda falkordb qdrant postgres

# Wait for services to be healthy
echo "Waiting for infrastructure to be ready..."
sleep 5

# Check health
echo ""
echo "=== Infrastructure Status ==="
docker ps --filter name=engram --format "table {{.Names}}\t{{.Status}}" | head -10

# Start TypeScript services
echo ""
echo "=== Starting TypeScript Services ==="
npm run -w @engram/memory dev > /tmp/engram-memory.log 2>&1 &
echo "Memory service started (logs: /tmp/engram-memory.log)"

npm run -w @engram/ingestion dev > /tmp/engram-ingestion.log 2>&1 &
echo "Ingestion service started (logs: /tmp/engram-ingestion.log)"

# Start Python search service
echo ""
echo "=== Starting Python Services ==="
cd apps/search && uv run search > /tmp/engram-search.log 2>&1 &
cd ../..
echo "Search service started (logs: /tmp/engram-search.log)"

echo ""
echo "=============================================="
echo "Engram Infrastructure Started"
echo "=============================================="
echo ""
echo "Services:"
echo "  Memory:    npm run -w @engram/memory dev"
echo "  Ingestion: npm run -w @engram/ingestion dev"
echo "  Search:    http://localhost:5002"
echo ""
echo "Infrastructure:"
echo "  Redpanda:  localhost:19092 (Kafka)"
echo "  FalkorDB:  localhost:6379"
echo "  Qdrant:    localhost:6333"
echo "  Postgres:  localhost:5432"
echo ""
echo "Logs: /tmp/engram-*.log"
echo ""

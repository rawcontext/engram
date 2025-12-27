#!/bin/bash
# Stop Engram infrastructure and services

set -e

echo "=============================================="
echo "Stopping Engram Infrastructure"
echo "=============================================="

# Stop TypeScript services
echo "Stopping TypeScript services..."
pkill -f "tsx.*@engram/memory" 2>/dev/null || true
pkill -f "tsx.*@engram/ingestion" 2>/dev/null || true
pkill -f "tsx.*@engram/observatory" 2>/dev/null || true
pkill -f "tsx.*apps/memory" 2>/dev/null || true
pkill -f "tsx.*apps/ingestion" 2>/dev/null || true
pkill -f "tsx.*apps/observatory" 2>/dev/null || true

# Stop Python services
echo "Stopping Python services..."
pkill -9 -f "search/.venv/bin/python" 2>/dev/null || true
pkill -9 -f "search/.venv/bin/search" 2>/dev/null || true
pkill -9 -f "uv run search" 2>/dev/null || true

# Stop Docker containers
echo "Stopping Docker containers..."
docker-compose -f docker-compose.dev.yml down

echo ""
echo "=============================================="
echo "Engram Infrastructure Stopped"
echo "=============================================="

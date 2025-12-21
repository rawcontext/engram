#!/bin/bash
# Stop Engram infrastructure and services

set -e

echo "=============================================="
echo "Stopping Engram Infrastructure"
echo "=============================================="

# Stop TypeScript services
echo "Stopping TypeScript services..."
pkill -f "tsx.*memory" 2>/dev/null || true
pkill -f "tsx.*ingestion" 2>/dev/null || true

# Stop Python services
echo "Stopping Python services..."
pkill -f "uvicorn.*src.main" 2>/dev/null || true
lsof -ti:5002 | xargs kill -9 2>/dev/null || true

# Stop Docker containers
echo "Stopping Docker containers..."
docker-compose -f docker-compose.dev.yml down

echo ""
echo "=============================================="
echo "Engram Infrastructure Stopped"
echo "=============================================="

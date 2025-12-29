#!/usr/bin/env bash
set -euo pipefail

# Verify OAuth Setup Script
# Checks that all services are configured correctly for local OAuth development

echo "🔍 Verifying Engram OAuth Setup..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track failures
FAILED=0

# Function to check service health
check_service() {
    local name=$1
    local url=$2
    local expected_status=${3:-200}

    echo -n "Checking ${name}... "

    if response=$(curl -s -o /dev/null -w "%{http_code}" "${url}" 2>/dev/null); then
        if [ "$response" -eq "$expected_status" ]; then
            echo -e "${GREEN}✓${NC} (HTTP ${response})"
        else
            echo -e "${RED}✗${NC} (HTTP ${response}, expected ${expected_status})"
            FAILED=$((FAILED + 1))
        fi
    else
        echo -e "${RED}✗${NC} (Connection failed)"
        FAILED=$((FAILED + 1))
    fi
}

# Check .env file exists
echo "1. Environment Configuration"
if [ -f .env ]; then
    echo -e "   ${GREEN}✓${NC} .env file exists"

    # Check required variables
    required_vars=("BETTER_AUTH_SECRET" "ENGRAM_SEARCH_CLIENT_SECRET" "ENGRAM_TUNER_CLIENT_SECRET")
    for var in "${required_vars[@]}"; do
        if grep -q "^${var}=" .env 2>/dev/null; then
            echo -e "   ${GREEN}✓${NC} ${var} is set"
        else
            echo -e "   ${YELLOW}⚠${NC} ${var} not found (using default)"
        fi
    done
else
    echo -e "   ${RED}✗${NC} .env file not found"
    echo "   Run: cp .env.local.example .env"
    FAILED=$((FAILED + 1))
fi
echo ""

# Check infrastructure services
echo "2. Infrastructure Services"
check_service "PostgreSQL" "http://localhost:6183" 000
check_service "FalkorDB" "http://localhost:6179" 000
check_service "NATS" "http://localhost:6182/healthz"
check_service "Qdrant" "http://localhost:6180/healthz"
echo ""

# Check Observatory (OAuth server)
echo "3. Observatory (OAuth Server)"
check_service "Health endpoint" "http://localhost:6178/api/health"
check_service "OAuth metadata" "http://localhost:6178/.well-known/oauth-authorization-server"
echo ""

# Check authenticated services
echo "4. Authenticated Services"
echo "   Note: These require valid OAuth tokens and will fail without them"
check_service "Search service health" "http://localhost:6176/v1/health" 401
check_service "Tuner service health" "http://localhost:6177/v1/health" 401
echo ""

# Check Docker containers
echo "5. Docker Containers"
if command -v docker &> /dev/null; then
    containers=("engram-observatory-1" "engram-search-1" "engram-tuner-1" "engram-postgres-1")
    for container in "${containers[@]}"; do
        echo -n "   ${container}... "
        if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
            status=$(docker inspect --format='{{.State.Health.Status}}' "${container}" 2>/dev/null || echo "none")
            if [ "$status" = "healthy" ]; then
                echo -e "${GREEN}✓${NC} running (healthy)"
            elif [ "$status" = "none" ]; then
                echo -e "${YELLOW}⚠${NC} running (no healthcheck)"
            else
                echo -e "${YELLOW}⚠${NC} running (${status})"
            fi
        else
            echo -e "${RED}✗${NC} not running"
            FAILED=$((FAILED + 1))
        fi
    done
else
    echo -e "   ${YELLOW}⚠${NC} Docker not found, skipping container check"
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  • Access Observatory: http://localhost:6178"
    echo "  • Test device flow: See docs/local-oauth-setup.md"
    echo "  • Get OAuth token: curl -X POST http://localhost:6178/api/auth/device/code"
    exit 0
else
    echo -e "${RED}✗ ${FAILED} check(s) failed${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  • Start infrastructure: bun run infra:up"
    echo "  • Check logs: docker-compose logs observatory"
    echo "  • Full guide: docs/local-oauth-setup.md"
    exit 1
fi

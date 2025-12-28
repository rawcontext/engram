#!/bin/bash
# Deploy Engram to Hetzner Cloud
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get server IP from hcloud CLI
if ! command -v hcloud &> /dev/null; then
    echo -e "${RED}Error: hcloud CLI not found. Install it first:${NC}"
    echo "  brew install hcloud"
    exit 1
fi

SERVER_NAME="${HETZNER_SERVER_NAME:-engram}"
SERVER_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null)
if [ -z "$SERVER_IP" ]; then
    echo -e "${RED}Error: Server '$SERVER_NAME' not found.${NC}"
    echo "Create it first with OpenTofu:"
    echo "  cd packages/infra && tofu apply"
    exit 1
fi

echo -e "${GREEN}Deploying to $SERVER_IP...${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Warning: .env file not found. Copy .env.prod.example to .env first.${NC}"
    exit 1
fi

# Sync files to server
echo -e "${GREEN}Syncing files...${NC}"
rsync -avz --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '.venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    --exclude 'dist' \
    --exclude 'data' \
    --exclude '.turbo' \
    --exclude '.next' \
    . engram@$SERVER_IP:/opt/engram/

# Deploy
echo -e "${GREEN}Deploying on server...${NC}"
ssh engram@$SERVER_IP << 'EOF'
    set -e
    cd /opt/engram

    echo "Creating data directories..."
    sudo mkdir -p /var/lib/engram/{qdrant,falkordb,postgres,nats,caddy/data,caddy/config}

    # Fix postgres ownership (UID 70 is postgres user in alpine container)
    # This prevents "Permission denied" errors on pg_filenode.map
    echo "Fixing postgres directory ownership..."
    sudo chown -R 70:70 /var/lib/engram/postgres

    echo "Pulling latest images..."
    docker compose -f docker-compose.prod.yml pull

    echo "Building images..."
    docker compose -f docker-compose.prod.yml build

    echo "Starting services..."
    docker compose -f docker-compose.prod.yml up -d

    echo "Waiting for services to be healthy..."
    sleep 10

    echo "Service status:"
    docker compose -f docker-compose.prod.yml ps
EOF

echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Service URLs:"
echo "  API:    http://$SERVER_IP:8080"
echo "  Search: http://$SERVER_IP:5002"
echo "  Tuner:  http://$SERVER_IP:8000"
echo ""
echo "Useful commands:"
echo "  View logs:   ssh engram@$SERVER_IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml logs -f'"
echo "  Service status: ssh engram@$SERVER_IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml ps'"
echo "  Restart:     ssh engram@$SERVER_IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml restart'"
echo "  Stop:        ssh engram@$SERVER_IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml down'"

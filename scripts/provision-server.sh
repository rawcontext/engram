#!/bin/bash
# Provision a new Hetzner server with Docker and required dependencies
# Run this after OpenTofu creates the server
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get server IP
SERVER_NAME="${HETZNER_SERVER_NAME:-engram}"
SERVER_IP=$(hcloud server ip "$SERVER_NAME" 2>/dev/null)

if [ -z "$SERVER_IP" ]; then
    echo -e "${RED}Error: Server '$SERVER_NAME' not found.${NC}"
    exit 1
fi

echo -e "${GREEN}Provisioning server at $SERVER_IP...${NC}"

# Remove old host key if exists
ssh-keygen -R "$SERVER_IP" 2>/dev/null || true

# Wait for SSH to be available
echo -e "${YELLOW}Waiting for SSH to be available...${NC}"
until ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 root@$SERVER_IP "echo SSH ready" 2>/dev/null; do
    echo "Waiting for SSH..."
    sleep 5
done

echo -e "${GREEN}Installing Docker from official repository...${NC}"
ssh root@$SERVER_IP << 'EOF'
set -e

# Add Docker's official GPG key
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update and install Docker CE with compose plugin
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Ensure engram user can use docker
usermod -aG docker engram

# Create application directory
mkdir -p /opt/engram
chown engram:engram /opt/engram

# Verify installation
docker --version
docker compose version

echo "Provisioning complete!"
EOF

echo -e "${GREEN}Server provisioned successfully!${NC}"
echo ""
echo "Server: $SERVER_IP"
echo "Docker: $(ssh root@$SERVER_IP 'docker --version')"
echo "Compose: $(ssh root@$SERVER_IP 'docker compose version')"
echo ""
echo "Next steps:"
echo "  1. Run ./scripts/deploy-hetzner.sh to deploy services"

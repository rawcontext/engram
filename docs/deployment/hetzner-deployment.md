# Hetzner Production Deployment

Deploy Engram to a Hetzner Cloud VPS with Docker Compose.

## Prerequisites

1. **Install Hetzner CLI**
   ```bash
   # macOS
   brew install hcloud

   # Linux
   curl -sSLO https://github.com/hetznercloud/cli/releases/latest/download/hcloud-linux-amd64.tar.gz
   sudo tar -C /usr/local/bin --no-same-owner -xzf hcloud-linux-amd64.tar.gz hcloud
   ```

2. **Create Hetzner API Token**
   - Go to https://console.hetzner.cloud
   - Select your project or create one
   - Go to Security → API Tokens
   - Generate new token with Read & Write permissions

3. **Configure CLI**
   ```bash
   hcloud context create engram
   # Paste your API token when prompted
   ```

4. **Create SSH Key**
   ```bash
   # Generate SSH key (if needed)
   ssh-keygen -t ed25519 -C "engram-server"

   # Upload to Hetzner
   hcloud ssh-key create --name engram-key --public-key-from-file ~/.ssh/id_ed25519.pub
   ```

## Server Setup

### Create Server

```bash
# Create CPX31 server in Ashburn, VA
hcloud server create \
  --name engram-kbrm \
  --type cpx31 \
  --image ubuntu-24.04 \
  --location ash \
  --ssh-key engram-key

# Get server IP
hcloud server ip engram-kbrm
```

**Server Specs (CPX31):**
- 4 vCPU (AMD)
- 8 GB RAM
- 160 GB NVMe SSD
- 1 TB transfer
- Cost: $18.59/month

### Initial Server Configuration

```bash
# SSH into server
hcloud server ssh engram-kbrm

# Create user
adduser engram
usermod -aG sudo engram
cp -r ~/.ssh /home/engram/
chown -R engram:engram /home/engram/.ssh

# Configure firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8080/tcp   # API
ufw allow 5002/tcp   # Search
ufw allow 8000/tcp   # Tuner
ufw enable

# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker engram
apt install docker-compose-plugin

# Create application directory
sudo mkdir -p /opt/engram
sudo chown -R engram:engram /opt/engram

# Reboot
reboot
```

## Environment Configuration

1. **Copy environment template**
   ```bash
   cp .env.prod.example .env
   ```

2. **Edit .env and set:**
   - `POSTGRES_PASSWORD` - Strong password for PostgreSQL
   - `HF_API_TOKEN` - Your Hugging Face API token (get from https://huggingface.co/settings/tokens)

## Deployment

### Automated Deployment

```bash
# Deploy everything
./scripts/deploy-hetzner.sh
```

This script will:
1. Sync codebase to server
2. Create data directories
3. Pull Docker images
4. Build application images
5. Start all services
6. Show service status

### Manual Deployment

```bash
SERVER_IP=$(hcloud server ip engram-kbrm)

# Sync files
rsync -avz --exclude '.git' --exclude 'node_modules' --exclude '.venv' \
  . engram@$SERVER_IP:/opt/engram/

# SSH and deploy
ssh engram@$SERVER_IP
cd /opt/engram
docker compose -f docker-compose.prod.yml up -d
```

## Service Management

### View Status

```bash
SERVER_IP=$(hcloud server ip engram-kbrm)
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml ps"
```

### View Logs

```bash
# All services
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml logs -f"

# Specific service
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml logs -f search"
```

### Restart Services

```bash
# Restart all
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml restart"

# Restart specific service
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml restart api"
```

### Stop Services

```bash
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml down"
```

### Update Deployment

```bash
# Pull latest code and redeploy
./scripts/deploy-hetzner.sh
```

## Server Management

### Power Management

```bash
# Stop server (stops billing)
hcloud server poweroff engram-kbrm

# Start server
hcloud server poweron engram-kbrm

# Reboot server
hcloud server reboot engram-kbrm
```

### Backups

```bash
# Create snapshot
hcloud server create-image engram-kbrm \
  --type snapshot \
  --description "backup-$(date +%Y%m%d)"

# List snapshots
hcloud image list --type snapshot
```

### Delete Server

```bash
# WARNING: This deletes everything
hcloud server delete engram-kbrm
```

## Service URLs

Once deployed, services are available at:

- **API**: http://<SERVER_IP>:8080
  - Health: http://<SERVER_IP>:8080/v1/health
  - Remember: POST http://<SERVER_IP>:8080/v1/memory/remember
  - Recall: POST http://<SERVER_IP>:8080/v1/memory/recall

- **Search**: http://<SERVER_IP>:5002
  - Health: http://<SERVER_IP>:5002/health
  - Search: POST http://<SERVER_IP>:5002/search
  - Metrics: http://<SERVER_IP>:5002/metrics

- **Tuner**: http://<SERVER_IP>:8000
  - Health: http://<SERVER_IP>:8000/api/v1/health
  - API Docs: http://<SERVER_IP>:8000/docs

## Data Persistence

All data is stored in bind mounts under `/opt/engram/data/`:

```
/opt/engram/data/
├── redpanda/    # Kafka event logs
├── qdrant/      # Vector embeddings
├── falkordb/    # Graph database
└── postgres/    # API keys and Optuna studies
```

To backup data:
```bash
ssh engram@$SERVER_IP "cd /opt/engram && tar czf backup-$(date +%Y%m%d).tar.gz data/"
scp engram@$SERVER_IP:/opt/engram/backup-*.tar.gz ./backups/
```

## Monitoring

### Health Checks

All services have health checks configured. View health status:

```bash
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml ps"
```

Healthy services will show "(healthy)" in the status column.

### Resource Usage

```bash
# Container stats
ssh engram@$SERVER_IP "docker stats"

# Disk usage
ssh engram@$SERVER_IP "df -h /opt/engram/data"

# Server metrics
ssh engram@$SERVER_IP "htop"
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml logs <service>"

# Restart service
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml restart <service>"

# Rebuild and restart
ssh engram@$SERVER_IP "cd /opt/engram && docker compose -f docker-compose.prod.yml up -d --build <service>"
```

### Database Issues

```bash
# Connect to Postgres
ssh engram@$SERVER_IP "docker exec -it engram-postgres-1 psql -U engram"

# Connect to FalkorDB
ssh engram@$SERVER_IP "docker exec -it engram-falkordb-1 redis-cli"

# Query Qdrant
ssh engram@$SERVER_IP "curl http://localhost:6333/collections"
```

### Disk Space

```bash
# Clean up old images
ssh engram@$SERVER_IP "docker system prune -a"

# Check data directories
ssh engram@$SERVER_IP "du -sh /opt/engram/data/*"
```

### Network Issues

```bash
# Check if ports are listening
ssh engram@$SERVER_IP "netstat -tlnp | grep -E '8080|5002|8000'"

# Test service connectivity
ssh engram@$SERVER_IP "curl http://localhost:8080/v1/health"
ssh engram@$SERVER_IP "curl http://localhost:5002/health"
ssh engram@$SERVER_IP "curl http://localhost:8000/api/v1/health"
```

## Cost Optimization

### Stop When Not Using

```bash
# Stop server (hourly billing stops)
hcloud server poweroff engram-kbrm

# Start when needed
hcloud server poweron engram-kbrm
```

### Snapshot and Delete

```bash
# Create snapshot
hcloud server create-image engram-kbrm --type snapshot --description "working-state"

# Delete server (stops all billing)
hcloud server delete engram-kbrm

# Restore from snapshot later
hcloud server create \
  --name engram-kbrm \
  --type cpx31 \
  --image <snapshot-id> \
  --location ash
```

## Security

### Firewall Rules

The server is configured with UFW allowing:
- SSH (22)
- HTTP (80)
- HTTPS (443)
- API (8080)
- Search (5002)
- Tuner (8000)

### Database Passwords

Change the default PostgreSQL password in `.env`:
```bash
POSTGRES_PASSWORD=<strong-random-password>
```

### SSH Access

Only key-based authentication is allowed. Disable password authentication:
```bash
ssh engram@$SERVER_IP
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

## References

- [Hetzner Cloud Console](https://console.hetzner.cloud)
- [hcloud CLI Documentation](https://github.com/hetznercloud/cli)
- [Docker Compose Reference](https://docs.docker.com/compose/)
- [Hugging Face Inference API](https://huggingface.co/docs/api-inference/index)

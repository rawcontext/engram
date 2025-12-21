# Hetzner Deployment Quick Start

Minimal steps to deploy Engram to Hetzner Cloud.

## One-Time Setup (5 minutes)

```bash
# 1. Install hcloud CLI
brew install hcloud  # macOS
# or see docs/deployment/hetzner-deployment.md for Linux

# 2. Get Hetzner API token from https://console.hetzner.cloud
hcloud context create engram
# Paste API token when prompted

# 3. Create and upload SSH key
ssh-keygen -t ed25519 -C "engram-server"
hcloud ssh-key create --name engram-key --public-key-from-file ~/.ssh/id_ed25519.pub

# 4. Create server
hcloud server create \
  --name engram-kbrm \
  --type cpx31 \
  --image ubuntu-24.04 \
  --location ash \
  --ssh-key engram-key

# 5. Configure server
hcloud server ssh engram-kbrm

# On server:
adduser engram
usermod -aG sudo engram
cp -r ~/.ssh /home/engram/
chown -R engram:engram /home/engram/.ssh

# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker engram
apt install docker-compose-plugin

# Create app directory
sudo mkdir -p /opt/engram
sudo chown -R engram:engram /opt/engram

# Configure firewall
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8080/tcp
ufw allow 5002/tcp
ufw allow 8000/tcp
ufw enable

# Reboot
reboot
# Exit and wait for reboot

# 6. Configure environment
cp .env.prod.example .env
# Edit .env:
#   - Set POSTGRES_PASSWORD
#   - Set HF_API_TOKEN (from https://huggingface.co/settings/tokens)
```

## Deploy

```bash
./scripts/deploy-hetzner.sh
```

Done! Services are now running at:
- API: http://<SERVER_IP>:8080
- Search: http://<SERVER_IP>:5002
- Tuner: http://<SERVER_IP>:8000

## Daily Commands

```bash
# Get server IP
hcloud server ip engram-kbrm

# Deploy updates
./scripts/deploy-hetzner.sh

# View logs
ssh engram@$(hcloud server ip engram-kbrm) "cd /opt/engram && docker compose -f docker-compose.prod.yml logs -f"

# Check status
ssh engram@$(hcloud server ip engram-kbrm) "cd /opt/engram && docker compose -f docker-compose.prod.yml ps"

# Stop server (saves money when not using)
hcloud server poweroff engram-kbrm

# Start server
hcloud server poweron engram-kbrm

# Delete server (full cleanup)
hcloud server delete engram-kbrm
```

## Troubleshooting

```bash
# Service won't start?
ssh engram@$(hcloud server ip engram-kbrm) "cd /opt/engram && docker compose -f docker-compose.prod.yml logs <service>"

# Restart a service
ssh engram@$(hcloud server ip engram-kbrm) "cd /opt/engram && docker compose -f docker-compose.prod.yml restart <service>"

# Full rebuild
ssh engram@$(hcloud server ip engram-kbrm) "cd /opt/engram && docker compose -f docker-compose.prod.yml up -d --build"

# Check health
curl http://$(hcloud server ip engram-kbrm):8080/v1/health
curl http://$(hcloud server ip engram-kbrm):5002/health
curl http://$(hcloud server ip engram-kbrm):8000/api/v1/health
```

## Cost

- **CPX31**: $18.59/month (hourly billing)
- **Hugging Face**: Free tier
- **Total**: ~$18.59/month

Stop server when not using to save money:
```bash
hcloud server poweroff engram-kbrm  # Stops billing
hcloud server poweron engram-kbrm   # Resumes billing
```

## Full Documentation

See [docs/deployment/hetzner-deployment.md](./hetzner-deployment.md) for complete details.

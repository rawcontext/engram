# Deployment Files

Files created for Hetzner production deployment.

## Core Files

### docker-compose.prod.yml
Production Docker Compose configuration for Hetzner deployment.

**Location**: `/docker-compose.prod.yml`

**Services**:
- **Databases**: redpanda, qdrant, falkordb, postgres
- **Applications**: ingestion, memory, search, api, tuner

**Key Features**:
- Bind mounts for data persistence (`./data/*`)
- Environment variables from `.env` file
- Health checks for all services
- `restart: unless-stopped` for resilience
- No source code mounts (uses built images)
- Only exposes necessary ports (8080, 5002, 8000)

**Differences from dev**:
- Uses production Dockerfiles (not Dockerfile.dev)
- No source code volume mounts
- Data stored in `./data/` directory
- Environment variables from `.env` file
- Limited port exposure for security

### .env.prod.example
Environment variable template for production.

**Location**: `/.env.prod.example`

**Required Variables**:
- `POSTGRES_PASSWORD` - PostgreSQL password (required)
- `HF_API_TOKEN` - Hugging Face API token (required for embeddings)

**Optional Variables**:
- `POSTGRES_USER` - PostgreSQL user (default: engram)
- `POSTGRES_DB` - PostgreSQL database (default: postgres)
- `EMBEDDER_BACKEND` - Embedder backend (default: huggingface)
- `QDRANT_COLLECTION` - Qdrant collection name (default: engram_memory)
- `CORS_ORIGINS` - CORS allowed origins

**Usage**:
```bash
cp .env.prod.example .env
# Edit .env and set required variables
```

## Deployment Scripts

### scripts/deploy-hetzner.sh
Automated deployment script.

**Location**: `/scripts/deploy-hetzner.sh`

**What it does**:
1. Checks for hcloud CLI
2. Gets server IP from `hcloud server ip engram-kbrm`
3. Validates .env file exists
4. Syncs codebase to server via rsync
5. Creates data directories on server
6. Pulls Docker images
7. Builds application images
8. Starts all services
9. Shows service status

**Usage**:
```bash
./scripts/deploy-hetzner.sh
```

**Prerequisites**:
- hcloud CLI installed and configured
- Server `engram-kbrm` created
- `.env` file configured
- SSH access to server as `engram` user

## Documentation

### docs/deployment/hetzner-deployment.md
Comprehensive deployment guide.

**Location**: `/docs/deployment/hetzner-deployment.md`

**Sections**:
- Prerequisites (hcloud CLI, API token, SSH keys)
- Server setup (create server, initial config)
- Environment configuration
- Deployment (automated and manual)
- Service management (status, logs, restart)
- Server management (power, backups, delete)
- Service URLs and endpoints
- Data persistence and backups
- Monitoring and health checks
- Troubleshooting
- Cost optimization
- Security

### docs/deployment/QUICKSTART.md
Minimal quick start guide.

**Location**: `/docs/deployment/QUICKSTART.md`

**Contents**:
- One-time setup (5 minutes)
- Deploy command
- Daily commands
- Troubleshooting basics
- Cost information

**Use Case**: For users who just want to get running quickly without reading the full documentation.

## File Structure

```
/
├── docker-compose.prod.yml          # Production Docker Compose
├── .env.prod.example                # Environment template
├── scripts/
│   └── deploy-hetzner.sh           # Deployment automation
└── docs/
    └── deployment/
        ├── hetzner-deployment.md   # Full guide
        ├── QUICKSTART.md           # Quick start
        └── FILES.md                # This file
```

## Server Directory Structure

On the Hetzner server, files are organized as:

```
/opt/engram/
├── docker-compose.prod.yml
├── .env
├── apps/
│   ├── api/
│   ├── ingestion/
│   ├── memory/
│   ├── search/
│   └── tuner/
├── packages/
│   └── ... (all packages)
└── data/                            # Persistent data
    ├── redpanda/                    # Kafka event logs
    ├── qdrant/                      # Vector embeddings
    ├── falkordb/                    # Graph database
    └── postgres/                    # API keys and Optuna
```

## Validation

All files have been validated:

```bash
# Docker Compose syntax
docker compose -f docker-compose.prod.yml config --quiet
# ✓ Valid

# Deployment script
bash -n scripts/deploy-hetzner.sh
# ✓ Valid

# Markdown
markdownlint docs/deployment/*.md
# ✓ No issues
```

## Next Steps

1. **First-time deployment**:
   - Follow [QUICKSTART.md](./QUICKSTART.md) for minimal setup
   - Or follow [hetzner-deployment.md](./hetzner-deployment.md) for detailed guide

2. **Update deployment**:
   - Run `./scripts/deploy-hetzner.sh`

3. **Troubleshooting**:
   - See troubleshooting section in [hetzner-deployment.md](./hetzner-deployment.md)

## References

- [Hetzner Cloud Docs](https://docs.hetzner.com/cloud/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Hugging Face Inference API](https://huggingface.co/docs/api-inference/)

# @engram/infra

Infrastructure-as-Code using OpenTofu for Hetzner Cloud deployment.

## Overview

Manages Engram's production infrastructure on Hetzner Cloud with DNS via Vercel. All services run on a single Hetzner server using Docker Compose.

## Prerequisites

- [OpenTofu](https://opentofu.org/docs/intro/install/) (>= 1.8.0)
- [hcloud CLI](https://github.com/hetznercloud/cli) (optional, for manual management)

## Quick Start

```bash
cd packages/infra

# Initialize OpenTofu (first time only)
tofu init -backend-config="conn_str=$TOFU_PG_CONN_STR"

# Preview changes
bun run plan

# Apply changes
bun run up

# View outputs
bun run output
```

## Infrastructure Components

### Hetzner Cloud Server

- **Type:** `cpx31` (4 vCPU, 8GB RAM, 80GB SSD)
- **Location:** Ashburn, VA (configurable)
- **OS:** Ubuntu 24.04
- **User:** `engram` with passwordless sudo

**Cloud-init provisioning:**
- Docker and Docker Compose v2
- UFW firewall configured
- Application directory at `/opt/engram`

### DNS (Vercel)

**Domain:** Configured via `TF_VAR_domain`

| Subdomain | Service | Port |
|-----------|---------|------|
| api.example.com | API | 8080 |
| search.example.com | Search | 5002 |
| tuner.example.com | Tuner | 8000 |
| observatory.example.com | Observatory | 5000 |

### Firewall Rules

Both Hetzner Cloud firewall and UFW are configured:

| Port | Service |
|------|---------|
| 22 | SSH |
| 80 | HTTP |
| 443 | HTTPS |
| 8080 | API |
| 5002 | Search |
| 8000 | Tuner |
| 5000 | Observatory |

## Configuration

### Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `hcloud_token` | Yes | - | Hetzner Cloud API token |
| `vercel_api_token` | Yes | - | Vercel API token for DNS |
| `vercel_team_id` | No | - | Vercel team ID |
| `server_name` | No | `engram` | Server hostname |
| `server_type` | No | `cpx31` | Hetzner server type |
| `location` | No | `ash` | Datacenter location |
| `domain` | **Yes** | - | Domain for DNS records |

### State Backend

Uses PostgreSQL for remote state storage:

```bash
# Initialize with PostgreSQL backend
tofu init -backend-config="conn_str=postgres://user:pass@host:5432/dbname?sslmode=require"
```

## GitHub Actions CI/CD

### Required Secrets

Configure these in GitHub repository settings:

#### Infrastructure Secrets
| Secret | Description |
|--------|-------------|
| `HCLOUD_TOKEN` | Hetzner Cloud API token |
| `VERCEL_API_TOKEN` | Vercel API token |
| `VERCEL_TEAM_ID` | Vercel team ID (optional) |
| `TOFU_PG_CONN_STR` | PostgreSQL connection string for OpenTofu state |
| `HETZNER_SERVER_IP` | Server IP address |
| `HETZNER_SSH_PRIVATE_KEY` | SSH private key for deployment |

#### Application Secrets
| Secret | Description |
|--------|-------------|
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | PostgreSQL database name |
| `QDRANT_COLLECTION` | Qdrant collection name |
| `QDRANT_TURNS_COLLECTION` | Qdrant turns collection |
| `HF_API_TOKEN` | Hugging Face API token |

#### CI Secrets (optional)
| Secret | Description |
|--------|-------------|
| `TURBO_TOKEN` | Turbo remote cache token |
| `TURBO_TEAM` | Turbo team ID |
| `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | Cache signing key |

### Required Variables

Configure these in GitHub repository settings:

| Variable | Example | Description |
|----------|---------|-------------|
| `EMBEDDER_BACKEND` | `huggingface` | Embedder backend |
| `EMBEDDER_DEVICE` | `cpu` | Device for embeddings |
| `EMBEDDER_TEXT_MODEL` | `BAAI/bge-small-en-v1.5` | Text embedding model |
| `SEARCH_DEFAULT_STRATEGY` | `dense` | Default search strategy |
| `CORS_ORIGINS` | `["https://observatory.example.com"]` | CORS origins |

### Smart Deployments

The CI/CD pipeline automatically detects which services changed:

- **Infrastructure changes** (`packages/infra/**`) → OpenTofu apply
- **API changes** (`apps/api/**`, `packages/{common,logger,events,storage,graph}/**`) → Deploy API
- **Search changes** (`apps/search/**`) → Deploy Search
- **Tuner changes** (`apps/tuner/**`) → Deploy Tuner
- **Observatory changes** (`apps/observatory/**`) → Deploy Observatory
- **Ingestion changes** (`apps/ingestion/**`, `packages/{common,logger,events,storage,parser}/**`) → Deploy Ingestion
- **Memory changes** (`apps/memory/**`, `packages/{common,logger,events,storage,graph}/**`) → Deploy Memory

Only changed services are rebuilt and redeployed.

### Manual Deployment

Use workflow dispatch to force deployments:

```bash
# Via GitHub CLI
gh workflow run deploy.yml -f force_deploy_all=true

# Force infrastructure only
gh workflow run deploy.yml -f force_infra=true
```

## NPM Scripts

```bash
bun run init      # tofu init
bun run validate  # tofu validate
bun run fmt       # tofu fmt -recursive
bun run plan      # tofu plan
bun run up        # tofu apply -auto-approve
bun run down      # tofu destroy -auto-approve
bun run output    # tofu output
bun run state     # tofu state list
```

## Outputs

| Output | Description |
|--------|-------------|
| `server_id` | Hetzner server ID |
| `server_ip` | Public IPv4 address |
| `server_ipv6` | Public IPv6 address |
| `server_status` | Server status |
| `ssh_command` | SSH command to connect |
| `deploy_command` | Deploy script path |
| `api_url` | API service URL |
| `search_url` | Search service URL |
| `tuner_url` | Tuner service URL |
| `observatory_url` | Observatory UI URL |

## File Structure

```
packages/infra/
├── backend.tf      # PostgreSQL state backend
├── dns.tf          # Vercel DNS records
├── firewall.tf     # Hetzner Cloud firewall
├── outputs.tf      # Terraform outputs
├── providers.tf    # Provider configuration
├── server.tf       # Hetzner server + cloud-init
├── ssh.tf          # SSH key management
├── variables.tf    # Input variables
├── versions.tf     # Provider versions
├── tests/          # OpenTofu tests
├── package.json    # NPM scripts
└── README.md       # This file
```

## Manual Server Access

```bash
# SSH to server
ssh engram@$(tofu output -raw server_ip)

# Or use the output command
$(tofu output -raw ssh_command)

# View service logs
ssh engram@IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml logs -f'

# Restart all services
ssh engram@IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml restart'

# View service status
ssh engram@IP 'cd /opt/engram && docker compose -f docker-compose.prod.yml ps'
```

## Importing Existing Resources

If you have existing resources to import:

```bash
# Import existing server
bun run import:server

# Import existing SSH key
bun run import:ssh

# Import DNS records (get IDs from Vercel)
tofu import vercel_dns_record.api rec_xxxxx
tofu import vercel_dns_record.search rec_xxxxx
tofu import vercel_dns_record.tuner rec_xxxxx
tofu import vercel_dns_record.observatory rec_xxxxx
```

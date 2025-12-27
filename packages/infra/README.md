# @engram/infra

Infrastructure-as-Code using OpenTofu for Hetzner Cloud deployment.

## Purpose

Manages Engram's production infrastructure on Hetzner Cloud with DNS via Vercel. All services run on a single Hetzner server with Caddy reverse proxy, deployed via Docker Compose.

## Infrastructure Resources

### Hetzner Cloud
- **Server**: `cpx31` (4 vCPU, 8GB RAM, 80GB SSD) in Ashburn, VA
- **OS**: Ubuntu 24.04 with Docker, Docker Compose v2, UFW firewall
- **User**: `engram` with passwordless sudo
- **Firewall**: SSH (22), HTTP (80), HTTPS (443), ICMP

### Vercel DNS
- **apex**: Points to Hetzner server IPv4
- **api**: API gateway (Caddy routes to backend services)
- **observatory**: Neural Observatory UI

### State Backend
- HTTP backend via Engram API (`/v1/tofu` endpoint)
- Requires API key with `state:write` scope

## Quick Start

```bash
cd packages/infra

# Set required environment variables
export TF_HTTP_USERNAME="tofu" TF_HTTP_PASSWORD="your-api-key"
export TF_VAR_domain="example.com" TF_VAR_hcloud_token="..." TF_VAR_vercel_api_token="..." TF_VAR_ssh_public_key="ssh-ed25519 ..."

# Initialize, plan, and apply
tofu init -backend-config="address=https://api.${TF_VAR_domain}/v1/tofu"
bun run plan && bun run up
```

## Required Variables

| Variable | Description |
|----------|-------------|
| `hcloud_token` | Hetzner Cloud API token |
| `vercel_api_token` | Vercel API token for DNS |
| `ssh_public_key` | SSH public key content |
| `domain` | Base domain (e.g., `example.com`) |

Optional: `vercel_team_id`, `server_name` (default: `engram`), `server_type` (default: `cpx31`), `location` (default: `ash`)

## Available Commands

```bash
bun run init      # Initialize OpenTofu
bun run validate  # Validate configuration
bun run fmt       # Format .tf files
bun run plan      # Preview changes
bun run up        # Apply changes (auto-approve)
bun run down      # Destroy infrastructure (auto-approve)
bun run output    # Show outputs
bun run state     # List state resources
bun run test      # Run OpenTofu tests
```

## Outputs

| Output | Description |
|--------|-------------|
| `server_ip` | Public IPv4 address |
| `ssh_command` | SSH connection command |
| `api_url` | API gateway URL |
| `observatory_url` | Observatory UI URL |

## Deployment

Caddy handles TLS termination and reverse proxying:
- `api.{domain}` → API gateway with path-based routing
- `api.{domain}/v1/search` → Search service
- `api.{domain}/v1/tuner` → Tuner service
- `observatory.{domain}` → Observatory frontend

Services are deployed via `docker-compose.prod.yml` in `/opt/engram` on the server.

## File Structure

```
packages/infra/
├── backend.tf      # HTTP state backend
├── dns.tf          # Vercel DNS records
├── firewall.tf     # Hetzner Cloud firewall
├── outputs.tf      # Output values
├── providers.tf    # Hetzner + Vercel providers
├── server.tf       # Server + cloud-init
├── ssh.tf          # SSH key resource
├── variables.tf    # Input variables
├── versions.tf     # Provider versions
└── tests/          # OpenTofu tests
```

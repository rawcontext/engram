# Bead: Create Development Environment Setup (Skaffold/Compose)

## Context
Developers need a one-command setup to run the entire "Soul" locally on macOS.

## Goal
Create a `docker-compose.yml` for dependencies and a `Turborepo` dev command for services.

## Strategy
1.  **Dependencies**: Use `docker-compose` to run Redpanda, FalkorDB, and Qdrant.
2.  **Services**: Run apps directly on host via `bun run dev` (Turborepo parallel execution) to utilize hot-reloading. Running apps in Docker locally is often too slow for dev cycles.

## `docker-compose.dev.yml`
```yaml
version: '3.8'
services:
  redpanda:
    image: docker.redpanda.com/redpandadata/redpanda:v23.3.1
    # ... config from Redpanda Bead ...
  falkordb:
    image: falkordb/falkordb:latest
    # ... config from Falkor Bead ...
  qdrant:
    image: qdrant/qdrant:latest
    # ... config from Qdrant Bead ...
```

## `package.json` Scripts
```json
{
  "scripts": {
    "infra:up": "docker-compose -f docker-compose.dev.yml up -d",
    "infra:down": "docker-compose -f docker-compose.dev.yml down",
    "dev": "turbo run dev"
  }
}
```

## Acceptance Criteria
-   [ ] `docker-compose.dev.yml` created in root.
-   [ ] `README.md` updated with "Getting Started" instructions:
    1.  `bun install`
    2.  `bun run infra:up`
    3.  `bun run dev`

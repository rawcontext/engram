# Bead: Define FalkorDB Project Structure

## Context
**Bitemporal Memory** is a service that manages the "Soul's" knowledge graph. It wraps FalkorDB (a Redis-compatible Graph module) to provide a bitemporal abstraction.

## Goal
Set up the TypeScript project structure for the `apps/memory` service and `packages/memory-core` library within the Turborepo.

## Structure

```text
packages/memory-core/
├── src/
│   ├── client/             # Low-level Redis/Falkor client
│   ├── models/             # Zod schemas for Nodes/Edges
│   ├── queries/            # Bitemporal Cypher Query Builders
│   ├── graphiti.ts         # Main Orchestrator Class
│   └── utils/
│       ├── time.ts         # Valid/Transaction Time Helpers
│       └── ids.ts          # ULID/UUID generators
├── package.json
└── tsconfig.json

apps/memory/
├── src/
│   ├── consumers/          # Redpanda Consumers (ParsedEvents)
│   ├── processors/         # Event -> Graph Logic
│   └── api/                # Internal RPC/REST for other services
├── package.json
└── Dockerfile
```

## Dependencies
-   `redis`: The standard Node.js Redis client (supports modules via `call` method).
-   `zod`: For schema validation.
-   `ulid`: For time-sortable unique IDs.
-   `date-fns`: For timestamp manipulation.

## Acceptance Criteria
-   [ ] `packages/memory-core` initialized.
-   [ ] `apps/memory` initialized.
-   [ ] `redis` client instantiated with FalkorDB module check.

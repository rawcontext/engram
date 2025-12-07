# Bead: Define Monorepo Structure (Turborepo)

## Context
The **System Infrastructure** context lays the groundwork for the entire "Soul" project. We will use a Monorepo architecture to manage the distinct Bounded Contexts (Ingestion, Memory, Control, etc.) as separate packages/apps while sharing common libraries (Types, Utilities).

## Goal
Establish a Turborepo v2.6.3 workspace structure that isolates concerns, enables caching, and supports both local development and GCP deployment.

## Research & Rationale
-   **Turborepo v2.6.3**: Chosen for its high-performance caching and recent stability improvements with `bun`.
-   **Package Manager**: `bun` (v1.1+) is selected for speed and native TypeScript support, aligning with the "System" project's preference for modern tooling.
-   **Structure**:
    -   `apps/`: Deployable services (Cloud Run).
    -   `packages/`: Shared logic (Schemas, Clients, UI Components).
    -   `tooling/`: DevOps scripts, shared configs (ESLint, TSConfig).

## Folder Structure

```text
/
├── .github/                # GitHub Actions (CI/CD triggers)
├── apps/
│   ├── ingestion/          # Cognitive Ingestion Service
│   ├── memory/             # Bitemporal Memory Service
│   ├── search/             # Semantic Search Service
│   ├── execution/          # Deterministic Execution Service
│   ├── control/            # Agent Control Service
│   └── interface/          # Observability Interface (Next.js)
├── packages/
│   ├── events/             # Shared Event Schemas (Zod/JSON Schema)
│   ├── logger/             # Structured Logging Wrapper (Pino/Google Cloud)
│   ├── storage/            # Database Clients (Falkor, Qdrant, Redpanda)
│   └── tsconfig/           # Shared TypeScript Configurations
├── tooling/
│   └── eslint-config/      # Shared Linting Rules
├── turbo.json              # Turborepo Pipeline Config
├── package.json            # Root Config
└── bun.lockb               # Lockfile
```

## Configuration (turbo.json)

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "lint": {},
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "outputs": ["coverage/**"]
    }
  }
}
```

## Acceptance Criteria
-   [ ] `turbo.json` created with the schema above.
-   [ ] `apps/` and `packages/` directories initialized.
-   [ ] `bun` workspace configured in root `package.json`.
-   [ ] `bun install` runs successfully without conflicts.

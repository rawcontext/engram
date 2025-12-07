# Bead: Define API Route Structure (Next.js)

## Context
The **Observability Interface** is a Next.js application that provides visibility into the "Soul". It needs a structured API to communicate with the internal services (Memory, Search, Execution).

## Goal
Establish the Next.js App Router structure for the API layer.

## Structure
```text
apps/interface/
├── app/
│   ├── api/
│   │   ├── ingest/         # POST: Webhook for raw events (dev testing)
│   │   ├── search/         # POST: Hybrid Search Proxy
│   │   ├── graph/          # POST: Cypher Query Proxy
│   │   ├── lineage/        # GET: Fetch event history for a session
│   │   ├── replay/         # POST: Trigger deterministic replay
│   │   ├── sse/            # GET: Real-time event stream (Redpanda -> Browser)
│   │   └── auth/           # [...nextauth] or Clerk
│   └── ...pages
```

## Acceptance Criteria
-   [ ] `apps/interface` initialized as a Next.js (TypeScript) project.
-   [ ] Route handlers stubbed out.

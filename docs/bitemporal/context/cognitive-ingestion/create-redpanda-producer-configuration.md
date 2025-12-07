# Bead: Create Redpanda Producer Configuration

## Context
The Ingestion Service needs to publish `RawStreamEvent` and `ParsedStreamEvent` to Redpanda.

## Goal
Configure `kafkajs` (or `bun-kafka` if stable, but `kafkajs` is safer) for the Ingestion app.

## Research & Rationale
-   **Bun Compatibility**: `kafkajs` works with Bun but might have issues with `ssl`. We should test. If `kafkajs` fails, we can use a small Go/Rust sidecar or `redpanda-connect`. *Assumption: kafkajs works.*
-   **Settings**:
    -   `clientId`: `ingestion-service`
    -   `brokers`: `['redpanda:9092']` (internal K8s DNS)

## Implementation
```typescript
import { Kafka } from 'kafkajs';

export const kafka = new Kafka({
  clientId: 'ingestion-service',
  brokers: (process.env.REDPANDA_BROKERS || 'localhost:9092').split(','),
  // SSL config if needed for Cloud
});

export const producer = kafka.producer({
  idempotent: true, // Important for exactly-once semantics
});
```

## Acceptance Criteria
-   [ ] `packages/storage/src/kafka.ts` created.
-   [ ] Producer initialized with idempotency.
-   [ ] Connection retry logic configured.

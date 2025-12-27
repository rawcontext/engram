# @engram/storage

Unified storage client layer for Engram's infrastructure backends: FalkorDB (graph), NATS JetStream (messaging), PostgreSQL (relational), Redis (caching), and blob storage (GCS/filesystem).

## Purpose

Decouples application code from concrete storage implementations through clean interfaces. Enables dependency injection, testing, and production deployment without vendor lock-in.

## Clients

### FalkorDB (Graph Database)

Typed Cypher query client for bitemporal graph storage.

```typescript
import { createFalkorClient } from "@engram/storage/falkor";

const client = createFalkorClient(); // Reads FALKORDB_URL env var
await client.connect();

const results = await client.query<{ s: FalkorNode }>(
  "MATCH (s:Session) WHERE s.id = $id RETURN s",
  { id: "session-123" }
);

await client.disconnect();
```

### NATS JetStream (Message Queue)

Event streaming with JetStream durability and Kafka-compatible API.

```typescript
import { createNatsClient } from "@engram/storage/nats";

const nats = createNatsClient(); // Reads NATS_URL env var

// Producer
const producer = await nats.getProducer();
await producer.send({
  topic: "parsed_events",
  messages: [{ key: "session-123", value: JSON.stringify(event) }]
});

// Consumer
const consumer = await nats.getConsumer({ groupId: "memory-group" });
await consumer.subscribe({ topic: "parsed_events" });
await consumer.run({
  eachMessage: async ({ message }) => console.log(message.value.toString())
});
```

**Streams**: EVENTS, MEMORY, DLQ
**Topic Mappings**: `raw_events` → `events.raw`, `parsed_events` → `events.parsed`

### NATS Core Pub/Sub (Real-time Updates)

Ephemeral pub/sub for WebSocket updates and consumer heartbeats.

```typescript
import { createNatsPubSubPublisher, createNatsPubSubSubscriber } from "@engram/storage/nats";

const pub = createNatsPubSubPublisher();
await pub.publishSessionUpdate("session-123", { type: "node_created", data: {} });

const sub = createNatsPubSubSubscriber();
await sub.subscribe("session-123", (msg) => console.log(msg));
```

### PostgreSQL (Relational Database)

Connection pooling with typed queries and transaction support.

```typescript
import { PostgresClient } from "@engram/storage/postgres";

const pg = new PostgresClient({ url: process.env.DATABASE_URL! });
await pg.connect();

const users = await pg.queryMany<{ id: string }>("SELECT id FROM users");
await pg.transaction(async (client) => {
  await client.query("INSERT INTO users ...");
});
```

### Blob Storage

Content-addressed storage with SHA-256 deduplication (filesystem or GCS).

```typescript
import { createBlobStore } from "@engram/storage/blob";

const store = createBlobStore("fs"); // or "gcs"
const uri = await store.save("Large content..."); // file://{hash} or gs://{bucket}/{hash}
const content = await store.load(uri);
```

**Env Vars**: `BLOB_STORAGE_PATH`, `GCS_BUCKET`

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `FALKORDB_URL` | FalkorDB connection | `redis://localhost:6179` |
| `NATS_URL` | NATS server | `nats://localhost:6181` |
| `DATABASE_URL` | PostgreSQL connection | - |
| `BLOB_STORAGE_PATH` | Filesystem blob path | `./data/blobs` |
| `GCS_BUCKET` | GCS bucket name | `engram-blobs` |

## Architecture

**Data Flow**: External Agent → Ingestion → NATS → Memory → FalkorDB → Search → Qdrant
**Key Patterns**: Lazy initialization, connection pooling, typed queries, bitemporal graph nodes

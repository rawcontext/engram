# @engram/storage

Unified storage client layer for Engram's infrastructure backends. Provides clean abstractions for FalkorDB (graph), Kafka/Redpanda (messaging), PostgreSQL (relational), Redis (pub/sub), and blob storage (GCS/filesystem).

## Overview

This package decouples application code from concrete storage implementations through well-defined interfaces. All implementations are designed for dependency injection, testing, and production use.

## Installation

```bash
npm install @engram/storage
```

## Storage Clients

### FalkorDB (Graph Database)

Graph database client built on FalkorDB with typed Cypher query support.

```typescript
import { createFalkorClient, type FalkorNode, type FalkorEdge } from "@engram/storage/falkor";

// Create client (reads FALKORDB_URL env var)
const client = createFalkorClient();
await client.connect();

// Execute typed queries
interface SessionRow { s: FalkorNode<{ id: string; title: string }> }
const results = await client.query<SessionRow>(
  "MATCH (s:Session) WHERE s.id = $id RETURN s",
  { id: "session-123" }
);

// Access typed properties
const session = results[0].s.properties; // { id: string; title: string }

await client.disconnect();
```

**Environment Variables:**
- `FALKORDB_URL`: Redis connection URL (default: `redis://localhost:6379`)

**Key Types:**
- `FalkorNode<T>`: Graph node with typed properties
- `FalkorEdge<T>`: Graph edge/relationship with typed properties
- `QueryParams`: Cypher parameter types

### Kafka/Redpanda (Message Queue)

Message queue client using Confluent's Kafka JavaScript library with KafkaJS-compatible API.

```typescript
import { createKafkaClient } from "@engram/storage/kafka";

// Create client (reads REDPANDA_BROKERS env var)
const kafka = createKafkaClient("my-service");

// Get producer
const producer = await kafka.getProducer();
await producer.send({
  topic: "parsed_events",
  messages: [{ key: "session-123", value: JSON.stringify(event) }]
});

// Get consumer
const consumer = await kafka.getConsumer({ groupId: "memory-group" });
await consumer.subscribe({ topic: "parsed_events", fromBeginning: false });
await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const data = JSON.parse(message.value.toString());
    console.log(`Received message from ${topic}:`, data);
  }
});

// Cleanup
await kafka.disconnect();
```

**Environment Variables:**
- `REDPANDA_BROKERS`: Comma-separated broker list (default: `localhost:19092`)

**Key Features:**
- Automatic topic creation
- Session-based partition ordering (same key → same partition)
- Connection pooling and reuse
- KafkaJS-compatible API surface

### PostgreSQL (Relational Database)

PostgreSQL client with connection pooling and transaction support.

```typescript
import { PostgresClient } from "@engram/storage/postgres";

const postgres = new PostgresClient({ url: process.env.DATABASE_URL! });
await postgres.connect();

// Simple queries
const users = await postgres.queryMany<{ id: string; name: string }>(
  "SELECT id, name FROM users WHERE created_at > $1",
  [new Date("2025-01-01")]
);

// Single row query
const user = await postgres.queryOne<{ id: string }>(
  "SELECT id FROM users WHERE email = $1",
  ["user@example.com"]
);

// Transactions
await postgres.transaction(async (client) => {
  await client.query("INSERT INTO users (id, name) VALUES ($1, $2)", ["1", "Alice"]);
  await client.query("INSERT INTO profiles (user_id, bio) VALUES ($1, $2)", ["1", "..."]);
});

// Health checks
const healthy = await postgres.healthCheck();

await postgres.disconnect();
```

**Key Methods:**
- `query<T>()`: Execute query and return result
- `queryOne<T>()`: Execute query and return single row (or null)
- `queryMany<T>()`: Execute query and return all rows
- `transaction<T>()`: Execute multiple queries in a transaction
- `healthCheck()`: Verify connection health

### Redis (Pub/Sub)

Redis publisher/subscriber for real-time session updates and consumer status.

```typescript
import { createRedisPublisher, createRedisSubscriber } from "@engram/storage/redis";

// Publisher
const publisher = createRedisPublisher();

// Publish session-specific update
await publisher.publishSessionUpdate("session-123", {
  type: "node_created",
  data: { nodeId: "node-456" }
});

// Publish global session event
await publisher.publishGlobalSessionEvent("session_created", {
  id: "session-123",
  title: "New Session"
});

// Publish consumer status
await publisher.publishConsumerStatus("consumer_ready", "memory-group", "instance-1");

await publisher.disconnect();

// Subscriber
const subscriber = createRedisSubscriber();

// Subscribe to session-specific updates
const unsubscribe = await subscriber.subscribe("session-123", (message) => {
  console.log("Session update:", message);
});

// Subscribe to global session updates
await subscriber.subscribe("sessions:updates", (message) => {
  console.log("Global session event:", message);
});

// Subscribe to consumer status updates
await subscriber.subscribeToConsumerStatus((message) => {
  console.log("Consumer status:", message);
});

// Cleanup
await unsubscribe();
await subscriber.disconnect();
```

**Environment Variables:**
- `REDIS_URL`: Redis connection URL (required)

**Channels:**
- `session:{sessionId}:updates`: Session-specific updates
- `sessions:updates`: Global session events
- `consumers:status`: Consumer readiness/heartbeat events

### Blob Storage

Content-addressed storage with filesystem and Google Cloud Storage backends.

```typescript
import { createBlobStore } from "@engram/storage/blob";

// Local filesystem (default)
const fsStore = createBlobStore("fs");
const uri1 = await fsStore.save("Large content here...");
// Returns: file:///path/to/data/blobs/{sha256-hash}

// Google Cloud Storage
const gcsStore = createBlobStore("gcs");
const uri2 = await gcsStore.save("Large content here...");
// Returns: gs://bucket-name/{sha256-hash}

// Load content by URI
const content = await fsStore.load(uri1);
```

**Environment Variables:**
- `BLOB_STORAGE_PATH`: Filesystem storage directory (default: `./data/blobs`)
- `GCS_BUCKET`: GCS bucket name (default: `engram-blobs`)

**Key Features:**
- Content-addressable storage (SHA-256 hashing)
- Automatic deduplication
- Path traversal protection
- Lazy GCS client initialization

## Consumer Readiness

Utilities for checking Kafka consumer group readiness before starting producers.

```typescript
import { waitForConsumers, checkConsumerGroups } from "@engram/storage";

// Wait for consumers to be ready
const result = await waitForConsumers({
  groupIds: ["memory-group", "search-group", "control-group"],
  brokers: "localhost:19092",
  timeoutMs: 30000,
  pollIntervalMs: 2000,
  minMembers: 1,
  logger: console.log
});

if (result.success) {
  console.log("All consumers ready:", result.groups);
  // Start producing events
} else {
  console.error("Timeout waiting for consumers:", result.error);
}

// Check current status without waiting
const statuses = await checkConsumerGroups(
  ["memory-group", "search-group"],
  "localhost:19092"
);

for (const status of statuses) {
  console.log(`${status.groupId}: ${status.stateName} (${status.memberCount} members)`);
}
```

**Consumer States:**
- `STABLE`: Ready for message processing
- `PREPARING_REBALANCE`: Rebalancing in progress
- `COMPLETING_REBALANCE`: Rebalancing completing
- `EMPTY`: No members
- `DEAD`: Group deleted
- `UNKNOWN`: State unknown

## Type Exports

### Interfaces

```typescript
import type {
  GraphClient,
  MessageClient,
  Producer,
  Consumer,
  ConsumerConfig,
  BlobStore,
  RedisPublisher,
  KafkaMessage
} from "@engram/storage";
```

### FalkorDB Types

```typescript
import type {
  FalkorNode,
  FalkorEdge,
  FalkorResult,
  QueryParams
} from "@engram/storage/falkor";
```

### Redis Types

```typescript
import type {
  SessionUpdate,
  ConsumerStatusUpdate
} from "@engram/storage/redis";
```

### Consumer Readiness Types

```typescript
import type {
  ConsumerGroupStatus,
  ConsumerGroupState,
  WaitForConsumersConfig,
  WaitResult
} from "@engram/storage";
```

## Dependencies

- **FalkorDB**: `falkordb` (graph database client)
- **Kafka**: `@confluentinc/kafka-javascript` (message queue client)
- **PostgreSQL**: `pg` (relational database client)
- **Redis**: `redis` (pub/sub client)
- **Google Cloud Storage**: `@google-cloud/storage` (blob storage, optional)

## Architecture Notes

- All clients support lazy initialization and connection pooling
- Message ordering is guaranteed per-partition using message keys
- Blob storage uses SHA-256 content addressing for deduplication
- FalkorDB queries return typed results for compile-time safety
- Redis pub/sub supports both global and session-specific channels
- Consumer readiness checks prevent message loss during startup

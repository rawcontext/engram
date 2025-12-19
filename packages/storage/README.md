# @engram/storage

Unified interfaces and implementations for all storage backends.

## Overview

Decouples application code from infrastructure via clean interfaces, enabling easy swapping of storage backends and comprehensive dependency injection for testing.

## Installation

```bash
npm install @engram/storage
```

## Interfaces

### GraphClient

```typescript
import type { GraphClient } from "@engram/storage";

interface GraphClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}
```

### MessageClient

```typescript
import type { MessageClient, Producer, Consumer } from "@engram/storage";

interface Producer {
  send(topic: string, messages: Message[]): Promise<void>;
}

interface Consumer {
  subscribe(topics: string[]): Promise<void>;
  run(handler: MessageHandler): Promise<void>;
}
```

### BlobStore

```typescript
import type { BlobStore } from "@engram/storage";

interface BlobStore {
  save(content: Buffer): Promise<string>; // Returns content hash
  load(hash: string): Promise<Buffer>;
  exists(hash: string): Promise<boolean>;
}
```

### RedisPublisher

```typescript
import type { RedisPublisher } from "@engram/storage";

interface RedisPublisher {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: MessageHandler): Promise<void>;
}
```

## Implementations

### FalkorDB (Graph)

```typescript
import { createFalkorClient } from "@engram/storage/falkor";

const client = await createFalkorClient({
  url: "redis://localhost:6379",
  graph: "engram",
});

const results = await client.query(
  "MATCH (s:Session) RETURN s LIMIT 10"
);
```

### Kafka/Redpanda (Messaging)

```typescript
import { createKafkaClient } from "@engram/storage/kafka";

const kafka = createKafkaClient({
  brokers: ["localhost:19092"],
  clientId: "my-service",
});

const producer = kafka.producer();
await producer.send("events", [{ value: JSON.stringify(event) }]);

const consumer = kafka.consumer({ groupId: "my-group" });
await consumer.subscribe(["events"]);
await consumer.run(async (message) => {
  console.log(message.value);
});
```

### Blob Storage

```typescript
import { createBlobStore } from "@engram/storage/blob";

// Google Cloud Storage
const gcsStore = createBlobStore({
  type: "gcs",
  bucket: "my-bucket",
});

// Local filesystem
const fsStore = createBlobStore({
  type: "filesystem",
  directory: "./data",
});
```

### Redis

```typescript
import { createRedisClient } from "@engram/storage/redis";

const redis = await createRedisClient({
  url: "redis://localhost:6379",
});

await redis.publish("updates", JSON.stringify({ type: "event" }));
```

## Consumer Utilities

```typescript
import { checkConsumerReadiness } from "@engram/storage";

const ready = await checkConsumerReadiness(consumer, {
  timeout: 5000,
});
```

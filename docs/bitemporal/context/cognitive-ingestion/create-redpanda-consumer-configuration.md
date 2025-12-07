# Bead: Create Redpanda Consumer Configuration

## Context
Downstream services (Memory, Search) will consume the `parsed_events` topic.

## Goal
Create a shared consumer configuration factory.

## Implementation
```typescript
import { Kafka, Consumer } from 'kafkajs';

export const createConsumer = async (groupId: string): Promise<Consumer> => {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  return consumer;
};
```

## Acceptance Criteria
-   [ ] Shared consumer factory in `packages/storage`.
-   [ ] Default group ID naming convention established (`${service-name}-group`).

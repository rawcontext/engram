# Bead: Implement FalkorDB Connection Manager

## Context
We need a robust singleton connection to FalkorDB (Redis).

## Goal
Manage Redis connections, handle errors, and ensure the `graph` module is loaded.

## Implementation
```typescript
import { createClient } from 'redis';

export class FalkorClient {
  private client;
  private graphName = 'SoulGraph';

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', (err) => console.error('Redis Client Error', err));
  }

  async connect() {
    await this.client.connect();
    // Verify module
    const modules = await this.client.sendCommand(['MODULE', 'LIST']);
    // Check for 'graph' in modules
  }

  async query(cypher: string, params: any = {}) {
    return this.client.sendCommand(['GRAPH.QUERY', this.graphName, cypher, '--compact']);
    // Note: Parameter handling in raw Redis command requires specific formatting
  }
}
```

## Acceptance Criteria
-   [ ] Client implemented.
-   [ ] Connects to local Docker instance.
-   [ ] Helper method for executing parameterized Cypher queries.

# Bead: Define Hybrid Search Request Schema

## Context
Clients (Agent Control) need a standardized way to ask "Find me relevant stuff".

## Goal
Define the `SearchQuery` schema.

## Schema
```typescript
export interface SearchQuery {
  text: string;
  limit?: number;
  threshold?: number;
  filters?: {
    session_id?: string;
    type?: 'thought' | 'code';
    time_range?: { start: number; end: number };
  };
  strategy: 'hybrid' | 'dense' | 'sparse';
}
```

## Acceptance Criteria
-   [ ] Interface defined.

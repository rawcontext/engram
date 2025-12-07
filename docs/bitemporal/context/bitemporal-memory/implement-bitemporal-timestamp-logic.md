# Bead: Implement Bitemporal Timestamp Logic

## Context
To support "Time Travel" (what did we know *then*?) and "Correction" (oops, that fact was wrong, here is the new truth), we need four timestamps on every temporal node/edge.

## Goal
Define the standard interface and helper functions for Bitemporal timestamps.

## Research & Rationale
-   **Valid Time (`vt`)**: When the fact is true in the real world.
-   **Transaction Time (`tt`)**: When the system recorded it.
-   **Infinity**: We use `NULL` or a specific "Max Date" (e.g., `9999-12-31`) to represent "Current/Until Forever". *Decision: Use a specific Max Date integer for efficient range indexing in Redis/Cypher.*

## Schema Interface

```typescript
export interface Bitemporal {
  vt_start: number; // Epoch Milliseconds
  vt_end: number;   // Epoch Milliseconds (MaxDate if current)
  tt_start: number; // Epoch Milliseconds
  tt_end: number;   // Epoch Milliseconds (MaxDate if current)
}

export const MAX_DATE = 253402300799000; // 9999-12-31
```

## Logic
-   **Insert**: `vt_start` = event.timestamp, `vt_end` = MAX, `tt_start` = now(), `tt_end` = MAX.
-   **Update/Correct**:
    1.  Find old node.
    2.  Set old node `tt_end` = now().
    3.  Create new node with same `vt` but new content, `tt_start` = now(), `tt_end` = MAX.
-   **Delete**: Set `tt_end` = now().

## Acceptance Criteria
-   [ ] `Time` utility module created.
-   [ ] Constants for MAX_DATE defined.
-   [ ] Helper to generate "Now" in consistent UTC epoch.

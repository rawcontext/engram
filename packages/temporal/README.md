# @engram/temporal

Bitemporal state management and time-travel capabilities.

## Overview

Enables the system to query and reconstruct state at any historical point (valid time) and any point in transaction history (transaction time). Essential for debugging, auditing, and recovery.

## Installation

```bash
npm install @engram/temporal
```

## Core Components

### Rehydrator

Reconstructs session VFS state at any point in time from graph snapshots.

```typescript
import { Rehydrator } from "@engram/temporal";

const rehydrator = new Rehydrator(graphClient);

// Reconstruct file system state at a specific time
const vfs = await rehydrator.rehydrate({
  sessionId: "session-123",
  asOf: new Date("2024-01-15T10:00:00Z"),
});

// Access files as they existed at that time
const content = vfs.readFile("/src/index.ts");
```

### TimeTravelManager

Enables querying and replaying system state.

```typescript
import { TimeTravelManager } from "@engram/temporal";

const manager = new TimeTravelManager(graphClient);

// Query state at valid time
const state = await manager.queryAtValidTime({
  sessionId: "session-123",
  validTime: new Date("2024-01-15T10:00:00Z"),
});

// Query state at transaction time
const historicalView = await manager.queryAtTransactionTime({
  sessionId: "session-123",
  transactionTime: new Date("2024-01-16T12:00:00Z"),
});
```

### ReplayManager

Replay historical operations for debugging.

```typescript
import { ReplayManager } from "@engram/temporal";

const replay = new ReplayManager(graphClient);

// Replay all operations in a session
await replay.replaySession({
  sessionId: "session-123",
  fromTime: startTime,
  toTime: endTime,
  onOperation: (op) => console.log(op),
});
```

## Error Handling

```typescript
import { RehydrationError } from "@engram/temporal";

try {
  await rehydrator.rehydrate({ sessionId: "missing" });
} catch (err) {
  if (err instanceof RehydrationError) {
    console.error("Failed to rehydrate:", err.message);
  }
}
```

## Bitemporal Concepts

| Concept | Description |
|:--------|:------------|
| **Valid Time** | When the fact was true in the real world |
| **Transaction Time** | When we recorded the fact in the system |
| **As-Of Query** | What was true at a given valid time? |
| **As-Known Query** | What did we know at a given transaction time? |

## Use Cases

- **Debugging**: See exact file state when a bug was introduced
- **Auditing**: Review what the system knew at any point
- **Recovery**: Restore state from before an error
- **Analysis**: Compare state across time periods

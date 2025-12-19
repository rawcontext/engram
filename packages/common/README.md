# @engram/common

Shared utilities, errors, and constants for the Engram system.

## Overview

Foundation package that eliminates code duplication and provides consistent error handling across all Engram packages and applications.

## Installation

```bash
npm install @engram/common
```

## Exports

### Utilities

```typescript
import {
  envStr,
  envBool,
  envNum,
  formatBytes,
  formatDuration,
  sha256Hash,
  withRetry,
} from "@engram/common";

// Environment helpers
const apiKey = envStr("API_KEY", "default");
const debug = envBool("DEBUG", false);
const port = envNum("PORT", 3000);

// Formatting
formatBytes(1024); // "1 KB"
formatDuration(3600000); // "1h"

// Hashing
const hash = sha256Hash("content");

// Retry logic
await withRetry(() => fetchData(), { maxRetries: 3 });
```

### Errors

```typescript
import {
  EngramError,
  GraphOperationError,
  SearchError,
  StorageError,
  ValidationError,
} from "@engram/common";

throw new ValidationError("Invalid input", { field: "email" });
```

### Constants

```typescript
import { TIMEOUTS, LIMITS, INTERVALS } from "@engram/common";

// Timeouts for various operations
TIMEOUTS.KAFKA_CONNECT; // 30000ms
TIMEOUTS.GRAPH_QUERY; // 10000ms

// System limits
LIMITS.MAX_PAYLOAD_SIZE; // 50MB
LIMITS.MAX_BATCH_SIZE; // 100
```

### Testing Utilities

```typescript
import { createMockLogger, createMockClient } from "@engram/common/testing";

const logger = createMockLogger();
const client = createMockClient();
```

## Error Hierarchy

```
EngramError (base)
├── GraphOperationError
├── SearchError
├── StorageError
└── ValidationError
```

All errors include:
- Error code
- Optional context object
- Stack trace preservation

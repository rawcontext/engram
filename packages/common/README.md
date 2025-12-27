# @engram/common

Shared utilities, errors, constants, and test fixtures for the Engram system.

## Purpose

Foundation package providing type-safe utilities, structured error handling, system-wide constants, and comprehensive test infrastructure. Eliminates code duplication across all Engram packages and applications.

## Exported Utilities

### Environment (`@engram/common/utils`)
- `envStr`, `envBool`, `envNum`, `envFloat`, `envArray` - Type-safe environment variable parsing with defaults
- `envRequired` - Required environment variables (throws if missing)

### Formatting (`@engram/common/utils`)
- `formatBytes`, `formatDuration`, `formatRelativeTime` - Human-readable formatting
- `truncateId`, `truncateText` - Text truncation for display

### Hashing (`@engram/common/utils`)
- `sha256Hash`, `sha256Short` - SHA-256 hashing for content-addressable storage
- `hashObject` - Deterministic object hashing (order-independent)

### Retry (`@engram/common/utils`)
- `withRetry` - Exponential backoff with jitter for transient failures
- `RetryableErrors` - Built-in retryable error patterns (network, rate limit, server errors)

### Errors (`@engram/common/errors`)
- `EngramError` - Base error with error codes and cause chaining
- `GraphOperationError`, `ParseError`, `ValidationError` - Domain-specific errors
- `ContextAssemblyError`, `RehydrationError`, `StorageError`, `SearchError`
- `ErrorCodes` - Centralized error code constants

### Constants (`@engram/common/constants`)
- **Timeouts**: `GraphTimeouts`, `ToolTimeouts`, `SearchTimeouts`, `HttpTimeouts`, `CacheTimeouts`
- **Limits**: `ContentLimits`, `QueryLimits`, `SessionLimits`, `RateLimits`, `BatchLimits`
- **Intervals**: `PruneIntervals`, `PollIntervals`, `DebounceIntervals`, `RetentionPeriods`, `WebSocketIntervals`
- **Qdrant**: `QdrantCollections`, `MemoryVectorFields`, `TurnsVectorFields`

### Types (`@engram/common/types`)
- OAuth types: `TokenRequest`, `TokenResponse`, `DeviceCodeRequest`, `DeviceCodeResponse`
- Auth types: `AuthContext`, `OAuthTokenContext`, `CachedTokens`
- Configs: `OAuthConfig`, token patterns

### Testing (`@engram/common/testing`)
- **Mock Factories**: `createTestLogger`, `createTestGraphClient`, `createTestMessageClient`, `createTestRedisPublisher`, `createTestBlobStore`, `createTestProducer`, `createTestConsumer`
- **Domain Fixtures**: `createTestSession`, `createTestTurn`, `createTestToolCall`, `createTestReasoning`, `createTestFileTouch`, `createTestObservation`
- **Utilities**: `createTestId`, `createTestHash`, `createTestBitemporalProps`, `createDeferred`, `expectToReject`, `spyOnConsole`, `wait`

## Usage

```typescript
// Environment parsing
import { envStr, envBool, envNum } from "@engram/common";
const host = envStr("REDIS_HOST", "localhost");
const debug = envBool("DEBUG", false);
const port = envNum("PORT", 3000);

// Formatting
import { formatBytes, formatDuration } from "@engram/common";
formatBytes(1048576); // "1 MB"
formatDuration(90000); // "1m 30s"

// Hashing
import { sha256Hash, hashObject } from "@engram/common";
const hash = sha256Hash("content");
const objHash = hashObject({ b: 2, a: 1 }); // Order-independent

// Retry with exponential backoff
import { withRetry, RetryableErrors } from "@engram/common";
const result = await withRetry(() => apiCall(), {
  maxRetries: 5,
  isRetryable: RetryableErrors.isTransientError,
});

// Structured errors
import { GraphOperationError, ValidationError } from "@engram/common";
throw new GraphOperationError("Query failed", "MATCH (n) RETURN n", error);

// Constants
import { GraphTimeouts, ContentLimits } from "@engram/common";
const timeout = GraphTimeouts.QUERY_MS; // 10,000

// Testing
import { createTestGraphClient, createTestSession } from "@engram/common/testing";
const graphClient = createTestGraphClient({
  query: mock().mockResolvedValue([{ id: "123" }]),
});
const session = createTestSession({ user_id: "user-123" });
```

## Dependencies

- `@engram/storage` - Storage interface types for test mocks
- `@engram/graph` - Domain model types for test fixtures

# @engram/common

Shared utilities, errors, and constants for the Engram system.

## Overview

Foundation package providing type-safe utilities, structured error handling, system-wide constants, and comprehensive test fixtures. Eliminates code duplication across all Engram packages and applications.

## Installation

```bash
npm install @engram/common
```

## Features

- **Environment Utilities**: Type-safe environment variable parsing with defaults
- **Formatting Utilities**: Consistent formatting for bytes, durations, timestamps, and text
- **Hashing Utilities**: SHA-256 hashing for content-addressable storage and deduplication
- **Retry Logic**: Exponential backoff with jitter for transient failures
- **Structured Errors**: Domain-specific error classes with error codes and cause chaining
- **System Constants**: Centralized timeouts, limits, intervals, and retention periods
- **Testing Utilities**: Mock factories and test fixtures for all storage interfaces and domain models

## Usage

### Environment Utilities

Type-safe helpers for reading environment variables:

```typescript
import { envStr, envBool, envNum, envFloat, envArray, envRequired } from "@engram/common";

// String with default
const host = envStr("REDIS_HOST", "localhost");

// Boolean (recognizes "true", "1" as true)
const debug = envBool("DEBUG", false);

// Number (integer)
const port = envNum("PORT", 3000);

// Float
const threshold = envFloat("SCORE_THRESHOLD", 0.75);

// Array (comma-separated by default)
const brokers = envArray("KAFKA_BROKERS", ["localhost:9092"]);
const hosts = envArray("REDIS_HOSTS", ["127.0.0.1"], ";"); // Custom delimiter

// Required (throws if not set)
const apiKey = envRequired("API_KEY");
```

### Formatting Utilities

Consistent formatting for display and logging:

```typescript
import {
  formatBytes,
  formatDuration,
  formatRelativeTime,
  truncateId,
  truncateText,
} from "@engram/common";

// Bytes to human-readable format
formatBytes(1024); // "1 KB"
formatBytes(1536); // "1.5 KB"
formatBytes(1048576); // "1 MB"

// Duration in milliseconds to readable format
formatDuration(150); // "150ms"
formatDuration(1500); // "1.5s"
formatDuration(90000); // "1m 30s"

// Relative time strings
formatRelativeTime(Date.now() - 30000); // "now"
formatRelativeTime(Date.now() - 300000); // "5m"
formatRelativeTime(Date.now() - 7200000); // "2h"

// Truncate IDs and text
truncateId("550e8400-e29b-41d4-a716-446655440000"); // "550e8400"
truncateText("Hello, World!", 10); // "Hello, ..."
```

### Hashing Utilities

SHA-256 hashing for content-addressable storage:

```typescript
import { sha256Hash, sha256Short, hashObject } from "@engram/common";

// Full SHA-256 hash (64 characters)
const hash = sha256Hash("Hello, World!");
// "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"

// Short hash for display (8 characters by default)
const shortHash = sha256Short("Hello, World!");
// "dffd6021"

// Deterministic object hashing (sorted keys)
const hash1 = hashObject({ b: 2, a: 1 });
const hash2 = hashObject({ a: 1, b: 2 });
// hash1 === hash2 (order-independent)
```

### Retry Logic

Exponential backoff with jitter for transient failures:

```typescript
import { withRetry, RetryableErrors } from "@engram/common";

// Basic retry (3 attempts by default)
const result = await withRetry(() => fetchData());

// Custom configuration
const result = await withRetry(
  () => apiCall(),
  {
    maxRetries: 5,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: 0.1,
    isRetryable: RetryableErrors.isTransientError,
    onRetry: (error, attempt, delayMs) => {
      console.log(`Retry ${attempt} after ${delayMs}ms: ${error.message}`);
    },
  }
);

// Built-in retryable error patterns
RetryableErrors.isNetworkError(error);     // ECONNREFUSED, ETIMEDOUT, etc.
RetryableErrors.isRateLimitError(error);   // HTTP 429
RetryableErrors.isServerError(error);      // HTTP 5xx
RetryableErrors.isTransientError(error);   // All of the above
```

### Errors

Domain-specific error classes with structured metadata:

```typescript
import {
  EngramError,
  GraphOperationError,
  ParseError,
  ValidationError,
  ContextAssemblyError,
  RehydrationError,
  StorageError,
  SearchError,
  ErrorCodes,
} from "@engram/common";

// Base error
throw new EngramError("Operation failed", "OP_FAILED", originalError);

// Graph operation errors
throw new GraphOperationError(
  "Failed to execute query",
  "MATCH (n) RETURN n LIMIT 10",
  queryError,
  { limit: 10 }
);

// Parse errors
throw new ParseError("Invalid JSON", rawPayload, parseError, "JSON");

// Validation errors
throw new ValidationError(
  "Invalid email format",
  "email",
  undefined,
  { value: userInput, constraint: "email" }
);

// Context assembly errors
throw new ContextAssemblyError("Timeout assembling context", sessionId, timeoutError);

// Rehydration errors
throw new RehydrationError("Corrupted session state", sessionId, undefined, "Session");

// Storage errors
throw new StorageError(
  "Failed to read blob",
  ErrorCodes.STORAGE_READ_FAILED,
  "file://blob/abc123",
  readError,
  "read"
);

// Search errors
throw new SearchError(
  "Embedding generation failed",
  ErrorCodes.SEARCH_EMBEDDING_FAILED,
  "user query",
  embeddingError,
  "embed"
);

// All errors support serialization
const json = error.toJSON();
const logString = error.toLogString();
```

### Constants

Centralized system-wide constants:

```typescript
import {
  GraphTimeouts,
  ToolTimeouts,
  SearchTimeouts,
  HttpTimeouts,
  CacheTimeouts,
  ContentLimits,
  QueryLimits,
  SessionLimits,
  RateLimits,
  BatchLimits,
  PruneIntervals,
  PollIntervals,
  DebounceIntervals,
  RetentionPeriods,
  WebSocketIntervals,
} from "@engram/common";

// Timeouts (all in milliseconds)
GraphTimeouts.QUERY_MS;              // 10,000
GraphTimeouts.TRAVERSAL_MS;          // 30,000
ToolTimeouts.EXECUTION_MS;           // 60,000
ToolTimeouts.MCP_INVOCATION_MS;      // 120,000
SearchTimeouts.QUERY_MS;             // 5,000
SearchTimeouts.EMBEDDING_MS;         // 30,000
SearchTimeouts.RERANK_ACCURATE_MS;   // 2,000
HttpTimeouts.REQUEST_MS;             // 30,000
CacheTimeouts.DEFAULT_TTL_MS;        // 300,000

// Content Limits
ContentLimits.MAX_EVENT_CONTENT_BYTES;   // 100,000 (100KB)
ContentLimits.MAX_BLOB_BYTES;            // 10,000,000 (10MB)
ContentLimits.MAX_CONTEXT_TOKENS;        // 200,000

// Query Limits
QueryLimits.DEFAULT_PAGE_SIZE;           // 10
QueryLimits.MAX_PAGE_SIZE;               // 100
QueryLimits.MAX_SEARCH_RESULTS;          // 100
QueryLimits.MAX_TRAVERSAL_DEPTH;         // 10

// Session Limits
SessionLimits.MAX_TURNS_DISPLAY;         // 100
SessionLimits.MAX_ACTIVE_SESSIONS;       // 10
SessionLimits.MAX_EVENTS_PER_TURN;       // 1,000

// Rate Limits
RateLimits.SEARCH_RPM;                   // 60 requests/min
RateLimits.EMBEDDING_RPM;                // 100 requests/min
RateLimits.INGESTION_EPS;                // 100 events/sec

// Batch Limits
BatchLimits.DEFAULT_BATCH_SIZE;          // 100
BatchLimits.EMBEDDING_BATCH_SIZE;        // 32
BatchLimits.KAFKA_BATCH_SIZE;            // 100

// Intervals (all in milliseconds)
PruneIntervals.GRAPH_PRUNE_MS;           // 86,400,000 (24 hours)
PruneIntervals.STALE_TURN_CLEANUP_MS;    // 300,000 (5 minutes)
PollIntervals.HEALTH_CHECK_MS;           // 30,000 (30 seconds)
PollIntervals.METRICS_COLLECTION_MS;     // 10,000 (10 seconds)
DebounceIntervals.SEARCH_INPUT_MS;       // 300
DebounceIntervals.EVENT_BATCH_MS;        // 100
WebSocketIntervals.PING_MS;              // 30,000 (30 seconds)
WebSocketIntervals.PONG_TIMEOUT_MS;      // 10,000 (10 seconds)

// Retention Periods
RetentionPeriods.SESSION_DAYS;           // 90 days
RetentionPeriods.METRICS_DAYS;           // 7 days
RetentionPeriods.toMs(30);               // Convert days to milliseconds
```

### Testing Utilities

Comprehensive test infrastructure with mock factories and domain fixtures:

```typescript
import {
  // Mock factories
  createTestLogger,
  createTestGraphClient,
  createTestKafkaClient,
  createTestRedisPublisher,
  createTestBlobStore,
  createTestProducer,
  createTestConsumer,
  // Domain fixtures
  createTestSession,
  createTestTurn,
  createTestToolCall,
  createTestReasoning,
  createTestFileTouch,
  createTestObservation,
  // Utilities
  createTestId,
  createTestHash,
  createTestBitemporalProps,
  createTestKafkaMessage,
  createDeferred,
  expectToReject,
  spyOnConsole,
  wait,
} from "@engram/common/testing";

describe("MyService", () => {
  it("should handle session creation", async () => {
    // Mock storage interfaces
    const logger = createTestLogger();
    const graphClient = createTestGraphClient({
      query: vi.fn().mockResolvedValue([{ id: "123" }]),
    });
    const kafkaClient = createTestKafkaClient();
    const redisPublisher = createTestRedisPublisher();
    const blobStore = createTestBlobStore();

    // Create domain fixtures
    const session = createTestSession({
      user_id: "user-123",
      working_dir: "/home/user/project",
    });

    const turn = createTestTurn({
      user_content: "How do I create a file?",
      sequence_index: 0,
    });

    const toolCall = createTestToolCall({
      tool_name: "Write",
      tool_type: "file_write",
      arguments_json: JSON.stringify({ file_path: "/src/index.ts" }),
    });

    // Test async error handling
    await expectToReject(
      myService.invalidOperation(),
      ValidationError,
      "Invalid input"
    );

    // Test console output
    const { logs, errors, restore } = spyOnConsole();
    myService.logOperation();
    expect(logs).toContain("Operation completed");
    restore();

    // Verify mock calls
    expect(graphClient.query).toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("Session created");
  });
});
```

## Error Hierarchy

```
EngramError (base class)
├── GraphOperationError      - FalkorDB query/connection failures
├── ParseError               - JSON/event parsing failures
├── ValidationError          - Input/schema validation failures
├── ContextAssemblyError     - Context building failures
├── RehydrationError         - State reconstruction failures
├── StorageError            - Blob/file storage failures
└── SearchError             - Vector search/embedding failures
```

All errors include:
- Error code (e.g., `GRAPH_QUERY_FAILED`, `VALIDATION_FAILED`)
- Error message
- Optional cause (original error)
- Timestamp
- Domain-specific metadata (query, field, entityId, etc.)
- JSON serialization with `toJSON()`
- Formatted logging with `toLogString()`

## Exports

The package provides multiple entry points:

- `@engram/common` - Main entry point (utilities, errors, constants)
- `@engram/common/utils` - Utility functions only
- `@engram/common/errors` - Error classes only
- `@engram/common/constants` - Constants only
- `@engram/common/testing` - Test utilities (not included in main export)

## Dependencies

- `@engram/storage` - Storage interface types for test mocks
- `@engram/graph` - Domain model types for test fixtures
- `vitest` - Test framework (dev dependency)

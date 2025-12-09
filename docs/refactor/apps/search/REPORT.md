# Refactoring Analysis Report: apps/search

**Generated**: 2025-12-09
**Analyzed Path**: `/Users/ccheney/Projects/the-system/apps/search`
**Total Source Files**: 3 (index.ts, index.test.ts, routes/health.ts)

---

## Executive Summary

The `apps/search` service is a thin HTTP layer over `@engram/search-core`. While relatively small, it exhibits several architectural concerns including **duplicated code**, **mixed concerns**, **weak type safety**, and **incomplete integration** with its own route module. The main concerns center around:

1. **Duplicated HTTP handler logic** between `SearchService.handleRequest()` and the raw HTTP server
2. **Unused route module** (`routes/health.ts`) that is never integrated
3. **Weak type safety** with `any` types in Kafka message handling
4. **Missing graceful shutdown** for Kafka consumers
5. **Hardcoded configuration** without environment variable support

---

## Code Smells Detected

| File | Smell | Severity | Metric/Location |
|------|-------|----------|-----------------|
| `src/index.ts` | Duplicated Handler Logic | **HIGH** | Lines 52-69 and 83-116 |
| `src/index.ts` | `any` Type Usage | **MEDIUM** | Lines 10, 23-30 |
| `src/index.ts` | Unused Class Method | **MEDIUM** | `handleRequest()` never called |
| `src/index.ts` | Hardcoded Port | **LOW** | Line 73 |
| `src/index.ts` | Console Logging | **LOW** | Lines 43, 46, 119 |
| `src/routes/health.ts` | Dead Code | **HIGH** | Entire file unused |
| `src/routes/health.ts` | Internal Prometheus Access | **MEDIUM** | Lines 221-222 |
| `src/index.test.ts` | Excessive `as any` Casts | **MEDIUM** | Lines 18-23, 40 |

---

## Detailed Findings

### 1. Code Duplication (DRY Violation) - HIGH

**Files**: `/Users/ccheney/Projects/the-system/apps/search/src/index.ts`

The `SearchService` class defines a `handleRequest()` method (lines 52-69) that is **never used**. Instead, the HTTP server (lines 83-116) duplicates the same logic manually:

```typescript
// SearchService.handleRequest() - Lines 52-69 (UNUSED)
async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("OK");
    if (url.pathname === "/search" && req.method === "POST") {
        // ...search logic
    }
    return new Response("Not Found", { status: 404 });
}

// HTTP Server - Lines 83-116 (DUPLICATED)
const server = createServer(async (req, res) => {
    if (url.pathname === "/health") { /* same logic */ }
    if (url.pathname === "/search" && req.method === "POST") { /* same logic */ }
    // ...
});
```

**Impact**: Any bug fix or feature addition must be applied twice. The class abstraction provides no value.

**Recommendation**: Either use the `SearchService.handleRequest()` method consistently, or remove the class abstraction entirely and use a functional approach.

---

### 2. Dead Code - HIGH

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/routes/health.ts`

This 291-line file contains a sophisticated health check system with:
- `ErrorTracker` class (lines 36-72)
- `CircuitBreaker` class (lines 82-151)
- `getRerankerHealth()` function (lines 184-248)
- `handleRerankerHealth()` HTTP handler (lines 254-291)

**None of this code is imported or used by the search service.**

```typescript
// routes/health.ts exports these, but no imports exist in index.ts
export function recordRerankError(tier: string): void { ... }
export function recordRerankSuccess(): void { ... }
export async function getRerankerHealth(): Promise<RerankerHealthResponse> { ... }
export async function handleRerankerHealth(): Promise<{...}> { ... }
```

**Impact**:
- 291 lines of unmaintained dead code
- Health monitoring for rerankers is not exposed
- Potential stale code that will diverge from actual implementation

**Recommendation**: Either integrate `routes/health.ts` into the HTTP server, or remove it if redundant with `search-core` functionality.

---

### 3. Type Safety Issues - MEDIUM

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/index.ts`

Multiple uses of `any` type bypass TypeScript's safety guarantees:

```typescript
// Line 10 - Kafka client has no type
private kafkaClient: any,

// Lines 23-30 - Kafka message has no type
eachMessage: async ({
    topic: _topic,
    partition: _partition,
    message,
}: {
    topic: any;      // Should be string
    partition: any;  // Should be number
    message: any;    // Should be KafkaMessage type
}) => {
```

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/routes/health.ts`

```typescript
// Lines 221-222 - Accessing internal Prometheus metric structure
const embeddingHitRate = (embeddingCacheHitRate as any).hashMap?.[""]?.value ?? 0;
const queryHitRate = (queryCacheHitRate as any).hashMap?.[""]?.value ?? 0;
```

This casts to `any` to access internal implementation details of the Prometheus client, which is fragile and could break on library updates.

**Recommendation**:
- Import proper Kafka types from `@engram/storage`
- Create proper metric accessor functions in `search-core` instead of accessing internal state

---

### 4. Missing Graceful Shutdown - MEDIUM

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/index.ts`

The Kafka consumer is started but never stopped:

```typescript
// Consumer is started but there's no shutdown handler
await service.initialize();  // Starts consumer
// ...
server.listen(PORT, () => { ... });  // No SIGTERM handler
```

Compare to `apps/ingestion` which has the same issue, and `apps/memory` which at least structures things with `main()`.

**Impact**: Dirty shutdowns can cause message processing issues and Kafka rebalancing delays.

**Recommendation**: Add graceful shutdown:
```typescript
process.on('SIGTERM', async () => {
    await consumer.disconnect();
    server.close();
    process.exit(0);
});
```

---

### 5. Hardcoded Configuration - LOW

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/index.ts`

```typescript
// Line 73
const PORT = 5002;
```

While other environment variables are handled in `search-core`, the port is hardcoded in the app.

**Recommendation**: Use environment variable:
```typescript
const PORT = parseInt(process.env.PORT || '5002', 10);
```

---

### 6. Console Logging vs Structured Logger - LOW

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/index.ts`

The service uses `console.log/error` instead of the structured logger from `@engram/logger`:

```typescript
// Lines 43, 46, 119
console.log(`Indexed node ${node.id}`);
console.error("Indexing error", e);
console.log(`Search Service running on port ${PORT}`);
```

Compare to `apps/memory` which properly uses `createNodeLogger()`.

**Recommendation**: Use structured logging for consistency and observability.

---

### 7. SOLID Principle Violations

#### Single Responsibility Principle (SRP) - MEDIUM

`SearchService` class mixes:
1. **Kafka consumer management** (`startConsumer()`)
2. **HTTP request handling** (`handleRequest()`)
3. **Initialization orchestration** (`initialize()`)

These should be separated.

#### Dependency Inversion Principle (DIP) - MEDIUM

The module-level code directly instantiates concrete classes:

```typescript
// Lines 75-80
const schemaManager = new SchemaManager();
const indexer = new SearchIndexer();
const retriever = new SearchRetriever();
const kafka = createKafkaClient("search-service");
const service = new SearchService(retriever, indexer, schemaManager, kafka);
```

While the class accepts dependencies via constructor (good), the wiring is done at module scope with no abstraction.

**Recommendation**: Consider a factory function or dependency injection container for testability.

---

### 8. Testing Gaps

**File**: `/Users/ccheney/Projects/the-system/apps/search/src/index.test.ts`

Current test coverage:
- `handleRequest()` for `/search` endpoint (but this method is unused!)
- `handleRequest()` for `/health` endpoint

Missing tests:
- Kafka consumer message processing
- Error handling in `startConsumer()`
- Node filtering logic (labels check)
- Integration with actual `SearchRetriever`

```typescript
// Tests are for the unused handleRequest() method
const service = new SearchService(
    mockRetriever as any,  // Excessive any usage
    mockIndexer as any,
    mockSchemaManager as any,
    mockKafka as any,
);
const res = await service.handleRequest(req);  // This method is never called in production!
```

**Impact**: Tests pass but don't exercise the actual code path used in production.

---

## Architecture Improvements

### Current Architecture

```
HTTP Request -> node:http createServer -> inline handler logic
                                              |
Kafka Consumer -> SearchService.startConsumer() -> SearchIndexer
```

### Proposed Architecture

```
HTTP Request -> Router -> SearchController.handleSearch()
                      \-> HealthController.handleHealth()
                       \-> RerankerHealthController.handleRerankerHealth()
                                              |
Kafka Consumer -> MessageHandler -> SearchIndexer
                                              |
Graceful Shutdown Handler <- Process Signals
```

### Recommended File Structure

```
apps/search/src/
  index.ts              # Entry point, wiring only
  server.ts             # HTTP server setup
  routes/
    health.ts           # Health endpoints (already exists, needs integration)
    search.ts           # Search endpoint handler
  consumers/
    node-indexer.ts     # Kafka consumer for indexing
  config.ts             # Environment configuration
```

---

## Before/After Metrics

| Metric | Before | After (Projected) |
|--------|--------|-------------------|
| Lines of Code | 121 + 291 (412 total) | ~250 (after removing dead code) |
| Dead Code Lines | 291 | 0 |
| `any` Type Usage | 5 instances | 0 |
| Test Coverage of Production Paths | ~20% | ~80% |
| Cyclomatic Complexity (index.ts) | 8 | 4 (after splitting) |
| SOLID Violations | 2 | 0 |

---

## Migration Roadmap

### Phase 1: Remove Dead Code & Fix DRY Violation
1. Decide whether to use `SearchService.handleRequest()` or remove it
2. Integrate or remove `routes/health.ts`
3. Remove duplicated handler logic

### Phase 2: Add Type Safety
1. Create proper Kafka message types
2. Remove `any` casts from consumer
3. Add metric accessor functions to search-core

### Phase 3: Add Operational Improvements
1. Implement graceful shutdown
2. Use environment variables for configuration
3. Switch to structured logging

### Phase 4: Improve Testability
1. Add tests for Kafka consumer path
2. Fix tests to exercise actual production code paths
3. Add integration tests

---

## File References

| File | Path | Lines |
|------|------|-------|
| Main Service | `/Users/ccheney/Projects/the-system/apps/search/src/index.ts` | 121 |
| Tests | `/Users/ccheney/Projects/the-system/apps/search/src/index.test.ts` | 47 |
| Health Routes (Unused) | `/Users/ccheney/Projects/the-system/apps/search/src/routes/health.ts` | 292 |
| Package Config | `/Users/ccheney/Projects/the-system/apps/search/package.json` | 19 |
| TypeScript Config | `/Users/ccheney/Projects/the-system/apps/search/tsconfig.json` | 11 |
| Dockerfile | `/Users/ccheney/Projects/the-system/apps/search/Dockerfile` | 18 |

---

## Dependencies Analysis

### Direct Dependencies
| Package | Purpose | Issues |
|---------|---------|--------|
| `@engram/logger` | Structured logging | Imported in health.ts, not used in index.ts |
| `@engram/storage` | Kafka client | Types not properly used |
| `@engram/search-core` | Core search logic | Well-integrated |

### Dependency Direction Issues
The `routes/health.ts` imports from `@engram/search-core` and accesses internal Prometheus metrics:

```typescript
import { BatchedReranker, embeddingCacheHitRate, queryCacheHitRate } from "@engram/search-core";
const embeddingHitRate = (embeddingCacheHitRate as any).hashMap?.[""]?.value ?? 0;
```

This violates clean architecture by depending on internal implementation details.

---

## Conclusion

The `apps/search` service is functional but has significant technical debt:

1. **Critical**: 291 lines of dead code in `routes/health.ts`
2. **Critical**: Duplicated handler logic (DRY violation)
3. **Important**: Tests exercise unused code paths
4. **Moderate**: Weak type safety with `any` usage
5. **Minor**: Missing operational concerns (shutdown, logging, config)

The refactoring effort is estimated at **2-3 days** for a complete cleanup, or **0.5 days** for quick wins (removing dead code, fixing DRY violation).

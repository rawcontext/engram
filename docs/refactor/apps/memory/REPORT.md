# Refactoring Analysis Report: apps/memory

**Generated**: 2025-12-09
**Codebase Version**: main branch
**Total Lines of Code**: 1,100 (excluding tests)

---

## Executive Summary

The `apps/memory` service is a relatively small but critical component responsible for persisting agent conversation data to FalkorDB and broadcasting real-time updates. While the codebase is functional, several architectural and code quality issues warrant attention:

| Severity | Count | Description |
|----------|-------|-------------|
| **High** | 3 | God function, module-level state, missing error recovery |
| **Medium** | 7 | DRY violations, type safety gaps, inconsistent patterns |
| **Low** | 5 | Minor style issues, documentation gaps |

---

## 1. Code Smells and Complexity Issues

### 1.1 God Function: `startPersistenceConsumer.eachMessage` (HIGH)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Lines**: 83-246 (163 lines in single callback)

The Kafka message handler does too many things:
- JSON parsing and validation
- Session existence checking
- Session upsert with complex conditional updates
- Redis event publishing for new sessions
- Turn aggregation delegation
- Legacy thought node creation (conditional)
- Redis streaming updates
- Kafka event forwarding to search service

**Cyclomatic Complexity**: Estimated 12-15 (exceeds recommended <10)

**Recommendation**: Extract into discrete, testable functions:
```
MessageProcessor
  |-- EventValidator
  |-- SessionManager (ensure/update session)
  |-- TurnProcessor (delegate to TurnAggregator)
  |-- EventBroadcaster (Redis/Kafka publishing)
```

### 1.2 High Complexity: `TurnAggregator.processEvent` (HIGH)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
**Lines**: 113-231 (118 lines)

Large switch statement with nested conditionals. Each case has side effects and database writes.

**Cyclomatic Complexity**: Estimated 18-20

**Recommendation**: Apply Strategy Pattern - create event handlers per type:
```typescript
const handlers = {
  content: new ContentEventHandler(),
  thought: new ThoughtEventHandler(),
  tool_call: new ToolCallEventHandler(),
  diff: new DiffEventHandler(),
  usage: new UsageEventHandler(),
};
```

### 1.3 Long Method Chain: `inferToolType` (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
**Lines**: 647-709 (62 lines of if-else chains)

**Cyclomatic Complexity**: 20+

**Recommendation**: Replace with lookup table:
```typescript
const TOOL_TYPE_MAP: Record<string, ToolCallTypeValue> = {
  read: ToolCallType.FILE_READ,
  read_file: ToolCallType.FILE_READ,
  readfile: ToolCallType.FILE_READ,
  // ... etc
};
```

### 1.4 Similar Issue: `inferFileAction` (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
**Lines**: 617-641

Same pattern as `inferToolType`. Should use lookup table.

---

## 2. Architecture Improvements

### 2.1 Module-Level Mutable State (HIGH)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
**Lines**: 58-61

```typescript
// In-memory state for active turns per session
const activeTurns = new Map<string, TurnState>();
const sessionSequence = new Map<string, number>();
```

**Problems**:
1. Global mutable state makes testing difficult
2. Memory leak risk if sessions are not properly cleaned
3. Cannot scale horizontally (state not shared across instances)
4. No persistence - state lost on restart

**Recommendation**:
- Move state into `TurnAggregator` class instance
- Consider Redis-backed state for horizontal scaling
- Add state recovery from FalkorDB on startup

### 2.2 Missing Dependency Injection (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Lines**: 22-26

```typescript
const falkor = createFalkorClient();
const kafka = createKafkaClient("memory-service");
const redis = createRedisPublisher();
const pruner = new GraphPruner(falkor);
```

Dependencies are created at module level, making testing difficult.

**Recommendation**: Create a factory or container:
```typescript
interface MemoryServiceDependencies {
  falkor: FalkorClient;
  kafka: KafkaClient;
  redis: RedisPublisher;
  logger: Logger;
}

class MemoryService {
  constructor(private deps: MemoryServiceDependencies) {}
}
```

### 2.3 Repeated `falkor.connect()` Calls (MEDIUM)

**Files**: Multiple locations across codebase
**Occurrences**: 17 total across the project, 4 in memory service

The FalkorClient has lazy connection semantics but `connect()` is called repeatedly before each operation. This is a code smell indicating unclear connection lifecycle.

**Locations in memory service**:
- `index.ts:108` - inside message handler
- `index.ts:266` - in read_graph tool
- `index.ts:293` - in get_session_history tool
- `index.ts:321` - in main()

**Recommendation**:
1. Connect once at startup
2. Add auto-reconnect logic inside `FalkorClient.query()`
3. Remove explicit connect calls from business logic

### 2.4 Missing Repository Pattern (MEDIUM)

Cypher queries are embedded directly in business logic throughout `index.ts` and `turn-aggregator.ts`.

**Examples**:
- Session MERGE query: `index.ts:123-145`
- Turn creation: `turn-aggregator.ts:286-306`
- Reasoning creation: `turn-aggregator.ts:361-373`
- ToolCall creation: `turn-aggregator.ts:427-445`

**Recommendation**: Extract to repository classes:
```typescript
interface SessionRepository {
  findById(id: string): Promise<Session | null>;
  upsert(session: SessionData): Promise<void>;
}

interface TurnRepository {
  create(turn: TurnData): Promise<void>;
  update(id: string, updates: Partial<TurnData>): Promise<void>;
  linkToSession(turnId: string, sessionId: string): Promise<void>;
}
```

---

## 3. DRY Violations

### 3.1 Duplicate Event Payload Construction (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`

Similar payload structures constructed in multiple places:

**Lines 29-43** (onNodeCreated callback):
```typescript
await redis.publishSessionUpdate(sessionId, {
  type: "graph_node_created",
  data: {
    id: node.id,
    nodeType: node.type,
    label: node.label,
    properties: node.properties,
    timestamp: new Date().toISOString(),
  },
});
```

**Lines 224-233** (inside message handler):
```typescript
await redis.publishSessionUpdate(sessionId, {
  type: "node_created",
  data: {
    id: eventId,
    type,
    role,
    content,
    timestamp: event.timestamp || new Date().toISOString(),
  },
});
```

**Recommendation**: Create event builder functions or classes.

### 3.2 Duplicate File Tracking Logic (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`

Same pattern repeated for tracking files touched:

**Lines 179-189** (in tool_call case):
```typescript
if (filePath) {
  const existing = turn.filesTouched.get(filePath);
  if (existing) {
    existing.count++;
  } else {
    turn.filesTouched.set(filePath, {
      action: fileAction!,
      count: 1,
      toolCallId: toolCallState.id,
    });
  }
}
```

**Lines 209-218** (in diff case):
```typescript
const existing = turn.filesTouched.get(diff.file);
if (existing) {
  existing.count++;
} else {
  turn.filesTouched.set(diff.file, {
    action,
    count: 1,
    toolCallId: recentToolCall?.id,
  });
}
```

**Recommendation**: Extract to method:
```typescript
private trackFileTouch(turn: TurnState, filePath: string, action: string, toolCallId?: string): void
```

### 3.3 Duplicate Node Emission Pattern (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`

`emitNodeCreated` is called with similar structure after each node creation:
- Lines 322-330 (Turn)
- Lines 386-395 (Reasoning)
- Lines 491-504 (ToolCall)

Could be consolidated into a decorator or automatic post-create hook.

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP) - VIOLATED (HIGH)

**`index.ts`** handles:
1. Logger initialization
2. Service client creation
3. MCP server setup
4. Tool registration
5. Kafka consumer setup
6. Pruning job scheduling
7. Turn cleanup scheduling
8. Main entry point

**Recommendation**: Split into:
- `config.ts` - Configuration and client creation
- `tools/read-graph.ts` - MCP tool
- `tools/session-history.ts` - MCP tool
- `consumers/persistence.ts` - Kafka consumer logic
- `jobs/pruning.ts` - Scheduled jobs
- `server.ts` - MCP server setup
- `index.ts` - Bootstrap/main

### 4.2 Open/Closed Principle (OCP) - VIOLATED (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`

Adding a new event type requires modifying the switch statement in `processEvent()`. The class is not open for extension.

**Recommendation**: Use event handler registry pattern.

### 4.3 Dependency Inversion Principle (DIP) - VIOLATED (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`

High-level modules depend directly on concrete implementations:
```typescript
const falkor = createFalkorClient();  // Concrete
const kafka = createKafkaClient("memory-service");  // Concrete
const redis = createRedisPublisher();  // Concrete
```

**Recommendation**: Depend on interfaces/abstractions.

---

## 5. Dependency Issues

### 5.1 Missing Explicit Event Types Export (LOW)

**File**: `/Users/ccheney/Projects/the-system/packages/storage/src/index.ts`

Redis publisher types are not exported from the main index:
```typescript
export * from "./blob";
export * from "./falkor";
export * from "./kafka";
// Missing: export * from "./redis";
```

Currently imported via subpath: `@engram/storage/redis`

### 5.2 Circular Type Dependencies Risk (LOW)

**File**: `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/base.ts`

Re-exports types from `@engram/storage/falkor` with aliases to avoid conflicts. This creates a complex import graph that could become problematic.

### 5.3 Zod Version (INFO)

Package uses `zod@4.1.13` which is a major version ahead. Ensure compatibility with other packages.

---

## 6. Testing Gaps

### 6.1 Test Coverage Analysis (HIGH)

| File | Lines | Test Coverage | Gap |
|------|-------|--------------|-----|
| `index.ts` | 337 | ~1% | Critical - Only server existence check |
| `turn-aggregator.ts` | 724 | 0% | Critical - No tests |
| **Total** | 1,061 | <1% | **Severe** |

### 6.2 Missing Test Categories

1. **Unit Tests (Missing)**:
   - `TurnAggregator.processEvent()` for each event type
   - `TurnAggregator.inferToolType()` edge cases
   - `TurnAggregator.extractFilePath()` regex patterns
   - Session MERGE query logic

2. **Integration Tests (Missing)**:
   - Kafka message consumption flow
   - FalkorDB graph creation
   - Redis pub/sub broadcasting
   - Turn lifecycle (create -> update -> finalize)

3. **Edge Cases Not Tested**:
   - Missing session_id handling
   - Stale turn cleanup
   - Concurrent turn processing
   - Connection failure recovery

### 6.3 Test File Issues (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.test.ts`

```typescript
// Import server after mocks are set up
const { server } = await import("./index");

// Mock MCP AFTER importing (wrong order)
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    tool = vi.fn(() => {});
    connect = vi.fn(async () => {});
  },
}));
```

**Problems**:
1. Mock setup order may cause issues
2. Only tests that server is defined
3. No actual behavior verification

---

## 7. Type Safety Issues

### 7.1 Unsafe Type Assertions (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Line 87**:
```typescript
const event = JSON.parse(value);
```

No runtime validation of parsed JSON structure.

**Recommendation**: Use Zod schema from `@engram/events`:
```typescript
import { ParsedStreamEventSchema } from "@engram/events";
const parseResult = ParsedStreamEventSchema.safeParse(JSON.parse(value));
if (!parseResult.success) {
  logger.warn({ error: parseResult.error }, "Invalid event structure");
  return;
}
const event = parseResult.data;
```

### 7.2 Non-null Assertion (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
**Line 185**:
```typescript
action: fileAction!,
```

Using `!` assertion when fileAction could theoretically be undefined.

### 7.3 Missing Return Types (LOW)

Several async functions lack explicit return type annotations:

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
- `startPersistenceConsumer` (line 78)
- `main` (line 320)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
- `startNewTurn` (line 236)

---

## 8. Error Handling Patterns

### 8.1 Inconsistent Error Variable Naming (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`

Mixed usage of `e` and `error`:
- Line 41: `catch (e)`
- Line 60: `catch (error)`
- Line 71: `catch (error)`
- Line 242: `catch (e)`

**Recommendation**: Standardize on `error` for clarity.

### 8.2 Silent Failures (MEDIUM)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Lines 84-87**:
```typescript
eachMessage: async ({ message }) => {
  try {
    const value = message.value?.toString();
    if (!value) return;  // Silent drop
```

Messages with null values are silently dropped without logging.

### 8.3 Missing Retry Logic (MEDIUM)

No retry mechanism for:
- Failed FalkorDB writes
- Failed Redis publishes
- Failed Kafka sends

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Lines 107-145**: Session MERGE can fail without retry.

**Recommendation**: Add exponential backoff retry wrapper.

### 8.4 Unhandled Promise Rejection Risk (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Lines 52-64**:
```typescript
function startPruningJob() {
  setInterval(async () => {
    try {
      // ...
    } catch (error) {
      logger.error({ err: error }, "Graph pruning failed");
      // No retry, job continues on next interval
    }
  }, PRUNE_INTERVAL_MS);
}
```

The interval pattern can lead to overlapping executions if previous run is slow.

**Recommendation**: Use a proper job scheduler with mutex/lock.

---

## 9. Additional Observations

### 9.1 Magic Numbers (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
- Line 49: `24 * 60 * 60 * 1000` (24 hours)
- Line 50: `5 * 60 * 1000` (5 minutes)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts`
- Line 311: `10000` (content limit)
- Line 313: `2000` (preview limit)
- Line 338: `500` (update interval)
- Line 379: `1000` (preview limit)
- Line 714: `30 * 60 * 1000` (30 minutes default)

**Recommendation**: Extract to named constants at module or config level.

### 9.2 Dead Code (LOW)

**File**: `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts`
**Lines 176-216**: Legacy ThoughtNode creation block

This code is behind a feature flag (`ENABLE_LEGACY_THOUGHTS`) and appears to be deprecated. Consider removing entirely if no longer needed.

### 9.3 Comment Quality (LOW)

Mixed comment styles and some outdated comments:
- Line 266: `// Ensure connected (idempotent-ish?)` - uncertain comment
- Line 100: `// ingestion might need to pass session_id better` - TODO that should be tracked

---

## 10. Metrics Summary

### Before Metrics (Current State)

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Lines of Code (index.ts) | 337 | <200 | FAIL |
| Lines of Code (turn-aggregator.ts) | 724 | <300 | FAIL |
| Max Cyclomatic Complexity | ~20 | <10 | FAIL |
| Test Coverage | <1% | >80% | FAIL |
| Module-level State | 2 globals | 0 | FAIL |
| Repeated Connect Calls | 4 | 0 | FAIL |
| Magic Numbers | 8+ | 0 | FAIL |

### Refactoring Priority Matrix

| Issue | Impact | Effort | Priority |
|-------|--------|--------|----------|
| Add unit tests for TurnAggregator | High | Medium | P0 |
| Extract message handler logic | High | Medium | P0 |
| Remove module-level state | High | Medium | P0 |
| Add event validation | Medium | Low | P1 |
| Extract repository layer | Medium | High | P1 |
| Apply Strategy pattern for events | Medium | Medium | P1 |
| Replace if-chains with lookup tables | Low | Low | P2 |
| Add retry logic | Medium | Medium | P2 |
| Standardize error handling | Low | Low | P3 |
| Extract constants | Low | Low | P3 |

---

## 11. Recommended Refactoring Roadmap

### Phase 1: Test Foundation (Week 1)
1. Add unit tests for `TurnAggregator` methods
2. Add integration tests for Kafka consumer
3. Fix test mock ordering in `index.test.ts`

### Phase 2: Extract and Inject (Week 2)
1. Move module-level state into class instances
2. Create `MemoryServiceDependencies` interface
3. Extract Cypher queries to repository classes
4. Create event payload builders

### Phase 3: Reduce Complexity (Week 3)
1. Replace `inferToolType` with lookup table
2. Replace `inferFileAction` with lookup table
3. Extract message handler into separate class
4. Apply Strategy pattern to `processEvent`

### Phase 4: Resilience (Week 4)
1. Add retry logic for database operations
2. Add circuit breaker for external services
3. Implement proper job scheduling with mutex
4. Add health check endpoint

---

## 12. Architecture Diagram (Target State)

```
                                 +------------------+
                                 |   MCP Server     |
                                 +--------+---------+
                                          |
                                 +--------v---------+
                                 |  MemoryService   |
                                 +--------+---------+
                                          |
          +-------------------------------+-------------------------------+
          |                               |                               |
+---------v----------+         +----------v---------+         +-----------v--------+
| PersistenceConsumer|         |    ToolRegistry    |         |   ScheduledJobs    |
+---------+----------+         +----------+---------+         +-----------+--------+
          |                               |                               |
          v                               v                               v
+-------------------+         +-------------------+         +-------------------+
| MessageProcessor  |         | read_graph        |         | PruningJob        |
| - EventValidator  |         | session_history   |         | TurnCleanupJob    |
| - SessionManager  |         +-------------------+         +-------------------+
| - TurnProcessor   |
| - EventBroadcaster|
+--------+----------+
         |
         +------------------+------------------+
         |                  |                  |
+--------v-------+  +-------v--------+  +------v-------+
| SessionRepo    |  | TurnRepo       |  | EventStore   |
| (FalkorDB)     |  | (FalkorDB)     |  | (Redis/Kafka)|
+----------------+  +----------------+  +--------------+
```

---

## Appendix: File References

| File | Path | LOC |
|------|------|-----|
| Main Service | `/Users/ccheney/Projects/the-system/apps/memory/src/index.ts` | 337 |
| Turn Aggregator | `/Users/ccheney/Projects/the-system/apps/memory/src/turn-aggregator.ts` | 724 |
| Tests | `/Users/ccheney/Projects/the-system/apps/memory/src/index.test.ts` | 39 |
| Package Config | `/Users/ccheney/Projects/the-system/apps/memory/package.json` | 21 |
| TypeScript Config | `/Users/ccheney/Projects/the-system/apps/memory/tsconfig.json` | 10 |
| Dockerfile | `/Users/ccheney/Projects/the-system/apps/memory/Dockerfile` | 17 |
| Dev Dockerfile | `/Users/ccheney/Projects/the-system/apps/memory/Dockerfile.dev` | 32 |

---

*Report generated by Refactor Guru Agent*

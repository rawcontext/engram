# Refactoring Analysis Report: apps/control

**Generated:** 2025-12-09
**Scope:** `/Users/ccheney/Projects/the-system/apps/control`
**Total Files Analyzed:** 12 TypeScript source files
**Total Lines of Code:** ~650 LOC (excluding tests)

---

## Executive Summary

The `control` application is a well-structured orchestration service implementing an agent loop with XState state machines, MCP tool integration, and context assembly. While the codebase is relatively small and maintainable, several architectural improvements and code quality enhancements can significantly improve testability, type safety, and adherence to SOLID principles.

### Severity Legend
- **P0 (High):** Critical issues requiring immediate attention
- **P1 (Medium):** Important issues affecting maintainability
- **P2 (Low):** Minor improvements for code quality

---

## 1. Code Smells and Complexity Issues

### 1.1 God Class Pattern in DecisionEngine

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 72-184 |

**Issue:** The `DecisionEngine` class combines multiple responsibilities:
- Actor lifecycle management
- Context fetching orchestration
- LLM interaction (generateText)
- Tool execution coordination
- Error recovery logic

**Metrics:**
- Lines of Code: 122
- Responsibilities: 5+
- Cyclomatic Complexity: Estimated 12+ (nested conditionals in actor providers)

**Impact:** Difficult to test individual behaviors; changes ripple across unrelated concerns.

---

### 1.2 Inline Actor Definitions

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 80-183 |

**Issue:** All XState actors (`fetchContext`, `generateThought`, `executeTool`, `streamResponse`, `recoverError`) are defined inline within the constructor using `fromPromise`. This creates:
- A 100+ line constructor
- Actors that cannot be unit tested in isolation
- Tight coupling between machine configuration and business logic

```typescript
// Current: Inline actor definitions
this.actor = createActor(
  agentMachine.provide({
    actors: {
      fetchContext: fromPromise(async ({ input }) => { /* 5 lines */ }),
      generateThought: fromPromise(async ({ input }) => { /* 40 lines */ }),
      executeTool: fromPromise(async ({ input }) => { /* 15 lines */ }),
      // ...
    },
  })
);
```

---

### 1.3 Long Method: generateThought Actor

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 91-134 |

**Issue:** The `generateThought` actor spans 43 lines with multiple concerns:
- Tool caching logic
- MCP tool fetching
- AI SDK tool conversion
- LLM generation
- Tool call extraction
- Logging

**Cyclomatic Complexity:** 6+ (try/catch, conditionals for hasTools, array checks)

---

### 1.4 Magic Numbers and Hardcoded Values

| Severity | File | Lines |
|----------|------|-------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/context/assembler.ts` | 8-9, 31, 42, 131, 146, 182 |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/state/machine.ts` | 69, 100, 138 |

**Issue:** Multiple hardcoded values without named constants:

```typescript
// assembler.ts
const CHARS_PER_TOKEN = 4;           // Line 9 - undocumented estimation
const history = await this.fetchRecentHistory(sessionId, 20);  // Line 42
.slice(0, 3);  // Line 146 - magic number for memory limit

// machine.ts
10000: { target: "deliberating" }   // Line 69 - timeout in ms
30000: { target: "recovering" }     // Line 100, 138 - multiple timeouts
```

---

## 2. Architecture Improvements

### 2.1 Missing Dependency Injection Container

| Severity | File | Lines |
|----------|------|-------|
| P0 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 1-83 |

**Issue:** Dependencies are instantiated and wired manually in `index.ts`:

```typescript
const kafka = createKafkaClient("control-service");
const falkor = createFalkorClient();
const wassetteAdapter = new McpToolAdapter(wassettePath, ["serve", "--stdio"]);
const executionAdapter = new McpToolAdapter("npx", ["tsx", "../../apps/execution/src/index.ts"]);
const multiAdapter = new MultiMcpAdapter();
const contextAssembler = new ContextAssembler({} as unknown as SearchRetriever, falkor);
const sessionManager = new SessionManager(contextAssembler, multiAdapter, falkor);
```

**Impact:**
- Testing requires extensive mocking
- Configuration changes require code changes
- No lifecycle management for services
- Violates Dependency Inversion Principle

**Recommendation:** Introduce a DI container (e.g., `tsyringe`, `inversify`, or manual composition root pattern).

---

### 2.2 Type Casting for Unavailable Dependencies

| Severity | File | Lines |
|----------|------|-------|
| P0 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 29-31 |

**Issue:** Critical unsafe type cast for unavailable dependency:

```typescript
const contextAssembler = new ContextAssembler(
  {} as unknown as import("@engram/search-core").SearchRetriever,  // UNSAFE
  falkor,
);
```

**Impact:**
- Runtime errors when `searchRelevantMemories` is called
- Silent failures masked by try/catch
- Violates Liskov Substitution Principle

**Recommendation:** Use proper null pattern or interface with optional implementation.

---

### 2.3 Missing Repository Pattern for Graph Operations

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/session/initializer.ts` | 17-37 |
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/context/assembler.ts` | 80-117 |

**Issue:** Raw Cypher queries embedded in business logic classes:

```typescript
// initializer.ts
const checkQuery = `MATCH (s:Session {id: $id}) RETURN s`;
const createQuery = `CREATE (s:Session { id: $id, ... }) RETURN s`;

// assembler.ts
const chainQuery = `MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(first:Thought) ...`;
const fallbackQuery = `MATCH (s:Session {id: $sessionId})-[:TRIGGERS]->(t:Thought) ...`;
```

**Impact:**
- SQL injection risk (mitigated by parameterization)
- Difficult to test business logic without graph
- Query optimization scattered across codebase
- Violates Single Responsibility Principle

---

### 2.4 Missing Event-Driven Architecture for Internal Communication

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/session/manager.ts` | 25-41 |

**Issue:** Direct synchronous calls between components instead of event emission:

```typescript
async handleInput(sessionId: string, input: string) {
  await this.initializer.ensureSession(sessionId);  // Direct call
  let engine = this.sessions.get(sessionId);
  await engine.handleInput(sessionId, input);  // Direct call
}
```

**Impact:** Tight coupling, difficult to add cross-cutting concerns (logging, metrics, tracing).

---

## 3. DRY Violations

### 3.1 Duplicated Tool Call Extraction Logic

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 45-70 |
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.test.ts` | 27-50 |

**Issue:** The `extractToolCalls` function is duplicated in the test file because it is not exported from the main module.

```typescript
// decision.ts (not exported)
function extractToolCalls(result: { toolCalls?: unknown[] }): ToolCall[] { ... }

// decision.test.ts (duplicated implementation)
function extractToolCalls(result: { toolCalls?: unknown[] }) { ... }
```

---

### 3.2 Duplicated Tool Conversion Logic

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 24-39 |
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.test.ts` | 122-135 |

**Issue:** `convertMcpToolsToAiSdk` function also duplicated in tests with slightly different implementation.

---

### 3.3 Repeated Logger Initialization Pattern

| Severity | File | Lines |
|----------|------|-------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 7 |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 11-14 |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/session/manager.ts` | 8-11 |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/session/initializer.ts` | 4-7 |

**Issue:** Same logger initialization pattern repeated 4 times:

```typescript
const logger = createNodeLogger({
  service: "control-service",
  base: { component: "xxx" },
});
```

**Recommendation:** Create a factory function or use hierarchical logger with child loggers.

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP)

| Class | Responsibilities | Violation |
|-------|-----------------|-----------|
| `DecisionEngine` | Actor management, LLM calls, tool execution, error recovery | Yes |
| `ContextAssembler` | History fetching, search, token estimation, pruning | Yes |
| `MultiMcpAdapter` | Connection management, tool aggregation, step creation | Yes |

---

### 4.2 Open/Closed Principle (OCP)

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 14-25 |

**Issue:** Adding new MCP adapters requires modifying `index.ts`:

```typescript
const wassetteAdapter = new McpToolAdapter(wassettePath, ["serve", "--stdio"]);
const executionAdapter = new McpToolAdapter("npx", ["tsx", "..."]);
multiAdapter.addAdapter(wassetteAdapter);
multiAdapter.addAdapter(executionAdapter);
```

**Recommendation:** Configuration-driven adapter registration.

---

### 4.3 Interface Segregation Principle (ISP)

| Severity | File | Lines |
|----------|------|-------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/tools/registry.ts` | 1-24 |

**Issue:** `Tool` interface combines runtime and metadata concerns:

```typescript
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema mixed with tool identity
}
```

---

### 4.4 Dependency Inversion Principle (DIP)

| Severity | File | Lines |
|----------|------|-------|
| P0 | `/Users/ccheney/Projects/the-system/apps/control/src/context/assembler.ts` | 17-24 |

**Issue:** `ContextAssembler` depends on concrete implementations:

```typescript
constructor(search: SearchRetriever | null, memory: FalkorClient) {
  this.search = search;
  this.memory = memory;
}
```

**Impact:** Cannot easily swap implementations for testing or feature flags.

**Recommendation:** Introduce interfaces:
```typescript
interface IMemoryStore { query<T>(cypher: string, params: Record<string, unknown>): Promise<T[]>; }
interface ISearchService { search(query: SearchQuery): Promise<SearchResult[]>; }
```

---

## 5. Dependency Issues

### 5.1 Unused Dependencies

| Severity | File | Package |
|----------|------|---------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/package.json` | `@ai-sdk/openai` |

**Issue:** `@ai-sdk/openai` is listed but not imported anywhere in the codebase. Only `@ai-sdk/xai` is used.

---

### 5.2 Implicit Dependency on File System Path

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 15, 20 |

**Issue:** Hardcoded paths to external binaries:

```typescript
const wassettePath = `${process.env.HOME}/.local/bin/wassette`;
const executionAdapter = new McpToolAdapter("npx", ["tsx", "../../apps/execution/src/index.ts"]);
```

**Impact:**
- Environment-specific configuration in code
- Relative paths break if working directory changes
- No validation that binaries exist

---

### 5.3 Circular Import Risk

| Severity | File | Lines |
|----------|------|-------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/session/manager.ts` | 4-6 |

**Issue:** Import chain creates potential circular dependency risk:
- `manager.ts` imports `DecisionEngine`
- `DecisionEngine` imports `ContextAssembler`
- `ContextAssembler` uses types from `@engram/storage`

Current structure is safe, but adding cross-references could create cycles.

---

## 6. Testing Gaps

### 6.1 Missing Test Files

| Missing Test | Source File | Coverage Gap |
|--------------|-------------|--------------|
| `context/assembler.test.ts` | `context/assembler.ts` | 0% |
| `state/machine.test.ts` | `state/machine.ts` | 0% |
| `engine/heartbeat.test.ts` | `engine/heartbeat.ts` | 0% |
| `tools/registry.test.ts` | `tools/registry.ts` | 0% |
| `workflows/main_loop.test.ts` | `workflows/main_loop.ts` | 0% |
| `agents/persona.test.ts` | `agents/persona.ts` | 0% |
| `index.test.ts` | `index.ts` | 0% |

**Estimated Test Coverage:** ~35% (4 of 12 source files have tests)

---

### 6.2 Test Quality Issues

| Severity | File | Issue |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.test.ts` | Tests duplicated helper functions instead of testing actual exports |
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/session/manager.test.ts` | Mock-heavy tests that don't validate real behavior |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/tools/mcp_client.test.ts` | No error path testing for connection failures |

---

### 6.3 No Integration Tests

**Issue:** No integration tests exist for:
- Full Kafka consumer flow
- Multi-adapter MCP orchestration
- State machine transitions
- Context assembly with real dependencies

---

## 7. Type Safety Issues

### 7.1 Explicit `any` Types

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 17, 47 |

```typescript
// Line 17 - eslint-disable comment indicates known issue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AiToolSet = Record<string, any>;

// Line 47 - Type assertion to workaround SDK types
execute: executeFn as typeof executeFn & (() => Promise<Record<string, unknown>>),
```

---

### 7.2 Unsafe Type Assertions

| Severity | File | Lines |
|----------|------|-------|
| P0 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 30 |
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/decision.ts` | 84, 92, 136, 145-148 |

```typescript
// index.ts:30 - Dangerous cast to bypass type system
{} as unknown as import("@engram/search-core").SearchRetriever

// decision.ts:84, 92, 136 - Repeated unsafe casts
const ctx = input as AgentContext;

// decision.ts:145-148 - Complex cast chain
const step = this.mcpAdapter.createMastraStep(call.toolName);
const executeStep = step as unknown as {
  execute: (opts: { inputData: unknown }) => Promise<unknown>;
};
```

---

### 7.3 Missing Return Types

| Severity | File | Functions |
|----------|------|-----------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/tools/mcp_client.ts` | `connect()`, `listTools()`, `createMastraStep()` |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/engine/heartbeat.ts` | `ping()`, `getStats()` |

---

### 7.4 Loose Object Types

| Severity | File | Lines |
|----------|------|-------|
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/tools/registry.ts` | 4 |
| P2 | `/Users/ccheney/Projects/the-system/apps/control/src/tools/mcp_client.ts` | 32-33 |

```typescript
// registry.ts:4
parameters: Record<string, unknown>;  // Should be proper JSON Schema type

// mcp_client.ts:32-33
const inputSchema = z.object({}).passthrough();  // Bypasses all validation
const outputSchema = z.object({}).passthrough();
```

---

## 8. Error Handling Patterns

### 8.1 Silent Error Swallowing

| Severity | File | Lines |
|----------|------|-------|
| P0 | `/Users/ccheney/Projects/the-system/apps/control/src/context/assembler.ts` | 113-116, 147-150 |

```typescript
// Line 113-116
} catch (_error) {
  // If graph query fails, return empty history
  return [];
}

// Line 147-150
} catch (_error) {
  // If search fails, return empty
  return [];
}
```

**Impact:** Failures are invisible; debugging production issues becomes difficult.

---

### 8.2 Inconsistent Error Handling

| Severity | File | Lines |
|----------|------|-------|
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/tools/mcp_client.ts` | 73-75 |
| P1 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 44-46 |

```typescript
// mcp_client.ts:73-75 - console.error instead of logger
} catch (e) {
  console.error("Failed to list tools from adapter", e);
}

// index.ts:44-46 - logger.error with different format
} catch (error) {
  logger.error({ error }, "Failed to connect to MCP Servers");
}
```

---

### 8.3 Missing Error Types

| Severity | File | Issue |
|----------|------|-------|
| P1 | All files | No custom error classes for domain-specific errors |

**Impact:** Cannot distinguish between different error types for proper handling.

**Recommendation:** Create error hierarchy:
```typescript
class ControlServiceError extends Error { }
class ToolExecutionError extends ControlServiceError { }
class ContextAssemblyError extends ControlServiceError { }
class SessionInitializationError extends ControlServiceError { }
```

---

### 8.4 Unhandled Promise in Entry Point

| Severity | File | Lines |
|----------|------|-------|
| P0 | `/Users/ccheney/Projects/the-system/apps/control/src/index.ts` | 83 |

```typescript
startConsumer().catch(console.error);
```

**Issue:** Process continues running after fatal error; no graceful shutdown.

---

## 9. Metrics Summary

### Before Refactoring

| Metric | Value |
|--------|-------|
| Total Source Files | 12 |
| Total Lines of Code | ~650 |
| Test Coverage | ~35% |
| Files with Tests | 4/12 |
| Type Assertions (`as`) | 15+ |
| Explicit `any` Types | 3 |
| Magic Numbers | 10+ |
| Hardcoded Config Values | 8+ |
| Direct Dependencies | 4 concrete classes |
| Silent Error Catches | 4 |

### Target After Refactoring

| Metric | Target |
|--------|--------|
| Test Coverage | 80%+ |
| Type Assertions | <5 |
| Explicit `any` Types | 0 |
| Cyclomatic Complexity | <10 per function |
| Dependencies | Interface-based DI |
| Error Handling | Structured with custom types |

---

## 10. Recommended Refactoring Phases

### Phase 1: Foundation (P0 Issues)
1. Fix unsafe type cast for SearchRetriever (null pattern)
2. Add proper error handling with custom error types
3. Fix unhandled promise rejection in entry point
4. Extract inline actor definitions to separate functions

### Phase 2: Architecture (P1 Issues)
1. Introduce interfaces for all external dependencies
2. Create repository layer for graph operations
3. Extract helper functions and export for testing
4. Implement configuration-driven adapter registration

### Phase 3: Quality (P2 Issues)
1. Add missing test files
2. Replace magic numbers with named constants
3. Standardize logger initialization
4. Add explicit return types to all functions

### Phase 4: Enhancement
1. Add integration tests
2. Implement proper DI container
3. Add metrics and observability
4. Create architecture documentation

---

## 11. Architecture Diagram

```
Current Architecture:
+---------------------+
|      index.ts       |  <-- Manual wiring, hardcoded paths
+---------------------+
          |
          v
+---------------------+     +---------------------+
|   SessionManager    |---->|  SessionInitializer |
+---------------------+     +---------------------+
          |                           |
          v                           v
+---------------------+     +---------------------+
|   DecisionEngine    |     |    FalkorClient     |
| (God Class)         |     | (Concrete Dep)      |
+---------------------+     +---------------------+
    |         |
    v         v
+--------+ +----------------+
| XState | | ContextAssembler|
| Actor  | | (Mixed Concerns)|
+--------+ +----------------+
```

```
Target Architecture:
+---------------------+
|   Composition Root  |  <-- DI Container, Config-driven
+---------------------+
          |
          v
+---------------------+
|   SessionManager    |
+---------------------+
          |
    +-----+-----+
    |           |
    v           v
+-------+  +----------+
| IEngine|  |ISession  |
| (Port) |  |Repository|
+-------+  +----------+
    |           |
    v           v
+----------+ +------------+
|DecisionEngine| |FalkorSession|
|(Adapter)     | |(Adapter)    |
+----------+ +------------+
```

---

## Appendix: File Index

| File | LOC | Tests | Complexity |
|------|-----|-------|------------|
| `src/index.ts` | 83 | No | Medium |
| `src/engine/decision.ts` | 193 | Partial | High |
| `src/context/assembler.ts` | 205 | No | Medium |
| `src/session/manager.ts` | 42 | Yes | Low |
| `src/session/initializer.ts` | 39 | Yes | Low |
| `src/state/machine.ts` | 158 | No | Medium |
| `src/tools/mcp_client.ts` | 95 | Yes | Medium |
| `src/tools/registry.ts` | 61 | No | Low |
| `src/engine/heartbeat.ts` | 21 | No | Low |
| `src/agents/persona.ts` | 16 | No | Low |
| `src/workflows/main_loop.ts` | 30 | No | Low |
| `src/mastra.config.ts` | 12 | No | Low |

---

*This report was generated as a READ-ONLY analysis. No code changes were made.*

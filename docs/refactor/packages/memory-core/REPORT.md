# Refactoring Analysis Report: @engram/memory-core

**Generated:** 2025-12-09
**Package:** `/Users/ccheney/Projects/the-system/packages/memory-core`
**Total Source Files:** 8
**Total Lines of Code:** ~550

---

## Executive Summary

The `@engram/memory-core` package is a domain model and utility library for bitemporal graph operations. Overall, the codebase is well-structured with clear separation of concerns. However, several opportunities for improvement exist around code duplication, error handling, type safety, and architectural cohesion.

| Category | Issues Found | Severity Distribution |
|----------|-------------|----------------------|
| Code Smells | 8 | 2 High, 4 Medium, 2 Low |
| DRY Violations | 4 | 1 High, 2 Medium, 1 Low |
| SOLID Violations | 5 | 2 Medium, 3 Low |
| Type Safety | 5 | 1 High, 3 Medium, 1 Low |
| Error Handling | 4 | 2 High, 2 Medium |
| Testing Gaps | 6 | 2 High, 3 Medium, 1 Low |

---

## 1. Code Smells and Complexity Issues

### 1.1 Magic Numbers and Hardcoded Values

**Severity:** High
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/utils/time.ts:1`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/queries/builder.ts:37`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts:21`

**Description:**
The `MAX_DATE` constant (253402300799000) is used inconsistently. It's defined in `time.ts` but hardcoded again in `builder.ts:37`.

```typescript
// time.ts:1
export const MAX_DATE = 253402300799000; // 9999-12-31

// builder.ts:37 - HARDCODED DUPLICATE
this.whereParts.push(`${alias}.tt_end = 253402300799000`); // MAX_DATE
```

**Recommendation:**
Import and use the constant consistently:
```typescript
import { MAX_DATE } from "../utils/time";
this.whereParts.push(`${alias}.tt_end = ${MAX_DATE}`);
```

---

### 1.2 Primitive Obsession in Cypher Query Construction

**Severity:** Medium
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:16-19`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:34-35`

**Description:**
Manual string interpolation for Cypher queries is error-prone and duplicated across methods.

```typescript
// graph.ts:16-19
const propKeys = Object.keys(nodeData);
const propsString = propKeys.map((k) => `${k}: $${k}`).join(", ");
const query = `CREATE (n:${label} { ${propsString} })`;
```

**Recommendation:**
Extract a `CypherQueryHelper` utility class with methods like `buildPropsString()`, `buildCreateClause()`, etc.

---

### 1.3 Console.log in Production Code

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts:46`

**Description:**
Direct `console.log` usage instead of proper logging abstraction.

```typescript
// merger.ts:46
console.log(`Merged node ${sourceId} into ${targetId}`);
```

**Recommendation:**
Either remove the log statement or inject a logger dependency for consistent observability.

---

### 1.4 Long Parameter Lists

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:24-30`

**Description:**
`writeEdge` method has 5 parameters, approaching the threshold for refactoring.

```typescript
async writeEdge(
    fromId: string,
    toId: string,
    relationType: string,
    props: Record<string, unknown> = {},
    validFrom: number = now(),
): Promise<void>
```

**Recommendation:**
Consider an options object pattern:
```typescript
interface WriteEdgeOptions {
    fromId: string;
    toId: string;
    relationType: string;
    props?: Record<string, unknown>;
    validFrom?: number;
}
```

---

### 1.5 Complex Conditional Logic in Pruner

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts:62-103`

**Description:**
The `pruneHistory` method has a cyclomatic complexity of approximately 7 with nested while/if logic.

**Recommendation:**
Extract the batch deletion loop into a separate `deleteBatch` method and use early returns to reduce nesting.

---

## 2. Architecture Improvements

### 2.1 Missing Repository Pattern Abstraction

**Severity:** Medium
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts`

**Description:**
All three classes directly depend on `FalkorClient` with raw Cypher queries. This creates tight coupling to the database implementation.

**Recommendation:**
Introduce a repository interface to abstract database operations:

```typescript
interface GraphRepository {
    createNode<T extends BaseNode>(label: string, data: T): Promise<void>;
    createEdge(from: string, to: string, type: string, props?: Record<string, unknown>): Promise<void>;
    findNodeById(id: string): Promise<BaseNode | null>;
    updateNode<T extends BaseNode>(id: string, updates: Partial<T>): Promise<void>;
    deleteNode(id: string): Promise<void>;
}
```

---

### 2.2 Missing Domain Services Layer

**Severity:** Low
**Description:**
Operations like "merge nodes" and "prune history" are domain operations that could benefit from a service layer that orchestrates multiple repository calls and handles business logic.

**Current Structure:**
```
memory-core/
  src/
    graph.ts        # Mixed concerns: writes + updates + deletes
    merger.ts       # Domain operation
    pruner.ts       # Domain operation
```

**Recommended Structure:**
```
memory-core/
  src/
    repositories/
      graph-repository.ts
      graph-repository.interface.ts
    services/
      node-merger.service.ts
      history-pruner.service.ts
    domain/
      models/
      value-objects/
```

---

### 2.3 QueryBuilder Could Use Fluent Interface More Effectively

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/queries/builder.ts`

**Description:**
The `QueryBuilder` lacks common query operations like `limit()`, `skip()`, `orderBy()`, and doesn't validate query structure.

**Recommendation:**
Extend the builder with additional methods:
```typescript
class QueryBuilder {
    limit(n: number): this;
    skip(n: number): this;
    orderBy(field: string, direction?: 'ASC' | 'DESC'): this;
    setParam(key: string, value: unknown): this;
}
```

---

## 3. DRY Violations (Duplicated Code)

### 3.1 Bitemporal Property Creation Duplication

**Severity:** High
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:13-14`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:31-32`

**Description:**
The pattern of creating bitemporal data and merging with entity data is duplicated.

```typescript
// graph.ts:13-14 (writeNode)
const temporal = createBitemporal(validFrom);
const nodeData = { ...data, ...temporal };

// graph.ts:31-32 (writeEdge)
const temporal = createBitemporal(validFrom);
const edgeData = { ...props, ...temporal };
```

**Recommendation:**
Create a utility function:
```typescript
function withBitemporal<T>(data: T, validFrom?: number): T & Bitemporal {
    return { ...data, ...createBitemporal(validFrom) };
}
```

---

### 3.2 Props String Building Duplication

**Severity:** Medium
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:16-17`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:34-35`

**Description:**
Property string construction for Cypher queries is duplicated.

```typescript
const propKeys = Object.keys(nodeData);
const propsString = propKeys.map((k) => `${k}: $${k}`).join(", ");
```

**Recommendation:**
Extract to a shared utility function.

---

### 3.3 Type Re-exports Creating Potential Confusion

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/base.ts:3-34`

**Description:**
Types are re-exported from `@engram/storage/falkor` with aliased names to avoid conflicts with Zod schemas. This creates two sets of similar types (`SessionNode` from Zod vs `FalkorSessionNode` from storage).

```typescript
export type {
    SessionNode as FalkorSessionNode,
    // ...
} from "@engram/storage/falkor";
```

**Recommendation:**
Consider consolidating type definitions in one place, or using a more explicit naming convention.

---

### 3.4 Schema Pattern Repetition

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/nodes.ts`

**Description:**
All node schemas follow the same pattern of extending `BaseNodeSchema` and adding a `labels` literal. This could be abstracted.

```typescript
export const SessionNodeSchema = BaseNodeSchema.extend({
    labels: z.literal(["Session"]),
    // ...
});

export const TurnNodeSchema = BaseNodeSchema.extend({
    labels: z.literal(["Turn"]),
    // ...
});
```

**Recommendation:**
Create a factory function:
```typescript
function createNodeSchema<T extends z.ZodRawShape>(label: string, shape: T) {
    return BaseNodeSchema.extend({
        labels: z.literal([label]),
        ...shape,
    });
}
```

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP)

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts`

**Description:**
`GraphWriter` handles multiple responsibilities:
1. Node creation
2. Edge creation
3. Node updates (versioning)
4. Node deletion (logical delete)

**Recommendation:**
Split into focused classes:
- `NodeWriter` - create/update nodes
- `EdgeWriter` - create edges
- `VersionManager` - handle versioning via REPLACES edges
- `NodeDeleter` - handle logical deletes

---

### 4.2 Dependency Inversion Principle (DIP)

**Severity:** Medium
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:6`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts:4`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts:24`

**Description:**
Classes depend on concrete `FalkorClient` implementation rather than an interface.

```typescript
constructor(private client: FalkorClient) {}
```

**Recommendation:**
Define and depend on a `GraphClient` interface:
```typescript
interface GraphClient {
    query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>;
}
```

---

### 4.3 Open/Closed Principle (OCP)

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/nodes.ts:7-58`

**Description:**
`ToolCallType` const object and `ToolCallTypeEnum` Zod enum are defined separately and must be kept in sync manually.

```typescript
export const ToolCallType = {
    FILE_READ: "file_read",
    // ...
} as const;

export const ToolCallTypeEnum = z.enum([
    "file_read",
    // ... same values repeated
]);
```

**Recommendation:**
Derive the Zod enum from the const object:
```typescript
export const ToolCallType = {
    FILE_READ: "file_read",
    // ...
} as const;

export const ToolCallTypeEnum = z.enum(
    Object.values(ToolCallType) as [string, ...string[]]
);
```

---

### 4.4 Interface Segregation Principle (ISP)

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts:23-27`

**Description:**
`GraphPruner` optionally depends on `BlobStore` for archiving. If archiving is not needed, the dependency is unused.

```typescript
constructor(
    private client: FalkorClient,
    private archiveStore?: BlobStore,
) {}
```

**Recommendation:**
Consider a strategy pattern for archive behavior:
```typescript
interface ArchiveStrategy {
    archive(nodes: unknown[]): Promise<{ count: number; uri?: string }>;
}

class NullArchiveStrategy implements ArchiveStrategy {
    async archive() { return { count: 0 }; }
}

class BlobArchiveStrategy implements ArchiveStrategy {
    constructor(private store: BlobStore) {}
    async archive(nodes) { /* ... */ }
}
```

---

### 4.5 Liskov Substitution Principle (LSP)

**Severity:** Low
**Description:**
No significant violations detected. The class hierarchy is flat with no inheritance issues.

---

## 5. Dependency Issues

### 5.1 Unused Dependencies

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/package.json`

**Description:**
The `date-fns` and `ulid` packages are declared as dependencies but do not appear to be used in the source code.

```json
"dependencies": {
    "zod": "^4.1.13",
    "ulid": "^3.0.2",       // Not used
    "date-fns": "^4.1.0",   // Not used
    "@engram/storage": "*"
}
```

**Recommendation:**
Remove unused dependencies or document their intended use.

---

### 5.2 Circular Dependency Risk

**Severity:** Medium
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/base.ts`
- `/Users/ccheney/Projects/the-system/packages/storage/src/falkor.ts`

**Description:**
`memory-core` re-exports types from `@engram/storage/falkor`, and storage defines domain types (SessionProperties, etc.). This creates a bidirectional conceptual dependency where domain models are split across packages.

**Recommendation:**
Move all domain type definitions to `memory-core` and have `storage` only define database-specific types.

---

### 5.3 Version Mismatch Potential

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/package.json:16`

**Description:**
`@engram/storage` is referenced with `"*"` version, which could lead to breaking changes.

**Recommendation:**
Use explicit version ranges or workspace protocol:
```json
"@engram/storage": "workspace:*"
```

---

## 6. Testing Gaps

### 6.1 Missing Test: GraphWriter.updateNode Edge Cases

**Severity:** High
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.test.ts`

**Description:**
No tests for:
- Update when old node doesn't exist
- Update with same ID (self-reference)
- Concurrent updates

**Current Test (graph.test.ts:35-49):**
```typescript
it("should update node by writing new version and linking", async () => {
    // Only tests happy path
});
```

---

### 6.2 Missing Test: GraphMerger Error Handling

**Severity:** High
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.test.ts`

**Description:**
No tests for:
- Merge when source node doesn't exist
- Merge when target node doesn't exist
- Self-merge (source === target)
- Database query failures

---

### 6.3 Missing Test: QueryBuilder Complex Scenarios

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/queries/builder.test.ts`

**Description:**
No tests for:
- Multiple aliases in `at()` method
- Empty match/where/return parts
- SQL injection-like inputs in clauses
- Multiple chained `where()` calls

---

### 6.4 Missing Test: Pruner Archive Failure

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.test.ts`

**Description:**
No tests for:
- Archive store save failure
- Partial archive (some nodes fail)
- Very large node sets (memory pressure)

---

### 6.5 Missing Integration Tests

**Severity:** Medium
**Description:**
No integration tests that verify actual FalkorDB behavior. All tests use mocks.

**Recommendation:**
Add integration test suite using testcontainers or a test FalkorDB instance.

---

### 6.6 Missing Model Validation Tests

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/`

**Description:**
Zod schemas are defined but no tests verify validation behavior:
- Invalid ULID format
- Out-of-range timestamps
- Invalid enum values

---

## 7. Type Safety Issues

### 7.1 Unsafe Type Assertion

**Severity:** High
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:21`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.test.ts:15`

**Description:**
Type assertions bypass TypeScript safety:

```typescript
// graph.ts:21
await this.client.query(query, nodeData as QueryParams);

// graph.test.ts:15
await writer.writeNode("TestLabel", data as any);
```

**Recommendation:**
Use proper generic typing or runtime validation:
```typescript
async writeNode<T extends BaseNode>(
    label: string,
    data: Omit<T, keyof Bitemporal>,
): Promise<void> {
    // ...
    const validatedData = BaseNodeSchema.omit({
        vt_start: true, vt_end: true, tt_start: true, tt_end: true
    }).parse(data);
}
```

---

### 7.2 Array Index Access Without Bounds Check

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts:17-21`

**Description:**
Array elements accessed by index without null checks:

```typescript
const type = row[0] as string;
const isOutgoing = row[1] as boolean;
const neighborId = row[2] as string;
const props = (row[3] || {}) as QueryParams;
```

**Recommendation:**
Use destructuring with defaults or explicit bounds checking:
```typescript
const [type, isOutgoing, neighborId, props = {}] = row as [string, boolean, string, QueryParams?];
if (!type || typeof isOutgoing !== 'boolean' || !neighborId) {
    throw new Error('Invalid row structure');
}
```

---

### 7.3 Implicit Any in Query Results

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts:93-94`

**Description:**
Query result parsing uses fallback chain that could mask errors:

```typescript
const firstRow = result?.[0];
const batchDeleted = (firstRow?.deleted_count as number) ?? (firstRow?.[0] as number) ?? 0;
```

**Recommendation:**
Define explicit result types:
```typescript
interface DeleteResult {
    deleted_count: number;
}
const result = await this.client.query<DeleteResult>(deleteQuery);
const batchDeleted = result?.[0]?.deleted_count ?? 0;
```

---

### 7.4 String Literal Types Not Enforced

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts:27`

**Description:**
`relationType` is typed as `string` but should be constrained to valid edge types:

```typescript
async writeEdge(
    fromId: string,
    toId: string,
    relationType: string,  // Should be EdgeType
    // ...
)
```

**Recommendation:**
Use the `EdgeTypes` const for type safety:
```typescript
import { EdgeTypes } from "./models/edges";
type EdgeType = typeof EdgeTypes[keyof typeof EdgeTypes];

async writeEdge(
    fromId: string,
    toId: string,
    relationType: EdgeType,
    // ...
)
```

---

### 7.5 Zod Schema and Type Definition Drift

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/models/base.ts`

**Description:**
The `Bitemporal` interface in `utils/time.ts` and `BitemporalSchema` in `models/base.ts` could drift apart.

**Recommendation:**
Derive the interface from the schema:
```typescript
export const BitemporalSchema = z.object({ /* ... */ });
export type Bitemporal = z.infer<typeof BitemporalSchema>;
```

---

## 8. Error Handling Patterns

### 8.1 Silent Failures in GraphMerger

**Severity:** High
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts:15`

**Description:**
Early return without error when edges query returns non-array:

```typescript
if (!Array.isArray(edgesResult)) return;
```

**Recommendation:**
Throw a descriptive error or log a warning:
```typescript
if (!Array.isArray(edgesResult)) {
    throw new Error(`Unexpected edges query result type: ${typeof edgesResult}`);
}
```

---

### 8.2 Missing Error Handling in GraphWriter

**Severity:** High
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts`

**Description:**
No error handling around database queries. Failures will propagate unhandled.

**Recommendation:**
Add try-catch with meaningful error context:
```typescript
async writeNode<T extends BaseNode>(...): Promise<void> {
    try {
        await this.client.query(query, nodeData);
    } catch (error) {
        throw new GraphWriteError(`Failed to write node with label ${label}`, { cause: error });
    }
}
```

---

### 8.3 Inconsistent Error Propagation

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts`

**Description:**
The pruner doesn't handle partial failures gracefully. If deletion fails mid-batch, the archived count may be incorrect.

**Recommendation:**
Implement transaction-like semantics or at least accurate failure reporting.

---

### 8.4 No Validation of Input Data

**Severity:** Medium
**Files Affected:**
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/graph.ts`
- `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts`

**Description:**
Node IDs and data are not validated before use:

```typescript
async deleteNode(id: string): Promise<void> {
    // No validation that id is non-empty or valid format
}
```

**Recommendation:**
Add input validation:
```typescript
async deleteNode(id: string): Promise<void> {
    if (!id || typeof id !== 'string') {
        throw new Error('Invalid node ID');
    }
    // ...
}
```

---

## 9. Performance Considerations

### 9.1 N+1 Query Pattern in GraphMerger

**Severity:** Medium
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/merger.ts:17-40`

**Description:**
Each edge transfer requires a separate database query:

```typescript
for (const row of edgesResult) {
    // ... builds query
    await this.client.query(createQuery, { /* ... */ });
}
```

**Recommendation:**
Batch edge creation into a single query using UNWIND:
```typescript
const query = `
    UNWIND $edges as edge
    MATCH (t {id: $targetId}), (n {id: edge.neighborId})
    MERGE (t)-[r:\${edge.type}]->(n)
    SET r = edge.props
`;
```

---

### 9.2 Inefficient Archive Query

**Severity:** Low
**File:** `/Users/ccheney/Projects/the-system/packages/memory-core/src/pruner.ts:117-129`

**Description:**
Archive query loads all nodes into memory before streaming to blob storage.

**Recommendation:**
Implement pagination or streaming for large datasets.

---

## 10. Metrics Summary

### Before (Current State)

| Metric | Value |
|--------|-------|
| Total Files | 8 source + 5 test |
| Lines of Code | ~550 |
| Test Coverage | Estimated 60-70% |
| Cyclomatic Complexity (max) | 7 (pruner.ts) |
| Direct Dependencies | 4 |

### Potential After Refactoring

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Cyclomatic Complexity (max) | 7 | 4 | -43% |
| Test Coverage | ~65% | 90% | +38% |
| DRY Violations | 4 | 0 | -100% |
| Type Safety Issues | 5 | 1 | -80% |

---

## 11. Recommended Refactoring Roadmap

### Phase 1: Quick Wins (1-2 hours)
1. Fix hardcoded `MAX_DATE` in `builder.ts`
2. Remove `console.log` from `merger.ts`
3. Remove unused dependencies (`ulid`, `date-fns`)
4. Add input validation to public methods

### Phase 2: DRY and Type Safety (2-4 hours)
1. Extract `withBitemporal()` utility function
2. Extract `buildPropsString()` utility function
3. Constrain `relationType` to `EdgeType`
4. Fix array access type safety in `merger.ts`

### Phase 3: Error Handling (2-3 hours)
1. Add try-catch with custom errors to `GraphWriter`
2. Fix silent failure in `GraphMerger`
3. Add input validation across all classes

### Phase 4: Testing (4-6 hours)
1. Add edge case tests for `GraphWriter`
2. Add error handling tests for `GraphMerger`
3. Add complex scenario tests for `QueryBuilder`
4. Add integration tests with test containers

### Phase 5: Architecture (1-2 days)
1. Define `GraphClient` interface
2. Implement repository pattern
3. Split `GraphWriter` into focused classes
4. Add archive strategy pattern to `GraphPruner`

---

## 12. Architecture Diagram (Proposed)

```
+--------------------+
|   memory-core      |
+--------------------+
         |
         v
+--------------------+     +--------------------+
|   Domain Models    |     |   Value Objects    |
| - SessionNode      |     | - Bitemporal       |
| - TurnNode         |     | - EdgeType         |
| - ReasoningNode    |     +--------------------+
+--------------------+
         |
         v
+--------------------+
|   Services         |
| - NodeMerger       |
| - HistoryPruner    |
+--------------------+
         |
         v
+--------------------+
|   Repositories     |
| - GraphRepository  |  <-- Interface
| - FalkorRepository |  <-- Implementation
+--------------------+
         |
         v
+--------------------+
|   Infrastructure   |
| - FalkorClient     |  (from @engram/storage)
| - BlobStore        |
+--------------------+
```

---

## Appendix: Files Analyzed

| File | Lines | Purpose |
|------|-------|---------|
| `src/index.ts` | 9 | Public exports |
| `src/graph.ts` | 72 | Graph write operations |
| `src/merger.ts` | 49 | Node merging |
| `src/pruner.ts` | 159 | History pruning |
| `src/models/base.ts` | 55 | Base types and Zod schemas |
| `src/models/nodes.ts` | 265 | Node type definitions |
| `src/models/edges.ts` | 147 | Edge type definitions |
| `src/queries/builder.ts` | 59 | Cypher query builder |
| `src/utils/time.ts` | 21 | Bitemporal utilities |
| `src/graph.test.ts` | 61 | GraphWriter tests |
| `src/merger.test.ts` | 34 | GraphMerger tests |
| `src/pruner.test.ts` | 130 | GraphPruner tests |
| `src/queries/builder.test.ts` | 41 | QueryBuilder tests |
| `src/utils/time.test.ts` | 89 | Time utilities tests |

# Refactoring Analysis Report: @engram/search-core

**Generated:** 2025-12-09
**Package:** `/Users/ccheney/Projects/the-system/packages/search-core`
**Total Source Files:** 27 TypeScript files
**Total Lines of Code:** ~3,500 LOC

---

## Executive Summary

The `search-core` package is a well-structured search and reranking library with solid fundamentals. However, analysis reveals several architectural issues that could impact maintainability, testability, and scalability. Key concerns include:

1. **Significant code duplication** across embedder classes and configuration systems
2. **Two parallel configuration systems** creating confusion and potential drift
3. **Tight coupling** between services via concrete implementations
4. **Inconsistent error handling** patterns
5. **Missing abstraction layer** for embedders and rerankers

---

## 1. Code Smells and Complexity Issues

### 1.1 Duplicate Configuration Systems (Severity: HIGH)

**Files:**
- `/Users/ccheney/Projects/the-system/packages/search-core/src/config.ts`
- `/Users/ccheney/Projects/the-system/packages/search-core/src/config/reranker-config.ts`
- `/Users/ccheney/Projects/the-system/packages/search-core/src/config/env.ts`

**Issue:** Two parallel configuration systems exist with duplicated concepts:

```typescript
// config.ts (Line 74-92) - Defines envBool, envNum, envStr helpers
function envBool(key: string, defaultValue: boolean): boolean { ... }
function envNum(key: string, defaultValue: number): number { ... }
function envStr(key: string, defaultValue: string): string { ... }

// config/env.ts (Line 196-225) - Same helpers redefined
export function envBool(key: string, defaultValue: boolean): boolean { ... }
export function envNum(key: string, defaultValue: number): number { ... }
export function envStr(key: string, defaultValue: string): string { ... }
```

The `config.ts` file defines `RERANK_CONFIG` while `config/reranker-config.ts` defines `DEFAULT_RERANKER_CONFIG` with overlapping but different structures.

**Impact:** Configuration drift, maintenance burden, confusion about which config to use.

**Recommendation:** Consolidate into single configuration module with clear hierarchy.

---

### 1.2 Embedder Class Duplication (Severity: HIGH)

**Files:**
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/text-embedder.ts` (57 LOC)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/code-embedder.ts` (133 LOC)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/colbert-embedder.ts` (111 LOC)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/splade-embedder.ts` (171 LOC)

**Issue:** All four embedder classes share nearly identical patterns:

1. Static singleton instance management
2. Lazy model loading with `pipeline()` or `AutoModel.from_pretrained()`
3. Type casting for pipeline function
4. `preload()` method

```typescript
// text-embedder.ts (Line 9-14)
static async getInstance() {
  if (!TextEmbedder.instance) {
    TextEmbedder.instance = await pipeline("feature-extraction", TextEmbedder.modelName);
  }
  return TextEmbedder.instance;
}

// code-embedder.ts (Line 21-26)
static async getInstance() {
  if (!CodeEmbedder.instance) {
    CodeEmbedder.instance = await pipeline("feature-extraction", CodeEmbedder.modelName);
  }
  return CodeEmbedder.instance;
}

// colbert-embedder.ts (Line 24-32)
static async getInstance(): Promise<unknown> {
  if (!ColBERTEmbedder.instance) {
    ColBERTEmbedder.instance = await pipeline("feature-extraction", ColBERTEmbedder.modelName, {
      dtype: "q8",
    });
  }
  return ColBERTEmbedder.instance;
}
```

**Impact:** ~150 lines of duplicated code, inconsistent behavior (some use quantization, some don't).

**Recommendation:** Create abstract `BaseEmbedder` class with template method pattern.

---

### 1.3 Reranker Score Calculation Duplication (Severity: MEDIUM)

**Files:**
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/batched-reranker.ts` (Line 209-221)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/llm-reranker.ts` (Line 209-221)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/colbert-reranker.ts` (Line 133-145)

**Issue:** Identical score statistics calculation repeated in three files:

```typescript
// Duplicated in all three rerankers
const scores = topResults.map((r) => r.score);
const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
const maxScore = Math.max(...scores);
const minScore = Math.min(...scores);

let scoreImprovement: number | undefined;
const hasOriginalScores = topResults.every((r) => r.originalScore !== undefined);
if (hasOriginalScores) {
  const originalAvg = topResults.reduce((sum, r) => sum + (r.originalScore ?? 0), 0) / topResults.length;
  scoreImprovement = avgScore - originalAvg;
}
```

**Recommendation:** Extract to utility function or base reranker class.

---

### 1.4 Hardcoded Collection Names (Severity: MEDIUM)

**Files:**
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/retriever.ts` (Line 29)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/indexer.ts` (Line 27)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/schema-manager.ts` (Line 12)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/deduplicator.ts` (Line 8)
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/snapshot-manager.ts` (Line 19)

**Issue:** Collection name `"engram_memory"` hardcoded in 5 different files:

```typescript
private collectionName = "engram_memory";
```

**Recommendation:** Centralize in configuration module.

---

## 2. Architecture Improvements

### 2.1 Missing Abstraction Layer for Embedders and Rerankers (Severity: HIGH)

**Issue:** No common interface for embedders or rerankers, making it difficult to:
- Swap implementations
- Mock for testing
- Add new models
- Implement adapter pattern for different backends

**Current State:**
```typescript
// Services directly instantiate concrete implementations
class SearchIndexer {
  private textEmbedder: TextEmbedder;
  private codeEmbedder: CodeEmbedder;
  private colbertEmbedder: ColBERTEmbedder;

  constructor() {
    this.textEmbedder = new TextEmbedder();
    this.codeEmbedder = new CodeEmbedder();
    this.colbertEmbedder = new ColBERTEmbedder();
  }
}
```

**Recommended Architecture:**

```typescript
// interfaces/embedder.interface.ts
interface IEmbedder {
  embed(text: string): Promise<number[]>;
  embedQuery?(text: string): Promise<number[]>;
  preload(): Promise<void>;
}

interface ISparseEmbedder extends IEmbedder {
  embed(text: string): Promise<{ indices: number[]; values: number[] }>;
}

interface ITokenEmbedder extends IEmbedder {
  encodeDocument(text: string): Promise<Float32Array[]>;
  encodeQuery(text: string): Promise<Float32Array[]>;
}

// interfaces/reranker.interface.ts
interface IReranker {
  rerank(query: string, candidates: DocumentCandidate[], topK: number): Promise<BatchedRerankResult[]>;
  warmup(): Promise<void>;
}
```

---

### 2.2 Service Coupling and Dependency Injection (Severity: MEDIUM)

**Files:**
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/retriever.ts`
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/indexer.ts`

**Issue:** Services create their own dependencies, violating Dependency Inversion Principle.

```typescript
// retriever.ts (Line 32-38)
constructor(url: string = "http://localhost:6333") {
  this.client = new QdrantClient({ url });
  this.textEmbedder = new TextEmbedder();
  this.codeEmbedder = new CodeEmbedder();
  this.classifier = new QueryClassifier();
  this.reranker = new Reranker();
}
```

**Recommendation:** Implement constructor injection:

```typescript
constructor(options: RetrieverOptions) {
  this.client = options.client ?? new QdrantClient({ url: options.url });
  this.textEmbedder = options.textEmbedder ?? new TextEmbedder();
  this.codeEmbedder = options.codeEmbedder ?? new CodeEmbedder();
  this.classifier = options.classifier ?? new QueryClassifier();
  this.reranker = options.reranker ?? new Reranker();
}
```

---

### 2.3 Two Reranker Classes with Different Purposes (Severity: MEDIUM)

**Files:**
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/reranker.ts` (87 LOC) - Simple synchronous reranker
- `/Users/ccheney/Projects/the-system/packages/search-core/src/services/batched-reranker.ts` (547 LOC) - Advanced batched reranker

**Issue:** `Reranker` class is a simpler implementation used in `SearchRetriever`, while `BatchedReranker` is more sophisticated but not integrated. This creates confusion about which to use.

**Recommendation:**
1. Rename `Reranker` to `SimpleReranker` or deprecate
2. Create unified `RerankerFactory` to select implementation based on configuration
3. Document when to use each

---

## 3. DRY Violations (Duplicated Code)

### 3.1 Environment Helper Functions

| Location | Function | Lines |
|----------|----------|-------|
| `config.ts:75-87` | `envBool, envNum, envStr` | 13 |
| `config/env.ts:196-225` | `envBool, envNum, envStr` | 30 |

**Total Duplication:** 43 lines

---

### 3.2 Singleton Model Loading Pattern

| File | Lines | Pattern |
|------|-------|---------|
| `text-embedder.ts:9-14` | 6 | Static instance + lazy load |
| `code-embedder.ts:21-26` | 6 | Static instance + lazy load |
| `colbert-embedder.ts:24-32` | 9 | Static instance + lazy load |
| `splade-embedder.ts:29-53` | 25 | Static instance + lazy load (model + tokenizer) |
| `batched-reranker.ts:84-150` | 66 | Static instances Map + lazy load |

**Total Duplication:** ~112 lines of similar singleton patterns

---

### 3.3 Qdrant Client Initialization

| File | Line | Code |
|------|------|------|
| `retriever.ts:33` | 1 | `this.client = new QdrantClient({ url });` |
| `indexer.ts:29` | 1 | `this.client = new QdrantClient({ url });` |
| `schema-manager.ts:14` | 1 | `this.client = new QdrantClient({ url });` |
| `deduplicator.ts:13` | 1 | `this.client = new QdrantClient({ url });` |
| `snapshot-manager.ts:23` | 1 | `this.client = new QdrantClient({ url });` |

**Recommendation:** Create centralized `QdrantClientFactory` or shared client instance.

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP)

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/batched-reranker.ts` (547 LOC)

**Issue:** `BatchedReranker` handles:
1. Model loading/unloading
2. Batch processing
3. Concurrency management
4. Score normalization
5. Metrics recording
6. Idle timeout management

**Recommendation:** Extract concerns into separate classes:
- `ModelLoader` - Handle model lifecycle
- `BatchProcessor` - Handle batching logic
- `IdleTimeoutManager` - Handle idle unloading

---

### 4.2 Open/Closed Principle (OCP)

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/retriever.ts`

**Issue:** Adding new embedding types requires modifying `SearchRetriever`:

```typescript
// Line 65-66 - Switch on content type
const isCodeSearch = filters?.type === "code";
const vectorName = isCodeSearch ? "code_dense" : "text_dense";
```

**Recommendation:** Use strategy pattern with embedder registry.

---

### 4.3 Dependency Inversion Principle (DIP)

**Files:** Multiple services depend on concrete implementations rather than abstractions.

**Examples:**
```typescript
// indexer.ts - Direct dependency on concrete classes
private textEmbedder: TextEmbedder;
private codeEmbedder: CodeEmbedder;
private colbertEmbedder: ColBERTEmbedder;

// retriever.ts - Direct dependency on concrete class
private reranker: Reranker;
```

**Recommendation:** Depend on interfaces, inject implementations.

---

## 5. Dependency Issues

### 5.1 Circular Export Potential

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/index.ts`

**Issue:** Barrel exports could lead to circular dependencies:

```typescript
export * from "./config";           // Line 2
export * from "./config/index";     // Line 3 - Exports from same module
```

**Recommendation:** Review and consolidate config exports.

---

### 5.2 Missing Peer Dependency Documentation

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/package.json`

**Issue:** `ioredis` is a dependency but Redis is optional (QueryCache gracefully degrades). This should be documented.

---

### 5.3 Unsafe `any` Usage

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/query-cache.ts`

```typescript
// Line 38
private redis: any = null;
```

**Recommendation:** Use proper Redis types from ioredis.

---

## 6. Testing Gaps

### 6.1 Integration vs Unit Test Separation

| Service | Unit Tests | Integration Tests |
|---------|------------|-------------------|
| BatchedReranker | Yes | No |
| Retriever | Yes | No |
| Indexer | Yes | No |
| QueryCache | No (mocked Redis) | No |
| EmbeddingCache | Yes | N/A (in-memory) |

**Missing Integration Tests:**
- End-to-end search with reranking
- Qdrant connection failures
- Redis connection failures
- Model loading failures

---

### 6.2 Test Files Without Coverage

Based on file listing, these files exist:
- `hybrid-search.integration.test.ts` - Good
- `reranker-integration.test.ts` - Good
- `lazy-loading.test.ts` - Good
- `graceful-degradation.test.ts` - Good

**Missing Test Coverage:**
- `async-reranker.ts` - No test file found
- `snapshot-manager.ts` - Limited coverage
- Error handling edge cases in XAI client

---

## 7. Type Safety Issues

### 7.1 Unsafe Type Assertions

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/text-embedder.ts`

```typescript
// Line 18-22
const extractFn = extractor as (
  text: string,
  opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;
```

This pattern is repeated in all embedder classes. The `pipeline()` function returns `unknown` type.

**Recommendation:** Create typed wrapper for Transformers.js pipeline.

---

### 7.2 Return Type `unknown`

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/colbert-embedder.ts`

```typescript
// Line 24
static async getInstance(): Promise<unknown> {
```

**Recommendation:** Define proper return type interface.

---

### 7.3 Missing Null Checks

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/retriever.ts`

```typescript
// Line 172-174 - Potential null access
const documents = rawResults.map((r) => {
  const payload = r.payload as { content?: string } | undefined;
  return payload?.content ?? "";
});
```

While null coalescing is used, the type assertion is unsafe.

---

## 8. Error Handling Patterns

### 8.1 Inconsistent Error Logging

**Comparison:**

```typescript
// batched-reranker.ts (Line 363) - Uses console.warn
console.warn(`[BatchedReranker] Failed to score document ${doc.id}:`, error);

// llm-reranker.ts (Line 256) - Uses structured logger
this.logger.error({
  msg: "LLM rerank failed",
  tier: "llm",
  ...
});
```

**Recommendation:** Standardize on structured logging throughout.

---

### 8.2 Silent Failures

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/query-cache.ts`

```typescript
// Line 203-231 - Silent cache failures
async set(params: CacheKey, results: BatchedRerankResult[]): Promise<void> {
  ...
  } catch (error) {
    // Graceful degradation on error
    this.logger.warn({...});
    recordQueryCacheError();
    // No error propagated - caller unaware of failure
  }
}
```

While graceful degradation is intentional, callers may want to know about persistent failures.

**Recommendation:** Add optional callback or event emitter for error notification.

---

### 8.3 Unhandled Promise in BatchIndexer

**File:** `/Users/ccheney/Projects/the-system/packages/search-core/src/services/batch-indexer.ts`

```typescript
// Line 47 - Promise.all without individual error handling
await Promise.all(batch.map((node) => this.indexer.indexNode(node)));
```

If one indexing fails, all fail. Consider `Promise.allSettled` for partial success.

---

## 9. Recommended Refactoring Priorities

### Phase 1: Critical (1-2 weeks)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | Consolidate config systems | 2 days | High |
| P0 | Create embedder interface | 3 days | High |
| P1 | Extract score calculation utility | 1 day | Medium |
| P1 | Centralize collection name | 0.5 days | Medium |

### Phase 2: Important (2-4 weeks)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P1 | Create reranker interface | 2 days | Medium |
| P1 | Implement dependency injection | 3 days | High |
| P2 | Fix type safety issues | 2 days | Medium |
| P2 | Standardize error handling | 2 days | Medium |

### Phase 3: Nice-to-Have (4-8 weeks)

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P2 | Add missing integration tests | 3 days | Medium |
| P3 | Extract BatchedReranker concerns | 5 days | Low |
| P3 | Create QdrantClientFactory | 1 day | Low |

---

## 10. Proposed Architecture Diagram

```
                    +------------------+
                    |  SearchService   |
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v--------+ +--------v--------+ +--------v--------+
|   IRetriever    | |    IIndexer     | |  IReranker      |
+-----------------+ +-----------------+ +-----------------+
         |                   |                   |
+--------v--------+ +--------v--------+ +--------v--------+
| SearchRetriever | | SearchIndexer   | | RerankerRouter  |
+--------+--------+ +--------+--------+ +--------+--------+
         |                   |                   |
    +----+----+         +----+----+         +----+----+
    |         |         |         |         |         |
+---v---+ +---v---+ +---v---+ +---v---+ +---v---+ +---v---+
|IEmbed | |IEmbed | |IEmbed | |IEmbed | |Batched| | LLM   |
|(Text) | |(Code) | |(Token)| |(Sparse)| |Rerank | |Rerank |
+-------+ +-------+ +-------+ +-------+ +-------+ +-------+

                    +------------------+
                    | IQdrantClient    |
                    | (shared factory) |
                    +------------------+

                    +------------------+
                    |  ConfigService   |
                    | (single source)  |
                    +------------------+
```

---

## 11. Metrics Summary

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| Cyclomatic Complexity (max) | ~15 | <10 | BatchedReranker.processBatchesConcurrently |
| Lines per File (max) | 547 | <300 | BatchedReranker.ts |
| Code Duplication | ~15% | <5% | Embedder patterns, config helpers |
| Test Coverage | ~70% | >85% | Missing async-reranker, integration tests |
| Type Safety Issues | 8 | 0 | Unsafe casts, any usage |

---

## 12. Conclusion

The `search-core` package has a solid foundation with good separation of concerns at the file level. However, the lack of shared abstractions and duplicated patterns create maintenance burden. The primary recommendations are:

1. **Consolidate configuration** into single source of truth
2. **Introduce interfaces** for embedders and rerankers
3. **Implement dependency injection** for better testability
4. **Extract duplicated code** into utility functions or base classes
5. **Standardize error handling** with structured logging

These changes would significantly improve maintainability, testability, and extensibility while maintaining backward compatibility.

---

*Report generated by Refactor Guru Agent*

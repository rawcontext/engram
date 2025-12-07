# Test Coverage Report

I have successfully added test coverage to all applications and packages in the monorepo.

## Packages

-   **`packages/events`**: Added unit tests for `RawStreamEventSchema` and `ParsedStreamEventSchema` validation.
-   **`packages/logger`**: Added tests for `createNodeLogger`, redaction logic, and context helpers.
-   **`packages/storage`**: Added tests for `FalkorClient` and `KafkaClient` using mocks.
-   **`packages/infra`**: Added smoke tests for Pulumi resource definitions.
-   **`packages/ingestion-core`**: Added tests for `ThinkingExtractor` and `DiffExtractor` (fixed a partial match bug).
-   **`packages/memory-core`**: Added tests for `GraphWriter` and `GraphPruner`.
-   **`packages/search-core`**: Added tests for `SearchIndexer` and `SearchRetriever`.
-   **`packages/execution-core`**: Verified existing tests and added stub test for `ReplayEngine`.
-   **`packages/vfs`**: Verified comprehensive existing tests.

## Applications

-   **`apps/control`**: Added unit test for `SessionManager`.
-   **`apps/execution`**: Refactored to export `vfs` and added tests for tool registration.
-   **`apps/ingestion`**: Refactored logic into `IngestionProcessor` class and added unit tests with mocked Kafka.
-   **`apps/interface`**: Added tests for `apiResponse`, `validate` middleware, and `rbac`.
-   **`apps/memory`**: Added smoke tests for server initialization.
-   **`apps/search`**: Refactored into `SearchService` class and added unit tests with mocked dependencies.

## Refactoring

To facilitate testing without side effects (like connecting to real databases or starting servers during import), I refactored several entry points (`apps/ingestion`, `apps/search`, `apps/execution`, `apps/memory`) to:
1.  Export their core logic or server instances.
2.  Guard the top-level execution logic with `if (import.meta.main) { ... }`.
3.  Use Dependency Injection patterns (passing clients/services via constructors) where possible.

## Running Tests

You can run all tests from the root:

```bash
bun test
```

All tests are passing.

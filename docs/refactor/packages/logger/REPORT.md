# Refactoring Analysis: @engram/logger

**Analysis Date**: 2025-12-09
**Package Path**: `/Users/ccheney/Projects/the-system/packages/logger`
**Total Files Analyzed**: 7 source files (5 implementation + 2 test files)
**Total Lines of Code**: ~350 LOC

---

## Executive Summary

The `@engram/logger` package is a well-structured logging abstraction built on top of Pino. The codebase is relatively clean with good separation of concerns across files. However, there are several refactoring opportunities to improve maintainability, type safety, and adherence to SOLID principles.

**Overall Health Score**: 7/10

---

## 1. Code Smells and Complexity Issues

### 1.1 Browser Logger Event Listener Memory Leak Potential

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 105-114 |

**Issue**: Event listeners are added to `window` but never removed. Each call to `createBrowserLogger()` adds new event listeners without cleanup, leading to potential memory leaks if loggers are created/destroyed frequently.

```typescript
// Current: No cleanup mechanism
if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        flush();
    });
    window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            flush();
        }
    });
}
```

**Recommendation**: Return a cleanup function or implement a dispose pattern.

---

### 1.2 Closure-Based State in Browser Logger

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 26-64 |

**Issue**: The `logBuffer` and `flushTimer` are captured in closures but have no external visibility. This makes testing the flush behavior difficult and prevents inspection of buffered logs.

---

### 1.3 Hardcoded Cloud Logging Severity Map

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 50-57 |

**Issue**: The severity map for Cloud Logging is hardcoded inside the formatter. This couples the logger to Google Cloud Logging format.

```typescript
const severityMap: Record<string, string> = {
    trace: "DEBUG",
    debug: "DEBUG",
    info: "INFO",
    warn: "WARNING",
    error: "ERROR",
    fatal: "CRITICAL",
};
```

**Recommendation**: Extract to a configurable constant or allow injection for multi-cloud support.

---

## 2. Architecture Improvements

### 2.1 Missing Abstract Logger Interface

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/types.ts` | Lines 1-64 |

**Issue**: Both `createBrowserLogger` and `createNodeLogger` return `Logger` (Pino type), but there's no abstract factory pattern. The package exports two different factory functions without a unified creation strategy.

**Current State**:
```typescript
export type Logger = PinoLogger;  // Direct Pino dependency
```

**Recommendation**: Implement a Factory pattern with environment detection:
```typescript
interface LoggerFactory {
    create(options: LoggerOptions): Logger;
}
```

---

### 2.2 Missing Singleton/Registry Pattern

| Severity | File | Location |
|----------|------|----------|
| **Low** | Package-wide | N/A |

**Issue**: Each call to `createNodeLogger()` or `createBrowserLogger()` creates a new logger instance. There's no built-in mechanism to reuse loggers by service name, which can lead to:
- Multiple logger instances for the same service
- Inconsistent configuration across instances
- Difficulty in changing log levels at runtime

**Recommendation**: Consider a logger registry pattern for singleton access by service name.

---

### 2.3 Context Helper Functions Should Be Methods

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 97-133 |

**Issue**: `withTraceContext` and `withTenantContext` are standalone functions that require passing the logger as the first argument. This is a procedural pattern that doesn't leverage object-oriented composition.

**Current**:
```typescript
const traced = withTraceContext(logger, { traceId: "123" });
const tenanted = withTenantContext(traced, { tenantId: "abc" });
```

**Alternative Pattern**: Method chaining or wrapper class.

---

## 3. DRY Violations (Duplicated Code)

### 3.1 Repeated Console Method Mapping in Browser Logger

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 72-96 |

**Issue**: The browser transport write handlers are nearly identical, differing only in the console method called.

```typescript
write: {
    trace: (o) => {
        console.debug(o);
        addToBuffer(o as Record<string, unknown>);
    },
    debug: (o) => {
        console.debug(o);
        addToBuffer(o as Record<string, unknown>);
    },
    info: (o) => {
        console.info(o);
        addToBuffer(o as Record<string, unknown>);
    },
    // ... repeated pattern for warn, error, fatal
}
```

**Recommendation**: Create a factory function:
```typescript
const createWriter = (consoleMethod: keyof Console) => (o: object) => {
    console[consoleMethod](o);
    addToBuffer(o as Record<string, unknown>);
};
```

---

### 3.2 Repeated Conditional Spread Pattern in Context Helpers

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 111-132 |

**Issue**: Both `withTraceContext` and `withTenantContext` use the same conditional spread pattern for optional fields.

```typescript
// Pattern repeated 8 times across both functions
...(trace.correlationId && { correlation_id: trace.correlationId }),
...(trace.traceId && { trace_id: trace.traceId }),
// etc.
```

**Recommendation**: Create a utility function for snake_case transformation with optional filtering:
```typescript
function toSnakeCaseContext<T extends Record<string, unknown>>(
    context: T,
    keyMap: Record<keyof T, string>
): Record<string, unknown>
```

---

## 4. SOLID Principle Violations

### 4.1 Single Responsibility Principle (SRP) - Browser Logger

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 1-117 |

**Issue**: `createBrowserLogger` handles multiple responsibilities:
1. Logger creation and configuration
2. Log buffering logic
3. HTTP transport/flushing
4. Browser event binding

**Recommendation**: Extract into separate concerns:
- `LogBuffer` class for buffering logic
- `HttpLogTransport` class for network operations
- `BrowserLifecycleHandler` for event binding

---

### 4.2 Open/Closed Principle (OCP) - Transport Configuration

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 37-46 |

**Issue**: The HTTP transport endpoint and method are hardcoded. Adding support for different backends (WebSocket, custom protocols) would require modifying the function.

```typescript
await fetch(logEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // ...
});
```

**Recommendation**: Accept a transport interface:
```typescript
interface LogTransport {
    send(logs: LogEntry[]): Promise<void>;
}
```

---

### 4.3 Interface Segregation Principle (ISP) - BrowserLoggerOptions

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/types.ts` | Lines 46-61 |

**Issue**: `BrowserLoggerOptions` mixes logging concerns with transport concerns. A client who just wants console logging must still see `forwardToBackend`, `logEndpoint`, `batchSize`, `flushInterval`.

**Recommendation**: Separate into:
```typescript
interface BrowserLoggerOptions { ... }
interface BrowserTransportOptions { ... }
```

---

### 4.4 Dependency Inversion Principle (DIP)

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/types.ts` | Line 63 |

**Issue**: `Logger` type is directly aliased to `PinoLogger`, creating tight coupling to Pino throughout the codebase.

```typescript
export type Logger = PinoLogger;
```

**Recommendation**: Define an abstract `Logger` interface that Pino happens to implement, allowing future migration to other logging backends.

---

## 5. Dependency Issues

### 5.1 Direct Pino Dependency Exposure

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/index.ts` | Line 9 |

**Issue**: The package re-exports `pino` directly, leaking internal implementation details.

```typescript
export { pino };
```

**Recommendation**: Either:
- Remove direct pino export if not needed by consumers
- Document clearly why direct access is necessary
- Create abstraction wrappers for commonly used Pino utilities

---

### 5.2 Environment Variable Coupling

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 22-24 |
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 16-19 |

**Issue**: Direct access to `process.env.NODE_ENV` and `process.env.npm_package_version` couples the logger to Node.js environment semantics.

**Recommendation**: Accept environment configuration via options or a separate config provider.

---

### 5.3 pino-pretty as Runtime Dependency

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/package.json` | Line 14 |

**Issue**: `pino-pretty` is listed as a regular dependency rather than a dev/optional dependency, but it's only used in development mode (`pretty = environment === "development"`).

```json
"dependencies": {
    "pino": "^10.1.0",
    "pino-pretty": "^13.1.3"  // Only used in dev
}
```

**Recommendation**: Move to `optionalDependencies` or `devDependencies` and handle graceful fallback.

---

## 6. Testing Gaps

### 6.1 Missing Tests for Error Scenarios

| Severity | File | Location |
|----------|------|----------|
| **High** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.test.ts` | N/A |

**Missing Test Cases**:
- Network failure handling when flush fails
- Buffer overflow when network is slow
- Invalid log endpoint configuration
- Malformed log data handling

---

### 6.2 No Integration Tests for Actual Pino Behavior

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.test.ts` | Lines 4-41 |

**Issue**: The browser tests extensively mock Pino, meaning actual Pino behavior is not tested. The mock implementation may diverge from real Pino behavior.

```typescript
vi.mock("pino", () => {
    const pinoMock = (options: any) => {
        // Custom mock that may not match real Pino
    };
});
```

**Recommendation**: Add integration tests that use real Pino instance with captured output.

---

### 6.3 Missing Tests for Redaction

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/index.test.ts` | Lines 7-40 |

**Issue**: Redaction path merging is tested, but actual redaction behavior is not verified. No tests confirm that logging `{ password: "secret" }` actually produces `[REDACTED]`.

---

### 6.4 No Tests for Event Listener Cleanup

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.test.ts` | N/A |

**Missing**: Tests for `beforeunload` and `visibilitychange` event handlers.

---

### 6.5 Timer/Flush Tests May Be Flaky

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.test.ts` | Lines 83-109 |

**Issue**: Test relies on `setTimeout(resolve, 0)` to wait for async operations. This can be flaky depending on event loop timing.

```typescript
await new Promise((resolve) => setTimeout(resolve, 0));
expect(mockFetch).toHaveBeenCalled();
```

**Recommendation**: Use `vi.useFakeTimers()` for deterministic timer testing.

---

## 7. Type Safety Issues

### 7.1 Type Assertion in Legacy Shim

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/index.ts` | Line 25 |

**Issue**: Unsafe type assertion bypasses TypeScript checks.

```typescript
level: (options.level as any) || "info",
```

**Recommendation**: Properly type the conversion or validate the level:
```typescript
const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
level: validLevels.includes(options.level as any) ? options.level as LogLevel : 'info',
```

---

### 7.2 Record<string, unknown> Type Erosion

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 57-64 |
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 100, 127 |

**Issue**: Context parameters accept `Record<string, unknown>`, losing type information about expected keys.

**Recommendation**: Use generics with constraints for better type inference.

---

### 7.3 Missing Type Guards for Optional Fields

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 111-132 |

**Issue**: The truthy check pattern `trace.correlationId && { ... }` doesn't distinguish between `undefined` and empty string `""`.

```typescript
...(trace.correlationId && { correlation_id: trace.correlationId }),
```

**Recommendation**: Use explicit undefined check: `trace.correlationId !== undefined`.

---

## 8. Error Handling Patterns

### 8.1 Silent Error Swallowing in Browser Flush

| Severity | File | Location |
|----------|------|----------|
| **High** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 44-46 |

**Issue**: Network errors during log flushing are silently swallowed with no feedback mechanism.

```typescript
try {
    await fetch(logEndpoint, { ... });
} catch {
    // Silently fail - don't log about logging failures
}
```

**Problems**:
- No way to detect persistent logging failures
- Lost logs with no recovery mechanism
- No metrics/alerts for logging infrastructure issues

**Recommendation**:
- Add optional error callback
- Implement retry with exponential backoff
- Store failed logs in localStorage for recovery
- Emit custom events for monitoring

---

### 8.2 No Validation of Logger Options

| Severity | File | Location |
|----------|------|----------|
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/node.ts` | Lines 15-28 |
| **Medium** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 13-24 |

**Issue**: No validation of options. Invalid configurations fail silently or produce unclear Pino errors.

**Missing Validations**:
- `service` name format (non-empty, valid characters)
- `level` is a valid log level
- `batchSize` > 0
- `flushInterval` > 0
- `logEndpoint` is a valid URL

---

### 8.3 No Graceful Degradation

| Severity | File | Location |
|----------|------|----------|
| **Low** | `/Users/ccheney/Projects/the-system/packages/logger/src/browser.ts` | Lines 105-114 |

**Issue**: If `window` is undefined (SSR context), the logger works but silently skips event binding. No indication to developer that flush-on-unload is disabled.

---

## Summary of Issues by Severity

| Severity | Count | Categories |
|----------|-------|------------|
| **High** | 2 | Testing gaps, Error handling |
| **Medium** | 10 | Architecture, DRY, SOLID, Type safety, Dependencies |
| **Low** | 11 | Code smells, Minor improvements |

---

## Recommended Refactoring Roadmap

### Phase 1: Critical Fixes (Priority: High)
1. Add error callback mechanism for browser flush failures
2. Add integration tests for actual redaction behavior
3. Add tests for network failure scenarios
4. Fix type assertion in legacy shim

### Phase 2: Architecture Improvements (Priority: Medium)
1. Extract `LogBuffer` and `HttpTransport` classes from browser logger
2. Implement cleanup/dispose pattern for event listeners
3. Add options validation with helpful error messages
4. Extract Cloud Logging severity map to configurable constant

### Phase 3: Polish and Enhancement (Priority: Low)
1. Refactor DRY violations (console method mapping, context helpers)
2. Consider logger registry pattern for singleton access
3. Move pino-pretty to optional dependency
4. Add method chaining for context helpers
5. Define abstract Logger interface for DIP compliance

---

## Metrics Summary

| Metric | Current Value | Target | Notes |
|--------|---------------|--------|-------|
| Cyclomatic Complexity | Low (~3-5) | < 10 | Within acceptable range |
| Lines of Code | ~350 | N/A | Appropriately sized |
| Test Coverage | ~60% (estimated) | > 80% | Missing error/edge cases |
| Dependencies | 2 runtime | 1-2 | Consider pino-pretty as optional |
| Type Safety | Moderate | High | Several `any` casts to address |

---

## Architecture Diagram (Current)

```
+-------------------+     +-------------------+
|     index.ts      |     |     types.ts      |
|  (Entry point,    |<----|  (Type defs,      |
|   legacy shim)    |     |   interfaces)     |
+-------------------+     +-------------------+
         |
         v
+-------------------+     +-------------------+
|     node.ts       |     |    browser.ts     |
|  (Node/Bun        |     |  (Browser logger  |
|   logger)         |     |   + transport)    |
+-------------------+     +-------------------+
         |                         |
         v                         v
+-------------------+     +-------------------+
|   redaction.ts    |     |      pino         |
|  (Redact paths)   |     |  (External lib)   |
+-------------------+     +-------------------+
```

---

*Report generated by Refactor Guru Agent*

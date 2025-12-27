# @engram/logger

Structured logging built on Pino with lifecycle management, PII redaction, and Cloud Logging compatibility.

## Purpose

Provides consistent structured logging for Node.js/Bun environments in the Engram monorepo:
- **Cloud Logging compatibility** - Uppercase severity levels and ISO timestamps for GCP
- **PII redaction** - Automatic redaction of sensitive fields (passwords, tokens, email, SSN, credit cards)
- **Lifecycle management** - Safe logger destruction to prevent race conditions and post-destroy logging
- **Context propagation** - Tenant and trace context helpers for distributed tracing
- **Environment-aware** - Pretty printing in development, structured JSON in production

## Pino Integration

Built on Pino (v10.1.0), a fast, low-overhead logging library with custom formatters for Cloud Logging severity mapping, ISO timestamps, built-in redaction, and transport system for pretty printing in development.

## Quick Start

```typescript
import { createNodeLogger } from "@engram/logger";

const logger = createNodeLogger({
  service: "memory",
  level: "info",
});

logger.info("Service started");
logger.error({ err }, "Operation failed");

// Child logger with context
const reqLogger = logger.child({ requestId: "abc-123" });
reqLogger.info("Processing request");
```

## Configuration

```typescript
const logger = createNodeLogger({
  service: "my-service",              // Required: Service name
  level: "debug",                     // Optional: Log level (default: "info")
  environment: "production",          // Optional: Environment (default: NODE_ENV)
  version: "1.0.0",                  // Optional: Service version
  pretty: false,                      // Optional: Pretty print (default: true in dev)
  redactPaths: ["custom.secret"],    // Optional: Additional redaction paths
  base: { region: "us-west" },       // Optional: Base context for all logs
});
```

## Context Helpers

```typescript
import { withTenantContext, withTraceContext } from "@engram/logger";

// Add tenant context (tenantId, campaignId, adminUserId, externalUserId)
const tenantLogger = withTenantContext(logger, { tenantId: "tenant-1" });

// Add trace context for distributed tracing (traceId, spanId, requestId, correlationId)
const traceLogger = withTraceContext(logger, { traceId: "trace-123", spanId: "span-456" });
```

## Lifecycle Management

```typescript
// Graceful shutdown - destroy() marks logger as destroyed
logger.destroy?.();
// Logs after destroy are silently dropped (no errors)
```

## PII Redaction

Automatically redacts 40+ sensitive field paths (authorization headers, cookies, passwords, tokens, API keys, email, phone, SSN, credit cards). Add custom paths via `redactPaths` option.

```typescript
const logger = createNodeLogger({
  service: "my-service",
  redactPaths: ["custom.secret", "my.token"], // Merged with DEFAULT_REDACT_PATHS
});
```

## Exported API

**Functions:**
- `createNodeLogger(options)` - Create Node.js logger with lifecycle management
- `withTenantContext(logger, tenant)` - Add tenant context (tenantId, campaignId, etc.)
- `withTraceContext(logger, trace)` - Add trace context (traceId, spanId, etc.)
- `mergeRedactPaths(customPaths)` - Merge custom paths with defaults

**Types:** `Logger`, `LifecycleLogger`, `NodeLoggerOptions`, `LogLevel`, `TraceContext`, `TenantContext`

**Constants:** `DEFAULT_REDACT_PATHS`

**Re-exports:** `pino` (direct Pino access)

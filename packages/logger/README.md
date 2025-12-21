# @engram/logger

Structured logging built on Pino with lifecycle management, PII redaction, and Cloud Logging compatibility.

## Overview

Provides consistent structured logging for Node.js/Bun environments with:
- **Cloud Logging compatibility** - Uppercase severity levels and ISO timestamps
- **PII redaction** - Automatic redaction of sensitive fields (passwords, tokens, email, etc.)
- **Lifecycle management** - Safe logger destruction to prevent race conditions
- **Context propagation** - Tenant and trace context helpers
- **Environment-aware** - Pretty printing in development, structured JSON in production

## Installation

```bash
npm install @engram/logger
```

## Usage

### Basic Logger

```typescript
import { createNodeLogger } from "@engram/logger";

const logger = createNodeLogger({
  service: "memory",
  level: "info",
});

logger.info("Service started");
logger.error({ err }, "Operation failed");

// Create child logger with additional context
const requestLogger = logger.child({ component: "request-handler", requestId: "abc-123" });
requestLogger.info("Processing request");
```

### Configuration Options

```typescript
import { createNodeLogger } from "@engram/logger";

const logger = createNodeLogger({
  // Required: Service name for all logs
  service: "my-service",

  // Optional: Log level (default: "info")
  level: "debug",

  // Optional: Environment name (default: NODE_ENV or "development")
  environment: "production",

  // Optional: Service version (default: npm_package_version)
  version: "1.0.0",

  // Optional: Enable pretty printing (default: true in development)
  pretty: false,

  // Optional: Additional redaction paths beyond defaults
  redactPaths: ["custom.secret", "my.sensitive.field"],

  // Optional: Base context included in all logs
  base: { component: "api", region: "us-west" },

  // Optional: Custom Pino options
  pinoOptions: { name: "custom-logger-name" },
});
```

### Context Helpers

```typescript
import { withTenantContext, withTraceContext } from "@engram/logger";

// Add tenant context
const tenantLogger = withTenantContext(logger, {
  tenantId: "tenant-1",
  campaignId: "campaign-123",
  adminUserId: "admin-456",
  externalUserId: "user-789",
});

// Add trace context
const traceLogger = withTraceContext(logger, {
  correlationId: "corr-001",
  traceId: "trace-123",
  spanId: "span-456",
  requestId: "req-789",
});
```

### Lifecycle Management

```typescript
const logger = createNodeLogger({ service: "my-service" });

// Use logger normally
logger.info("Processing...");

// When shutting down, destroy the logger
logger.destroy?.();

// Logs after destroy are silently dropped (no errors thrown)
logger.info("This won't be logged");
```

### Custom Redaction

```typescript
import { DEFAULT_REDACT_PATHS, mergeRedactPaths } from "@engram/logger";

// View default redaction paths
console.log(DEFAULT_REDACT_PATHS);

// Merge custom paths with defaults
const allPaths = mergeRedactPaths(["my.secret", "custom.token"]);

// Use in logger
const logger = createNodeLogger({
  service: "my-service",
  redactPaths: ["my.secret", "custom.token"],
});
```

### Direct Pino Access

```typescript
import { pino } from "@engram/logger";

// Use Pino directly for advanced configuration
const customLogger = pino({
  level: "debug",
  transport: {
    target: "pino-pretty",
  },
});
```

### Legacy Compatibility

```typescript
import { createLogger } from "@engram/logger";

// Legacy API (backward compatible)
const logger = createLogger({
  level: "info",
  component: "my-component",
});
```

## Features

### Cloud Logging Compatibility

Logs are formatted for Google Cloud Logging with:
- Uppercase severity levels (DEBUG, INFO, WARNING, ERROR)
- ISO timestamps
- Service, environment, and version in bindings
- Structured JSON output in production

### PII Redaction

Automatically redacts sensitive fields including:
- Authorization headers and cookies
- Passwords, tokens, API keys
- Email addresses, phone numbers, SSN
- Credit card numbers
- Custom paths via `redactPaths` option

Default redacted paths:
- `req.headers.authorization`
- `req.headers.cookie`
- `req.body.password`
- `req.body.token`
- `*.email`
- `*.phone`
- And many more (see `DEFAULT_REDACT_PATHS`)

### Lifecycle Management

Prevents race conditions and post-destroy logging:
- `flush()` - Flush pending logs
- `destroy()` - Mark logger as destroyed
- All log methods silently drop logs after destroy
- Safe concurrent flush/destroy handling

## Exported API

### Functions

- `createNodeLogger(options: NodeLoggerOptions, destination?: DestinationStream): LifecycleLogger` - Create a Node.js logger
- `withTenantContext(logger: Logger, tenant: TenantContext): Logger` - Add tenant context
- `withTraceContext(logger: Logger, trace: TraceContext): Logger` - Add trace context
- `mergeRedactPaths(customPaths?: readonly string[]): readonly string[]` - Merge custom redaction paths
- `createLogger(options?: LegacyLoggerOptions): Logger` - Legacy API (backward compatible)

### Types

- `Logger` - Pino logger instance
- `LifecycleLogger` - Logger with `destroy()` method
- `NodeLoggerOptions` - Configuration for Node.js logger
- `LogLevel` - `"debug" | "info" | "warn" | "error"`
- `TraceContext` - Trace context fields (traceId, spanId, correlationId, requestId)
- `TenantContext` - Tenant context fields (tenantId, campaignId, adminUserId, externalUserId)
- `BaseLogContext` - Base context fields (service, component, environment, version)

### Constants

- `DEFAULT_REDACT_PATHS` - Default PII redaction paths

### Re-exports

- `pino` - Direct access to Pino library

## Log Levels

| Level | Severity | Use Case |
|:------|:---------|:---------|
| `debug` | DEBUG | Debug information |
| `info` | INFO | Normal operations |
| `warn` | WARNING | Warning conditions |
| `error` | ERROR | Error conditions |

## Dependencies

- **pino** (^10.1.0) - Fast, low-overhead logging library
- **pino-pretty** (^13.1.3) - Pretty printing for development

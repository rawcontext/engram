# @engram/logger

Structured logging built on Pino.

## Overview

Provides consistent structured logging with support for tenant isolation and trace context propagation for Node.js environments.

## Installation

```bash
npm install @engram/logger
```

## Usage

### Node.js

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

### Context Helpers

```typescript
import { withTenantContext, withTraceContext } from "@engram/logger";

// Add tenant context
const tenantLogger = withTenantContext(logger, { tenantId: "tenant-1" });

// Add trace context
const traceLogger = withTraceContext(logger, {
  traceId: "trace-123",
  spanId: "span-456",
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

## Log Levels

| Level | Use Case |
|:------|:---------|
| `error` | Error conditions |
| `warn` | Warning conditions |
| `info` | Normal operations |
| `debug` | Debug information |

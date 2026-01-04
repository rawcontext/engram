# @engram/telemetry

OpenTelemetry instrumentation package for Engram services.

## Features

- **Tracer Provider**: Initialize OpenTelemetry SDK with OTLP and console exporters
- **HTTP Middleware**: Automatic tracing for Hono framework
- **Client Instrumentation**: Tracing for FalkorDB, NATS, PostgreSQL, Qdrant
- **MCP Tool Tracing**: Trace MCP tool invocations
- **WebSocket Tracing**: Trace WebSocket connection lifecycle
- **Background Job Tracing**: Trace scheduled tasks and background jobs

## Installation

```bash
bun add @engram/telemetry
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OTEL_ENABLED` | Enable/disable tracing | `true` |
| `OTEL_SERVICE_NAME` | Service name for resource attributes | `"unknown-service"` |
| `OTEL_SERVICE_VERSION` | Service version | - |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP exporter endpoint | - |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | OTLP traces endpoint (overrides above) | - |
| `OTEL_CONSOLE_EXPORTER` | Enable console exporter | `false` (auto-enabled if no OTLP endpoint) |

## Usage

### Initialize Tracing

```typescript
import { initTracing, loadTelemetryConfig } from '@engram/telemetry';

const config = loadTelemetryConfig({
  serviceName: 'engram-api',
  serviceVersion: '0.0.1',
});

initTracing(config);
```

### HTTP Middleware (Hono)

```typescript
import { Hono } from 'hono';
import { tracingMiddleware } from '@engram/telemetry';

const app = new Hono();
app.use('*', tracingMiddleware());
```

### Database Operations

```typescript
import { traceDbOperation } from '@engram/telemetry';

await traceDbOperation('query', 'falkordb', cypherQuery, async () => {
  return await graph.query(cypherQuery);
});
```

### NATS Operations

```typescript
import { traceNatsOperation } from '@engram/telemetry';

await traceNatsOperation('publish', subject, async () => {
  return await nats.publish(subject, data);
});
```

### MCP Tool Invocations

```typescript
import { traceMcpTool } from '@engram/telemetry';

await traceMcpTool('remember', { content, type }, async () => {
  return await mcpClient.remember(content, type);
});
```

### WebSocket Connections

```typescript
import { traceWebSocket } from '@engram/telemetry';

await traceWebSocket('connect', sessionId, async () => {
  return await ws.connect(sessionId);
});
```

### Background Jobs

```typescript
import { traceJob } from '@engram/telemetry';

await traceJob('graph-pruning', async () => {
  return await pruner.pruneHistory();
});
```

### Manual Spans

```typescript
import { withSpan } from '@engram/telemetry';

const result = await withSpan('my-operation', async (span) => {
  span.setAttribute('custom.attribute', 'value');
  return await doWork();
});
```

### Graceful Shutdown

```typescript
import { shutdownTracing } from '@engram/telemetry';

process.on('SIGTERM', async () => {
  await shutdownTracing();
  process.exit(0);
});
```

## Semantic Conventions

This package follows OpenTelemetry semantic conventions:

- **HTTP**: `http.method`, `http.url`, `http.status_code`, `http.route`
- **Database**: `db.system`, `db.operation`, `db.statement`
- **Messaging**: `messaging.system`, `messaging.operation`, `messaging.destination`
- **WebSocket**: `websocket.action`, `session.id`
- **Tenant**: `tenant.org_id`, `tenant.org_slug`
- **User**: `user.id`

## Local Development

By default, if `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, traces are exported to console (stdout). This is useful for local development.

## Production

For production, set `OTEL_EXPORTER_OTLP_ENDPOINT` to your OTLP collector endpoint:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

Or disable tracing entirely:

```bash
export OTEL_ENABLED=false
```

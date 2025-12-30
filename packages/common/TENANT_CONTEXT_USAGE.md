# Tenant Context Runtime Usage

This guide explains how to use the AsyncLocalStorage-based tenant context runtime for request-scoped tenant isolation.

## Overview

The tenant context runtime provides three main functions:

1. **`runWithTenantContext(context, fn)`** - Establishes tenant context for async operations
2. **`getTenantContext()`** - Retrieves current tenant context (throws if not available)
3. **`tryGetTenantContext()`** - Retrieves current tenant context (returns undefined if not available)

## Basic Usage

### In Middleware (Hono Example)

```typescript
import { auth } from "./middleware/auth";
import { runWithTenantContext, createTenantContext } from "@engram/common";
import { Hono } from "hono";

const app = new Hono();

// Apply auth middleware
app.use("*", auth({ logger, oauthTokenRepo }));

// Wrap handler with tenant context
app.post("/api/resource", async (c) => {
  const authContext = c.get("auth");
  const tenantContext = createTenantContext(authContext);

  return runWithTenantContext(tenantContext, async () => {
    // Your handler logic here - tenant context is available
    // to all nested functions without passing it explicitly
    return await processRequest(c);
  });
});
```

### In Nested Functions

Once `runWithTenantContext` is established, any nested function can access the context:

```typescript
import { getTenantContext, getTenantGraphName } from "@engram/common";

async function queryUserData(userId: string) {
  // Access tenant context without it being passed as parameter
  const ctx = getTenantContext();

  // Use tenant context to determine which graph to query
  const graphName = getTenantGraphName(ctx);

  // Query tenant-specific graph
  return await db.query(graphName, `MATCH (u:User {id: $userId})`, { userId });
}

async function processRequest(c: Context) {
  const userId = c.req.param("userId");

  // This function doesn't need to pass tenant context down
  // because getTenantContext() retrieves it from AsyncLocalStorage
  const data = await queryUserData(userId);

  return c.json(data);
}
```

### Optional Tenant Context

For operations that may or may not be tenant-scoped:

```typescript
import { tryGetTenantContext } from "@engram/common";

function logOperation(operation: string) {
  const ctx = tryGetTenantContext();

  if (ctx) {
    // Tenant-scoped logging
    logger.info({ orgId: ctx.orgId, operation }, "Tenant operation");
  } else {
    // Global logging
    logger.info({ operation }, "Global operation");
  }
}
```

## Complete Middleware Example

Here's how to integrate tenant context into Hono middleware:

```typescript
import {
  runWithTenantContext,
  createTenantContext,
  getTenantContext
} from "@engram/common";
import type { Context, Next } from "hono";

export function tenantContextMiddleware() {
  return async (c: Context, next: Next) => {
    // Auth middleware must run before this
    const auth = c.get("auth");

    if (!auth) {
      throw new Error("Auth context required before tenant context");
    }

    // Create tenant context from auth
    const tenantContext = createTenantContext(auth);

    // Run the rest of the request in tenant context scope
    await runWithTenantContext(tenantContext, async () => {
      await next();
    });
  };
}

// Usage
app.use("*", auth({ ... }));
app.use("*", tenantContextMiddleware());

app.get("/api/data", async (c) => {
  // Tenant context is automatically available
  const ctx = getTenantContext();
  const graphName = getTenantGraphName(ctx);

  const data = await fetchData(graphName);
  return c.json(data);
});
```

## Context Isolation

AsyncLocalStorage ensures that concurrent requests maintain isolated contexts:

```typescript
// Request 1: User from org-1 accesses /api/resource
// Request 2: User from org-2 accesses /api/resource (concurrent)

// Both requests run simultaneously but getTenantContext()
// returns the correct context for each request's call stack
```

## Error Handling

```typescript
import { getTenantContext, TenantContextError } from "@engram/common";

function someFunction() {
  try {
    const ctx = getTenantContext();
    // Use context
  } catch (error) {
    if (error instanceof TenantContextError) {
      // Handle case where function was called outside tenant context scope
      console.error("This function must be called within runWithTenantContext");
    }
    throw error;
  }
}
```

## Testing

```typescript
import { runWithTenantContext } from "@engram/common";
import { describe, it, expect } from "bun:test";

describe("My Service", () => {
  it("should process tenant-scoped data", async () => {
    const mockContext = {
      orgId: "test-org",
      orgSlug: "test",
      userId: "test-user",
      isAdmin: false
    };

    await runWithTenantContext(mockContext, async () => {
      // Your test logic - getTenantContext() works here
      const result = await myService.getData();
      expect(result.orgId).toBe("test-org");
    });
  });
});
```

## Best Practices

1. **Establish context early** - Set up `runWithTenantContext` in middleware
2. **Use `getTenantContext()` for required contexts** - Throws error if missing
3. **Use `tryGetTenantContext()` for optional contexts** - Returns undefined if missing
4. **Don't pass tenant context explicitly** - Let AsyncLocalStorage handle it
5. **Test with mock contexts** - Use `runWithTenantContext` in tests

## Migration from Explicit Context Passing

### Before (explicit passing)
```typescript
async function fetchUserData(tenantCtx: TenantContext, userId: string) {
  const graphName = getTenantGraphName(tenantCtx);
  return db.query(graphName, ...);
}

async function processRequest(c: Context) {
  const tenantCtx = c.get("tenant");
  return await fetchUserData(tenantCtx, userId);
}
```

### After (AsyncLocalStorage)
```typescript
async function fetchUserData(userId: string) {
  const tenantCtx = getTenantContext(); // Retrieved from AsyncLocalStorage
  const graphName = getTenantGraphName(tenantCtx);
  return db.query(graphName, ...);
}

async function processRequest(c: Context) {
  // No need to pass tenant context down
  return await fetchUserData(userId);
}
```

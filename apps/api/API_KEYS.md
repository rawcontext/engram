# API Key Management

This document describes how API keys work in the Engram Cloud API.

## Overview

API keys are used to authenticate requests to the Engram Cloud API. Each key has:

- **Type**: `live` or `test` (indicated by prefix)
- **Scopes**: Permissions for different operations (e.g., `memory:read`, `memory:write`)
- **Rate limit**: Requests per minute (RPM)
- **Expiration**: Optional expiry date
- **Metadata**: Custom key-value data

## Database Schema

API keys are stored in PostgreSQL with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT | Unique identifier (ULID) |
| `key_hash` | TEXT | SHA-256 hash of the full API key |
| `key_prefix` | TEXT | First 20 characters for logging |
| `key_type` | TEXT | "live" or "test" |
| `user_id` | TEXT | Optional user association |
| `name` | TEXT | Human-readable name |
| `description` | TEXT | Optional description |
| `scopes` | TEXT[] | Array of permission scopes |
| `rate_limit_rpm` | INTEGER | Requests per minute limit |
| `is_active` | BOOLEAN | Whether the key is active |
| `expires_at` | TIMESTAMP | Optional expiration date |
| `created_at` | TIMESTAMP | Creation timestamp |
| `updated_at` | TIMESTAMP | Last update timestamp |
| `last_used_at` | TIMESTAMP | Last usage timestamp |
| `metadata` | JSONB | Custom metadata |

## Key Format

API keys follow this format:

```
engram_{type}_{random}
```

- **Prefix**: `engram_live_` or `engram_test_`
- **Random**: 32 base64url characters

Example: `engram_live_abc123def456ghi789jkl012mno345pq`

## Creating API Keys

### Using the Script

```bash
# Create a test key
tsx apps/api/scripts/create-api-key.ts test "My Test Key" "Description"

# Create a live key
tsx apps/api/scripts/create-api-key.ts live "Production Key"
```

### Programmatically

```typescript
import { PostgresClient } from "@engram/storage";
import { ApiKeyRepository } from "./db/api-keys";
import { ulid } from "ulid";

const db = new PostgresClient({ url: "postgresql://..." });
await db.connect();

const repo = new ApiKeyRepository(db);
const apiKey = await repo.create({
  id: ulid(),
  key: "engram_test_abc123...", // Generate securely
  keyType: "test",
  name: "My API Key",
  scopes: ["memory:read", "memory:write"],
  rateLimitRpm: 60,
});
```

## Using API Keys

Include the API key in the `Authorization` header:

```bash
curl -H "Authorization: Bearer engram_test_abc123..." \
  http://localhost:8080/v1/memory
```

## Validation

The middleware validates keys by:

1. Checking format (regex pattern)
2. Hashing the key with SHA-256
3. Looking up the hash in the database
4. Verifying the key is active
5. Checking it hasn't expired
6. Updating `last_used_at` timestamp

Invalid, inactive, or expired keys return `401 Unauthorized`.

## Available Scopes

| Scope | Description |
|-------|-------------|
| `memory:read` | Read memory operations |
| `memory:write` | Write memory operations |
| `query:read` | Execute graph queries |

## Security

- **Never log full keys**: Only log the prefix (first 20 chars)
- **Store hashes only**: The database stores SHA-256 hashes, not plaintext
- **Use HTTPS**: Always use TLS in production
- **Rotate keys**: Revoke and recreate keys periodically
- **Limit scopes**: Grant minimal required permissions

## Revoking Keys

```typescript
import { ApiKeyRepository } from "./db/api-keys";

const repo = new ApiKeyRepository(db);
await repo.revoke(keyId); // Sets is_active = false
```

## Environment Variables

```bash
# PostgreSQL connection
POSTGRES_URL=postgresql://postgres:postgres@localhost:5432/engram
```

## Migration

The schema is automatically applied on startup via `runMigrations()`. See:

- Schema: `apps/api/src/db/schema.sql`
- Migration: `apps/api/src/db/migrate.ts`

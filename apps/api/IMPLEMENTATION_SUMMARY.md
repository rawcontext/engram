# API Key Validation Implementation Summary

## Task: engram-he30

Implementation of API key validation against database for the Engram Cloud API.

## Changes Made

### 1. PostgreSQL Client (`packages/storage/src/postgres.ts`)

Created a new PostgreSQL client wrapper with:
- Connection pooling
- Query methods (`query`, `queryOne`, `queryMany`)
- Transaction support
- Proper TypeScript types with `pg.QueryResultRow` constraint

**Files modified:**
- `packages/storage/src/postgres.ts` (new)
- `packages/storage/src/index.ts` (export added)
- `packages/storage/package.json` (dependencies: `pg`, `@types/pg`)

### 2. Database Schema (`apps/api/src/db/schema.sql`)

Created API keys table with:
- Secure key storage (SHA-256 hash only)
- Key metadata (type, scopes, rate limits)
- Expiration and activation support
- Audit fields (created_at, updated_at, last_used_at)
- Automatic timestamp triggers

### 3. API Key Repository (`apps/api/src/db/api-keys.ts`)

Implemented repository pattern with methods:
- `validate(key)` - Validates key, checks expiry, updates last_used_at
- `create(params)` - Creates new API keys
- `findByHash(hash)` - Looks up keys by hash
- `revoke(id)` - Deactivates keys
- `listByUser(userId)` - Lists user's keys

Security features:
- Keys are hashed with SHA-256 before storage
- Only key prefix (first 20 chars) stored for logging
- Automatic expiration checking
- Last-used timestamp tracking

### 4. Migration System (`apps/api/src/db/migrate.ts`)

Created migration runner that:
- Reads and executes `schema.sql` on startup
- Ensures idempotent operations (CREATE IF NOT EXISTS)
- Logs migration status

### 5. Updated Auth Middleware (`apps/api/src/middleware/auth.ts`)

Enhanced authentication to:
- Validate keys against database (not just format)
- Check key status (active/inactive)
- Verify expiration
- Extract scopes and rate limits from database
- Include user_id in context
- Handle database errors gracefully

### 6. Application Bootstrap (`apps/api/src/index.ts`)

Updated to:
- Initialize PostgresClient
- Run migrations on startup
- Create ApiKeyRepository instance
- Pass repository to auth middleware
- Cleanup on shutdown

### 7. Configuration (`apps/api/src/config.ts`)

Added:
- `POSTGRES_URL` environment variable
- Default: `postgresql://postgres:postgres@localhost:5432/engram`

### 8. Docker Compose (`docker-compose.dev.yml`)

Updated PostgreSQL service:
- Changed default database from `optuna` to `postgres`
- Added volume mount for `init.sql` to create databases
- Updated documentation

### 9. Utility Script (`apps/api/scripts/create-api-key.ts`)

Created command-line tool to generate API keys:
```bash
tsx apps/api/scripts/create-api-key.ts [live|test] "Name" "Description"
```

### 10. Documentation

Created:
- `apps/api/.env.example` - Example environment configuration
- `apps/api/IMPLEMENTATION_SUMMARY.md` - This file

## Testing

All TypeScript compilation checks pass:
```bash
npm run typecheck  # ✓ All packages pass
```

## Usage

### Start Infrastructure

```bash
npm run infra:up
```

### Create an API Key

```bash
tsx apps/api/scripts/create-api-key.ts test "Development Key"
```

Output:
```
✓ API Key created successfully!

ID: 01JFXYZ...
Type: test
Name: Development Key
Scopes: memory:read, memory:write, query:read
Rate limit: 60 RPM

API Key (save this, it won't be shown again):

  engram_test_abc123def456ghi789jkl012mno345pq

Usage:
  curl -H "Authorization: Bearer engram_test_abc123..." http://localhost:8080/v1/health
```

### Start the API

```bash
cd apps/api
npm run dev
```

### Test Authentication

```bash
# Valid key
curl -H "Authorization: Bearer engram_test_abc123..." \
  http://localhost:8080/v1/memory

# Invalid key
curl -H "Authorization: Bearer invalid_key" \
  http://localhost:8080/v1/memory
# Returns: 401 Unauthorized
```

## Database Schema Details

### API Keys Table

- **Primary Key**: `id` (TEXT, ULID)
- **Unique Index**: `key_hash` (SHA-256)
- **Indexes**: `user_id`, `is_active`, `key_type`
- **Trigger**: Auto-update `updated_at` on modifications

### Security

- Keys are **never** stored in plaintext
- Only SHA-256 hashes are persisted
- Key prefix stored separately for safe logging
- Constant-time validation prevents timing attacks

## Migration Path

On first run, the API automatically:
1. Connects to PostgreSQL
2. Creates `api_keys` table if not exists
3. Creates indexes and triggers
4. Ready to accept requests

No manual migration needed.

## Future Enhancements

Potential improvements:
- [ ] Key rotation mechanism
- [ ] Usage analytics dashboard
- [ ] Scope-based authorization in routes
- [ ] Rate limiting tied to per-key limits
- [ ] API key management endpoints (CRUD)
- [ ] Webhook signing keys
- [ ] IP allowlisting per key

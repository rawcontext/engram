# API Key Authentication Flow

## Request Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Client Request                                                   │
│    GET /v1/memory                                                    │
│    Authorization: Bearer engram_test_abc123...                       │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. apiKeyAuth Middleware                                            │
│    - Extract header                                                  │
│    - Validate format (regex)                                         │
│    - Hash key (SHA-256)                                              │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. ApiKeyRepository.validate()                                       │
│    - Query: SELECT * FROM api_keys WHERE key_hash = $1              │
│    - Check: is_active = true                                         │
│    - Check: expires_at > NOW() OR NULL                               │
│    - Update: last_used_at = NOW()                                    │
└─────────────────────────────────────────────────────────────────────┘
                               │
                               ├─ Not Found ────────┐
                               │                     │
                               ├─ Inactive ─────────┤
                               │                     │
                               ├─ Expired ──────────┤
                               │                     │
                               ▼                     ▼
┌────────────────────────────────────┐   ┌──────────────────────────┐
│ 4a. Set Context                    │   │ 4b. Return 401           │
│     c.set("apiKey", {              │   │     {                    │
│       keyId: "engram_test_abc...", │   │       success: false,    │
│       keyType: "test",             │   │       error: {           │
│       userId: "user_123",          │   │         code: "...",     │
│       scopes: [...],               │   │         message: "..."   │
│       rateLimit: 60                │   │       }                  │
│     })                             │   │     }                    │
└────────────────────────────────────┘   └──────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────┐
│ 5. Rate Limiter Middleware                                         │
│    - Check Redis for rate limit                                    │
│    - Use apiKey.rateLimit (from DB)                                │
└────────────────────────────────────────────────────────────────────┘
                │
                ▼
┌────────────────────────────────────────────────────────────────────┐
│ 6. Route Handler                                                   │
│    - Access c.get("apiKey")                                        │
│    - Execute business logic                                        │
│    - Return response                                               │
└────────────────────────────────────────────────────────────────────┘
```

## Database Interaction

```
┌────────────────────────────────────────────────────────────────────┐
│ PostgreSQL: api_keys table                                         │
├────────────────────────────────────────────────────────────────────┤
│ id            │ "01JFXYZ..."                                        │
│ key_hash      │ "a3f2...8b1c" (SHA-256)                             │
│ key_prefix    │ "engram_test_abc123..."                             │
│ key_type      │ "test"                                              │
│ user_id       │ "user_123"                                          │
│ name          │ "Development Key"                                   │
│ scopes        │ ["memory:read", "memory:write", "query:read"]       │
│ rate_limit_rpm│ 60                                                  │
│ is_active     │ true                                                │
│ expires_at    │ NULL                                                │
│ created_at    │ 2025-12-20 10:00:00                                 │
│ updated_at    │ 2025-12-20 10:00:00                                 │
│ last_used_at  │ 2025-12-20 14:30:15 ← Updated on each request       │
│ metadata      │ {}                                                  │
└────────────────────────────────────────────────────────────────────┘
```

## Security Layers

1. **Format Validation**: Regex check for `engram_(live|test)_[a-zA-Z0-9]{32}`
2. **Cryptographic Hashing**: SHA-256 before database lookup
3. **Database Lookup**: Verify key exists and retrieve metadata
4. **Status Check**: Ensure `is_active = true`
5. **Expiration Check**: Verify `expires_at > NOW()` or NULL
6. **Scope Validation**: Future - check scopes for route access
7. **Rate Limiting**: Redis-based per-key rate limiting

## Error Responses

### Missing Header
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing Authorization header"
  }
}
```

### Invalid Format
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid API key format"
  }
}
```

### Invalid/Expired Key
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired API key"
  }
}
```

### Database Error
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Failed to validate API key"
  }
}
```

## Monitoring

The system tracks:
- `last_used_at` - Updated on every successful validation
- Key prefix in logs - Safe to log (truncated, not full key)
- Validation failures - Logged with key prefix for security monitoring

Example log output:
```json
{
  "level": "debug",
  "keyId": "engram_test_abc123...",
  "keyType": "test",
  "msg": "API key authenticated"
}
```

# @engram/auth-mock

Mock OAuth server for CI testing without database dependencies.

## Features

- **No Database Required**: All state is in-memory
- **Valid Token Format**: Generates tokens with proper CRC32 checksums
- **RFC Compliant**: Implements RFC 6749, RFC 7662, RFC 8414, RFC 8628
- **Auto-Authorization**: Device codes auto-approve after 1 second for testing
- **Ephemeral**: Perfect for CI pipelines where persistence isn't needed

## Usage

### Start Server

```bash
# Via CLI
bun run auth-mock

# With custom port
PORT=3010 bun run auth-mock
```

### Programmatic Use

```typescript
import { createMockAuthServer, buildMockTokenResponse } from '@engram/auth-mock';

// Start server
const server = createMockAuthServer(3010);

// Generate tokens for testing
const response = buildMockTokenResponse();
console.log(response.access_token); // egm_oauth_abc123...xyz789_A1bC2d
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/token` | POST | Client credentials & device code grants |
| `/device` | POST | Device authorization (RFC 8628) |
| `/introspect` | POST | Token introspection (RFC 7662) |
| `/.well-known/oauth-authorization-server` | GET | Server metadata (RFC 8414) |
| `/health` | GET | Health check |

## Environment Variables

- `PORT` - Server port (default: 3010)
- `MOCK_AUTH_BASE_URL` - Base URL for metadata (default: http://localhost:3010)

## CI Integration

```yaml
# GitHub Actions example
- name: Start mock OAuth server
  run: bun run auth-mock &
  env:
    PORT: 3010

- name: Run tests
  run: bun test
  env:
    ENGRAM_AUTH_SERVER_URL: http://localhost:3010
```

## Token Format

All tokens follow the production format with CRC32 checksums:

- Access Token: `egm_oauth_{random32}_{crc6}`
- Refresh Token: `egm_refresh_{random32}_{crc6}`
- Client Token: `egm_client_{random32}_{crc6}`

## Limitations

- No persistence - all state lost on restart
- Auto-approves device codes after 1 second
- Accepts any client_id/client_secret
- No rate limiting
- Single mock user only

Perfect for CI, not for production or integration testing.

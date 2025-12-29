"""Authentication middleware for FastAPI.

Validates both API keys and OAuth tokens against the PostgreSQL database,
matching the unified authentication system used by the API service.

Supports:
- API keys: engram_live_<32 chars> or engram_test_<32 chars>
- OAuth user tokens: egm_oauth_{random32}_{crc6}
- OAuth client credentials tokens: egm_client_{random32}_{crc6}
"""

import contextlib
import hashlib
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated

import asyncpg
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

# API key format: engram_live_<32 alphanumeric chars> or engram_test_<32 alphanumeric chars>
API_KEY_PATTERN = re.compile(r"^engram_(live|test)_[a-zA-Z0-9]{32}$")

# OAuth user token format: egm_oauth_{random32}_{crc6}
OAUTH_TOKEN_PATTERN = re.compile(r"^egm_oauth_[a-f0-9]{32}_[a-zA-Z0-9]{6}$")

# OAuth client credentials token format: egm_client_{random32}_{crc6}
CLIENT_TOKEN_PATTERN = re.compile(r"^egm_client_[a-f0-9]{32}_[a-zA-Z0-9]{6}$")

# Bearer token security scheme
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    """Context extracted from a validated API key or OAuth token."""

    id: str
    prefix: str
    method: str  # "api_key", "oauth", or "client_credentials"
    type: str  # "live", "test", "oauth", "client", or "dev"
    user_id: str | None
    scopes: list[str]
    rate_limit_rpm: int
    user_name: str | None = None
    user_email: str | None = None
    client_id: str | None = None


# Backward compatibility alias
ApiKeyContext = AuthContext


def hash_api_key(key: str) -> str:
    """Hash an API key using SHA-256 (matching TypeScript implementation)."""
    return hashlib.sha256(key.encode()).hexdigest()


class AuthHandler:
    """Unified authentication handler for API keys and OAuth tokens.

    Validates credentials against PostgreSQL and caches the database pool.
    """

    def __init__(self, database_url: str) -> None:
        """Initialize the auth handler.

        Args:
            database_url: PostgreSQL connection URL.
        """
        self._database_url = database_url
        self._pool: asyncpg.Pool | None = None

    async def connect(self) -> None:
        """Initialize the database connection pool."""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self._database_url,
                min_size=1,
                max_size=5,
                ssl=False,  # Disable SSL for internal docker network
            )

    async def disconnect(self) -> None:
        """Close the database connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def validate(self, token: str) -> AuthContext | None:
        """Validate a token (API key or OAuth) and return its context.

        Args:
            token: The bearer token to validate.

        Returns:
            AuthContext if valid, None otherwise.
        """
        # Try OAuth user token first
        if OAUTH_TOKEN_PATTERN.match(token):
            return await self._validate_oauth_token(token)

        # Try client credentials token
        if CLIENT_TOKEN_PATTERN.match(token):
            return await self._validate_client_token(token)

        # Try API key
        if API_KEY_PATTERN.match(token):
            return await self._validate_api_key(token)

        return None

    async def _validate_api_key(self, api_key: str) -> AuthContext | None:
        """Validate an API key and return its context."""
        # Ensure pool is connected
        if self._pool is None:
            await self.connect()

        assert self._pool is not None

        # Hash the key and look it up
        key_hash = hash_api_key(api_key)

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    id, key_prefix, key_type, user_id, scopes,
                    rate_limit_rpm, is_active, expires_at
                FROM api_keys
                WHERE key_hash = $1
                """,
                key_hash,
            )

            if row is None:
                return None

            # Check if active
            if not row["is_active"]:
                return None

            # Check expiration
            expires_at = row["expires_at"]
            if expires_at is not None:
                # Ensure timezone-aware comparison
                now = datetime.now(UTC)
                if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=UTC)
                if expires_at < now:
                    return None

            # Update last_used_at (fire and forget)
            with contextlib.suppress(Exception):
                await conn.execute(
                    "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
                    row["id"],
                )

            return AuthContext(
                id=row["id"],
                prefix=row["key_prefix"],
                method="api_key",
                type=row["key_type"],
                user_id=row["user_id"],
                scopes=row["scopes"] or [],
                rate_limit_rpm=row["rate_limit_rpm"],
            )

    async def _validate_oauth_token(self, token: str) -> AuthContext | None:
        """Validate an OAuth access token and return its context."""
        # Ensure pool is connected
        if self._pool is None:
            await self.connect()

        assert self._pool is not None

        # Hash the token and look it up
        token_hash = hash_api_key(token)

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    t.id, t.access_token_prefix, t.user_id, t.scopes,
                    t.access_token_expires_at, t.revoked_at,
                    u.name as user_name, u.email as user_email
                FROM oauth_tokens t
                JOIN "user" u ON t.user_id = u.id
                WHERE t.access_token_hash = $1
                """,
                token_hash,
            )

            if row is None:
                return None

            # Check if revoked
            if row["revoked_at"] is not None:
                return None

            # Check expiration
            expires_at = row["access_token_expires_at"]
            if expires_at is not None:
                now = datetime.now(UTC)
                if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=UTC)
                if expires_at < now:
                    return None

            # Update last_used_at (fire and forget)
            with contextlib.suppress(Exception):
                await conn.execute(
                    "UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1",
                    row["id"],
                )

            return AuthContext(
                id=row["id"],
                prefix=row["access_token_prefix"],
                method="oauth",
                type="oauth",
                user_id=row["user_id"],
                scopes=row["scopes"] or [],
                rate_limit_rpm=1000,  # Default rate limit for OAuth tokens
                user_name=row["user_name"],
                user_email=row["user_email"],
            )

    async def _validate_client_token(self, token: str) -> AuthContext | None:
        """Validate an OAuth client credentials token and return its context."""
        # Ensure pool is connected
        if self._pool is None:
            await self.connect()

        assert self._pool is not None

        # Hash the token and look it up
        token_hash = hash_api_key(token)

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT
                    t.id, t.access_token_prefix, t.client_id, t.scopes,
                    t.access_token_expires_at, t.revoked_at
                FROM oauth_tokens t
                WHERE t.access_token_hash = $1 AND t.grant_type = 'client_credentials'
                """,
                token_hash,
            )

            if row is None:
                return None

            # Check if revoked
            if row["revoked_at"] is not None:
                return None

            # Check expiration
            expires_at = row["access_token_expires_at"]
            if expires_at is not None:
                now = datetime.now(UTC)
                if isinstance(expires_at, datetime) and expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=UTC)
                if expires_at < now:
                    return None

            # Update last_used_at (fire and forget)
            with contextlib.suppress(Exception):
                await conn.execute(
                    "UPDATE oauth_tokens SET last_used_at = NOW() WHERE id = $1",
                    row["id"],
                )

            return AuthContext(
                id=row["id"],
                prefix=row["access_token_prefix"],
                method="client_credentials",
                type="client",
                user_id=None,  # Client credentials tokens are not user-scoped
                scopes=row["scopes"] or [],
                rate_limit_rpm=5000,  # Higher rate limit for M2M tokens
                client_id=row["client_id"],
            )


# Backward compatibility alias
ApiKeyAuth = AuthHandler


# Global auth handler (initialized in lifespan)
_auth_handler: AuthHandler | None = None


def set_auth_handler(handler: AuthHandler) -> None:
    """Set the global auth handler (called during app startup)."""
    global _auth_handler
    _auth_handler = handler


def get_auth_handler() -> AuthHandler:
    """Get the global auth handler."""
    if _auth_handler is None:
        raise RuntimeError("Auth handler not initialized")
    return _auth_handler


async def get_api_key(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> AuthContext:
    """Dependency to extract and validate bearer token from request.

    Supports both API keys and OAuth tokens.

    Args:
        request: FastAPI request.
        credentials: Bearer token credentials.

    Returns:
        Validated auth context.

    Raises:
        HTTPException: If authentication fails.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Missing Authorization header",
                },
            },
        )

    token = credentials.credentials

    # Check if token matches any valid format
    if not (
        API_KEY_PATTERN.match(token)
        or OAUTH_TOKEN_PATTERN.match(token)
        or CLIENT_TOKEN_PATTERN.match(token)
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Invalid token format",
                },
            },
        )

    try:
        auth = get_auth_handler()
        auth_context = await auth.validate(token)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": f"Failed to validate token: {e!s}",
                },
            },
        ) from e

    if auth_context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Invalid or expired token",
                },
            },
        )

    # Store in request state for logging
    request.state.api_key = auth_context

    return auth_context


# Type alias for dependency injection
ApiKey = Annotated[ApiKeyContext, Depends(get_api_key)]


def require_auth(key: ApiKey) -> ApiKeyContext:
    """Dependency that requires authentication.

    Usage:
        @router.post("/studies")
        async def create_study(key: ApiKey = Depends(require_auth)):
            ...
    """
    return key


def require_scope(*required_scopes: str):
    """Dependency factory that requires specific scopes.

    Args:
        required_scopes: Scopes that the API key must have (any of them).

    Returns:
        A dependency function that validates scopes.

    Usage:
        @router.post("/studies")
        async def create_study(key: ApiKeyContext = Depends(require_scope("tuner:write"))):
            ...
    """

    async def scope_checker(key: ApiKey) -> ApiKeyContext:
        if not any(scope in key.scopes for scope in required_scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": {
                        "code": "FORBIDDEN",
                        "message": (
                            f"API key lacks required scope. "
                            f"Need one of: {', '.join(required_scopes)}"
                        ),
                    },
                },
            )
        return key

    return scope_checker

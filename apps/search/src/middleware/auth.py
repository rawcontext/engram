"""API key authentication middleware for FastAPI.

Validates API keys against the PostgreSQL api_keys table, matching
the authentication system used by the API service.
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

# Bearer token security scheme
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class ApiKeyContext:
    """Context extracted from a validated API key."""

    key_id: str
    key_prefix: str
    key_type: str  # "live" or "test"
    user_id: str | None
    scopes: list[str]
    rate_limit_rpm: int


def hash_api_key(key: str) -> str:
    """Hash an API key using SHA-256 (matching TypeScript implementation)."""
    return hashlib.sha256(key.encode()).hexdigest()


class ApiKeyAuth:
    """API key authentication handler.

    Validates API keys against PostgreSQL and caches the database pool.
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
            )

    async def disconnect(self) -> None:
        """Close the database connection pool."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def validate(self, api_key: str) -> ApiKeyContext | None:
        """Validate an API key and return its context.

        Args:
            api_key: The API key to validate.

        Returns:
            ApiKeyContext if valid, None otherwise.
        """
        # Validate format
        if not API_KEY_PATTERN.match(api_key):
            return None

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

            return ApiKeyContext(
                key_id=row["id"],
                key_prefix=row["key_prefix"],
                key_type=row["key_type"],
                user_id=row["user_id"],
                scopes=row["scopes"] or [],
                rate_limit_rpm=row["rate_limit_rpm"],
            )


# Global auth handler (initialized in lifespan)
_auth_handler: ApiKeyAuth | None = None


def set_auth_handler(handler: ApiKeyAuth) -> None:
    """Set the global auth handler (called during app startup)."""
    global _auth_handler
    _auth_handler = handler


def get_auth_handler() -> ApiKeyAuth:
    """Get the global auth handler."""
    if _auth_handler is None:
        raise RuntimeError("Auth handler not initialized")
    return _auth_handler


async def get_api_key(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> ApiKeyContext:
    """Dependency to extract and validate API key from request.

    Args:
        request: FastAPI request.
        credentials: Bearer token credentials.

    Returns:
        Validated API key context.

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

    api_key = credentials.credentials

    if not API_KEY_PATTERN.match(api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Invalid API key format",
                },
            },
        )

    try:
        auth = get_auth_handler()
        key_context = await auth.validate(api_key)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "success": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": f"Failed to validate API key: {e!s}",
                },
            },
        ) from e

    if key_context is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "success": False,
                "error": {
                    "code": "UNAUTHORIZED",
                    "message": "Invalid or expired API key",
                },
            },
        )

    # Store in request state for logging
    request.state.api_key = key_context

    return key_context


# Type alias for dependency injection
ApiKey = Annotated[ApiKeyContext, Depends(get_api_key)]


def require_auth(key: ApiKey) -> ApiKeyContext:
    """Dependency that requires authentication.

    Usage:
        @router.post("/search")
        async def search(key: ApiKey = Depends(require_auth)):
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
        @router.post("/search")
        async def search(key: ApiKeyContext = Depends(require_scope("search:read"))):
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

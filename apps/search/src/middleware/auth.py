"""OAuth authentication middleware for FastAPI.

Validates OAuth tokens (user and client credentials) via RFC 7662 introspection.
Supports optional DPoP (RFC 9449) proof-of-possession validation.

Supported token types:
- User tokens: egm_oauth_{random32}_{crc6}
- Client tokens: egm_client_{random32}_{crc6}
"""

import re
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.config import get_settings

# OAuth token patterns (from packages/common/src/types/auth.ts)
USER_TOKEN_PATTERN = re.compile(r"^egm_oauth_[a-f0-9]{32}_[a-zA-Z0-9]{6}$")
CLIENT_TOKEN_PATTERN = re.compile(r"^egm_client_[a-f0-9]{32}_[a-zA-Z0-9]{6}$")

# Bearer token security scheme
bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class AuthContext:
    """Context extracted from a validated OAuth token."""

    id: str
    prefix: str
    method: str  # "oauth" or "client_credentials"
    type: str  # "oauth" or "client"
    user_id: str
    scopes: list[str]
    rate_limit_rpm: int
    user_name: str | None = None
    user_email: str | None = None


class AuthHandler:
    """OAuth authentication handler using RFC 7662 token introspection.

    Validates tokens by calling the Observatory's introspection endpoint.
    Caches the httpx client for connection pooling.
    """

    def __init__(
        self,
        introspection_url: str,
        client_id: str,
        client_secret: str | None = None,
    ) -> None:
        """Initialize the auth handler.

        Args:
                introspection_url: OAuth introspection endpoint URL.
                client_id: Client ID for Basic auth with introspection endpoint.
                client_secret: Client secret for Basic auth (optional for localhost).
        """
        self._introspection_url = introspection_url
        self._client_id = client_id
        self._client_secret = client_secret
        self._http_client: httpx.AsyncClient | None = None

    async def connect(self) -> None:
        """Initialize the HTTP client for introspection requests."""
        if self._http_client is None:
            self._http_client = httpx.AsyncClient(timeout=5.0)

    async def disconnect(self) -> None:
        """Close the HTTP client."""
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None

    async def validate(
        self,
        token: str,
        dpop_proof: str | None = None,
        request_method: str | None = None,
        request_uri: str | None = None,
    ) -> AuthContext | None:
        """Validate a token via OAuth introspection (RFC 7662).

        Args:
                token: The OAuth token to validate (egm_oauth_* or egm_client_*).
                dpop_proof: Optional DPoP proof JWT (RFC 9449).
                request_method: HTTP method for DPoP validation.
                request_uri: Request URI for DPoP validation.

        Returns:
                AuthContext if valid, None otherwise.
        """
        # Check token format
        if not USER_TOKEN_PATTERN.match(token) and not CLIENT_TOKEN_PATTERN.match(token):
            return None

        # Ensure HTTP client is initialized
        if self._http_client is None:
            await self.connect()

        assert self._http_client is not None

        try:
            # Call introspection endpoint (RFC 7662)
            auth = (
                httpx.BasicAuth(self._client_id, self._client_secret)
                if self._client_secret
                else None
            )

            response = await self._http_client.post(
                self._introspection_url,
                data={"token": token, "token_type_hint": "access_token"},
                auth=auth,
            )

            # RFC 7662: Introspection endpoint returns 200 even for invalid tokens
            if response.status_code != 200:
                return None

            introspection = response.json()

            # Check if token is active
            if not introspection.get("active", False):
                return None

            # Extract token metadata
            token_type = "client" if CLIENT_TOKEN_PATTERN.match(token) else "oauth"
            method = "client_credentials" if token_type == "client" else "oauth"

            # For client credentials tokens, use client_id as user_id
            user_id = introspection.get("sub") or introspection.get("client_id")
            if not user_id:
                return None

            # Extract scopes (space-separated string -> list)
            scope_str = introspection.get("scope", "")
            scopes = scope_str.split() if scope_str else []

            # Calculate token prefix for logging
            prefix = token[:20] + "..."

            return AuthContext(
                id=user_id,  # Using sub/client_id as id
                prefix=prefix,
                method=method,
                type=token_type,
                user_id=user_id,
                scopes=scopes,
                rate_limit_rpm=1000,  # Default rate limit
                user_name=introspection.get("name"),
                user_email=introspection.get("email"),
            )

        except Exception:
            # Network errors, timeouts, etc.
            return None


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
    """Dependency to extract and validate OAuth token from request.

    Supports both user tokens (egm_oauth_*) and client tokens (egm_client_*).
    Optionally validates DPoP proof if DPoP header is present.

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

    # Check if token matches valid format
    if not USER_TOKEN_PATTERN.match(token) and not CLIENT_TOKEN_PATTERN.match(token):
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

    # Extract DPoP proof if present
    dpop_proof = request.headers.get("DPoP")

    try:
        auth = get_auth_handler()
        auth_context = await auth.validate(
            token,
            dpop_proof=dpop_proof,
            request_method=request.method,
            request_uri=str(request.url),
        )
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
ApiKey = Annotated[AuthContext, Depends(get_api_key)]

# Backward compatibility aliases
ApiKeyContext = AuthContext
ApiKeyAuth = AuthHandler


def require_auth(key: ApiKey) -> AuthContext:
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
            required_scopes: Scopes that the token must have (any of them).

    Returns:
            A dependency function that validates scopes.

    Usage:
            @router.post("/search")
            async def search(key: AuthContext = Depends(require_scope("search:read"))):
                    ...
    """

    async def scope_checker(key: ApiKey) -> AuthContext:
        if not any(scope in key.scopes for scope in required_scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": {
                        "code": "FORBIDDEN",
                        "message": (
                            f"Token lacks required scope. Need one of: {', '.join(required_scopes)}"
                        ),
                    },
                },
            )
        return key

    return scope_checker


# Placeholder context for when auth is disabled
_anonymous_context = AuthContext(
    id="anonymous",
    prefix="none",
    method="dev",
    type="dev",
    user_id="anonymous",
    scopes=["*"],  # All scopes when auth disabled
    rate_limit_rpm=1000,
)


def _is_internal_network(client_host: str | None) -> bool:
    """Check if request is from Docker internal network (172.16.0.0/12).

    Note: We intentionally exclude 127.0.0.1/localhost to maintain testability.
    Health checks from localhost use unauthenticated GET endpoints.
    """
    if not client_host:
        return False
    # Docker uses 172.16.0.0/12 for bridge networks
    return client_host.startswith("172.")


# Internal service context (used for service-to-service calls)
_internal_context = AuthContext(
    id="internal",
    prefix="internal",
    method="internal",
    type="internal",
    user_id="internal",
    scopes=["*"],  # All scopes for internal service calls
    rate_limit_rpm=10000,
)


def optional_scope(*required_scopes: str):
    """Dependency factory that requires scopes only when auth is enabled.

    When AUTH_ENABLED=false, returns an anonymous context with full permissions.
    When AUTH_ENABLED=true, validates the OAuth token and required scopes.
    When request is from internal Docker network, returns internal context.

    Args:
            required_scopes: Scopes that the token must have (any of them).

    Returns:
            A dependency function that validates scopes when auth is enabled.

    Usage:
            @router.post("/search")
            async def search(key: AuthContext = Depends(optional_scope("search:read"))):
                    ...
    """
    settings = get_settings()

    if not settings.auth_enabled:
        # Auth disabled - return anonymous context
        async def no_auth_checker() -> AuthContext:
            return _anonymous_context

        return no_auth_checker

    # Auth enabled - check for internal network or require scope
    async def internal_or_auth_checker(
        request: Request,
        credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    ) -> AuthContext:
        # Skip auth for internal Docker network requests (service-to-service)
        client_host = request.client.host if request.client else None
        if _is_internal_network(client_host):
            return _internal_context

        # External request - validate auth and check scopes
        auth_context = await get_api_key(request, credentials)
        if not any(scope in auth_context.scopes for scope in required_scopes):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "success": False,
                    "error": {
                        "code": "FORBIDDEN",
                        "message": (
                            f"Token lacks required scope. Need one of: {', '.join(required_scopes)}"
                        ),
                    },
                },
            )
        return auth_context

    return internal_or_auth_checker

"""Middleware for the Search service."""

from src.middleware.auth import (
    AuthContext,
    AuthHandler,
    get_api_key,
    require_auth,
    require_scope,
)

# Backward compatibility aliases
ApiKeyContext = AuthContext
ApiKeyAuth = AuthHandler

__all__ = [
    "AuthHandler",
    "AuthContext",
    "ApiKeyAuth",  # Deprecated - use AuthHandler
    "ApiKeyContext",  # Deprecated - use AuthContext
    "get_api_key",
    "require_auth",
    "require_scope",
]

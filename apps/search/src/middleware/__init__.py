"""Middleware for the Search service."""

from src.middleware.auth import (
    ApiKeyAuth,
    ApiKeyContext,
    get_api_key,
    require_auth,
    require_scope,
)

__all__ = [
    "ApiKeyAuth",
    "ApiKeyContext",
    "get_api_key",
    "require_auth",
    "require_scope",
]

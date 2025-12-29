"""Tests for API key authentication middleware."""

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from tuner.middleware.auth import (
    API_KEY_PATTERN,
    AuthContext,
    AuthHandler,
    get_api_key,
    get_auth_handler,
    hash_api_key,
    require_auth,
    require_scope,
    set_auth_handler,
)

# Backward compatibility alias for tests
ApiKeyContext = AuthContext
ApiKeyAuth = AuthHandler


class TestHashApiKey:
    """Tests for hash_api_key function."""

    def test_hash_api_key_returns_sha256_hex(self) -> None:
        """Test that hash_api_key returns SHA-256 hash as hex string."""
        key = "engram_test_abcdefghijklmnopqrstuvwxyz123456"
        expected = hashlib.sha256(key.encode()).hexdigest()
        result = hash_api_key(key)
        assert result == expected
        assert len(result) == 64  # SHA-256 hex is 64 chars

    def test_hash_api_key_is_deterministic(self) -> None:
        """Test that same key produces same hash."""
        key = "engram_live_1234567890abcdefghijklmnopqrstuv"
        hash1 = hash_api_key(key)
        hash2 = hash_api_key(key)
        assert hash1 == hash2

    def test_hash_api_key_different_keys_different_hashes(self) -> None:
        """Test that different keys produce different hashes."""
        key1 = "engram_test_abcdefghijklmnopqrstuvwxyz123456"
        key2 = "engram_test_abcdefghijklmnopqrstuvwxyz123457"
        hash1 = hash_api_key(key1)
        hash2 = hash_api_key(key2)
        assert hash1 != hash2


class TestApiKeyPattern:
    """Tests for API key regex pattern."""

    def test_valid_live_key(self) -> None:
        """Test that valid live key matches pattern."""
        key = "engram_live_" + "a" * 32
        assert API_KEY_PATTERN.match(key)

    def test_valid_test_key(self) -> None:
        """Test that valid test key matches pattern."""
        key = "engram_test_" + "b" * 32
        assert API_KEY_PATTERN.match(key)

    def test_valid_key_mixed_case(self) -> None:
        """Test that mixed case alphanumeric key matches."""
        key = "engram_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345"
        assert API_KEY_PATTERN.match(key)

    def test_invalid_prefix(self) -> None:
        """Test that invalid prefix doesn't match."""
        key = "invalid_live_" + "a" * 32
        assert not API_KEY_PATTERN.match(key)

    def test_invalid_key_type(self) -> None:
        """Test that invalid key type doesn't match."""
        key = "engram_prod_" + "a" * 32
        assert not API_KEY_PATTERN.match(key)

    def test_invalid_length_too_short(self) -> None:
        """Test that short key doesn't match."""
        key = "engram_live_" + "a" * 31
        assert not API_KEY_PATTERN.match(key)

    def test_invalid_length_too_long(self) -> None:
        """Test that long key doesn't match."""
        key = "engram_live_" + "a" * 33
        assert not API_KEY_PATTERN.match(key)

    def test_invalid_special_chars(self) -> None:
        """Test that special characters don't match."""
        key = "engram_live_" + "a" * 30 + "@#"
        assert not API_KEY_PATTERN.match(key)


class TestApiKeyContext:
    """Tests for ApiKeyContext dataclass."""

    def test_create_api_key_context(self) -> None:
        """Test creating AuthContext instance."""
        context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:read", "tuner:write"],
            rate_limit_rpm=100,
        )
        assert context.id == "key-123"
        assert context.prefix == "engram_live"
        assert context.method == "api_key"
        assert context.type == "live"
        assert context.user_id == "user-456"
        assert context.scopes == ["tuner:read", "tuner:write"]
        assert context.rate_limit_rpm == 100

    def test_api_key_context_none_user_id(self) -> None:
        """Test AuthContext with None user_id."""
        context = AuthContext(
            id="key-123",
            prefix="engram_test",
            method="api_key",
            type="test",
            user_id=None,
            scopes=[],
            rate_limit_rpm=60,
        )
        assert context.user_id is None


class TestApiKeyAuth:
    """Tests for ApiKeyAuth class."""

    @pytest.mark.asyncio
    async def test_init(self) -> None:
        """Test ApiKeyAuth initialization."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")
        assert auth._database_url == "postgresql://localhost:5432/test"
        assert auth._pool is None

    @pytest.mark.asyncio
    async def test_connect_creates_pool(self) -> None:
        """Test that connect() creates database pool."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = AsyncMock()
        with patch("asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            await auth.connect()

            assert auth._pool is mock_pool
            mock_create_pool.assert_called_once_with(
                "postgresql://localhost:5432/test",
                min_size=1,
                max_size=5,
                ssl=False,
            )

    @pytest.mark.asyncio
    async def test_connect_idempotent(self) -> None:
        """Test that connect() is idempotent."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = AsyncMock()
        with patch("asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            await auth.connect()
            await auth.connect()  # Second call

            # Should only create pool once
            assert mock_create_pool.call_count == 1

    @pytest.mark.asyncio
    async def test_disconnect_closes_pool(self) -> None:
        """Test that disconnect() closes pool."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = AsyncMock()
        auth._pool = mock_pool

        await auth.disconnect()

        mock_pool.close.assert_called_once()
        assert auth._pool is None

    @pytest.mark.asyncio
    async def test_disconnect_when_no_pool(self) -> None:
        """Test that disconnect() handles no pool gracefully."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")
        assert auth._pool is None

        # Should not raise
        await auth.disconnect()

    @pytest.mark.asyncio
    async def test_validate_invalid_format(self) -> None:
        """Test validation rejects invalid format."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")
        result = await auth.validate("invalid_key_format")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_key_not_found(self) -> None:
        """Test validation when key not in database."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None

        # Mock the acquire context manager
        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool):
            await auth.connect()

            key = "engram_live_" + "a" * 32
            result = await auth.validate(key)

            assert result is None

    @pytest.mark.asyncio
    async def test_validate_inactive_key(self) -> None:
        """Test validation rejects inactive key."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_live",
            "key_type": "live",
            "user_id": "user-456",
            "scopes": ["tuner:read"],
            "rate_limit_rpm": 100,
            "is_active": False,  # Inactive
            "expires_at": None,
        }

        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool):
            await auth.connect()

            key = "engram_live_" + "a" * 32
            result = await auth.validate(key)

            assert result is None

    @pytest.mark.asyncio
    async def test_validate_expired_key(self) -> None:
        """Test validation rejects expired key."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        expired_time = datetime.now(UTC) - timedelta(days=1)

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_live",
            "key_type": "live",
            "user_id": "user-456",
            "scopes": ["tuner:read"],
            "rate_limit_rpm": 100,
            "is_active": True,
            "expires_at": expired_time,
        }

        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool):
            await auth.connect()

            key = "engram_live_" + "a" * 32
            result = await auth.validate(key)

            assert result is None

    @pytest.mark.asyncio
    async def test_validate_success(self) -> None:
        """Test successful validation."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_live",
            "key_type": "live",
            "user_id": "user-456",
            "scopes": ["tuner:read", "tuner:write"],
            "rate_limit_rpm": 100,
            "is_active": True,
            "expires_at": None,
        }
        mock_conn.execute.return_value = None  # For last_used_at update

        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool):
            await auth.connect()

            key = "engram_live_" + "a" * 32
            result = await auth.validate(key)

            assert result is not None
            assert result.id == "key-123"
            assert result.prefix == "engram_live"
            assert result.method == "api_key"
            assert result.type == "live"
            assert result.user_id == "user-456"
            assert result.scopes == ["tuner:read", "tuner:write"]
            assert result.rate_limit_rpm == 100

    @pytest.mark.asyncio
    async def test_validate_updates_last_used(self) -> None:
        """Test that validation updates last_used_at."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_live",
            "key_type": "live",
            "user_id": "user-456",
            "scopes": ["tuner:read"],
            "rate_limit_rpm": 100,
            "is_active": True,
            "expires_at": None,
        }

        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool):
            await auth.connect()

            key = "engram_live_" + "a" * 32
            await auth.validate(key)

            # Check that UPDATE was called
            mock_conn.execute.assert_called_once()
            call_args = mock_conn.execute.call_args[0]
            assert "UPDATE api_keys SET last_used_at" in call_args[0]

    @pytest.mark.asyncio
    async def test_validate_handles_naive_datetime(self) -> None:
        """Test validation handles naive datetime by adding UTC timezone."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")

        # Future naive datetime
        naive_future = datetime.now() + timedelta(days=1)

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_live",
            "key_type": "live",
            "user_id": "user-456",
            "scopes": ["tuner:read"],
            "rate_limit_rpm": 100,
            "is_active": True,
            "expires_at": naive_future,  # Naive datetime
        }

        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch("asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool):
            await auth.connect()

            key = "engram_live_" + "a" * 32
            result = await auth.validate(key)

            # Should succeed because naive datetime is treated as UTC
            assert result is not None

    @pytest.mark.asyncio
    async def test_validate_auto_connects(self) -> None:
        """Test that validate auto-connects if pool is None."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")
        assert auth._pool is None

        mock_pool = MagicMock()
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None

        mock_acquire = MagicMock()
        mock_acquire.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_acquire.__aexit__ = AsyncMock(return_value=None)
        mock_pool.acquire.return_value = mock_acquire

        with patch(
            "asyncpg.create_pool", new_callable=AsyncMock, return_value=mock_pool
        ) as mock_create:
            key = "engram_live_" + "a" * 32
            await auth.validate(key)

            # Should have auto-connected
            mock_create.assert_called_once()


class TestAuthHandlerGlobals:
    """Tests for global auth handler functions."""

    def test_set_and_get_auth_handler(self) -> None:
        """Test setting and getting global auth handler."""
        auth = ApiKeyAuth("postgresql://localhost:5432/test")
        set_auth_handler(auth)
        result = get_auth_handler()
        assert result is auth

    def test_get_auth_handler_not_initialized(self) -> None:
        """Test get_auth_handler raises when not initialized."""
        # Reset global
        from tuner.middleware import auth as auth_module

        auth_module._auth_handler = None

        with pytest.raises(RuntimeError, match="Auth handler not initialized"):
            get_auth_handler()


class TestGetApiKey:
    """Tests for get_api_key dependency."""

    @pytest.mark.asyncio
    async def test_get_api_key_no_credentials(self) -> None:
        """Test get_api_key raises 401 when no credentials."""
        request = MagicMock()

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key(request, None)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_invalid_format(self) -> None:
        """Test get_api_key raises 401 for invalid format."""
        request = MagicMock()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="invalid_format",
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key(request, credentials)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
        assert "Invalid token format" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_validation_error(self) -> None:
        """Test get_api_key raises 500 on validation error."""
        request = MagicMock()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="engram_live_" + "a" * 32,
        )

        mock_auth = AsyncMock()
        mock_auth.validate.side_effect = Exception("Database connection failed")

        with patch("tuner.middleware.auth.get_auth_handler", return_value=mock_auth):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key(request, credentials)

            assert exc_info.value.status_code == 500
            assert exc_info.value.detail["error"]["code"] == "INTERNAL_ERROR"
            assert "Failed to validate token" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_invalid_key(self) -> None:
        """Test get_api_key raises 401 when key is invalid."""
        request = MagicMock()
        request.state = MagicMock()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="engram_live_" + "a" * 32,
        )

        mock_auth = AsyncMock()
        mock_auth.validate.return_value = None  # Invalid key

        with patch("tuner.middleware.auth.get_auth_handler", return_value=mock_auth):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key(request, credentials)

            assert exc_info.value.status_code == 401
            assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
            assert "Invalid or expired token" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_success(self) -> None:
        """Test get_api_key returns context on success."""
        request = MagicMock()
        request.state = MagicMock()
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="engram_live_" + "a" * 32,
        )

        expected_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:read"],
            rate_limit_rpm=100,
        )

        mock_auth = AsyncMock()
        mock_auth.validate.return_value = expected_context

        with patch("tuner.middleware.auth.get_auth_handler", return_value=mock_auth):
            result = await get_api_key(request, credentials)

            assert result is expected_context
            assert request.state.api_key is expected_context


class TestRequireAuth:
    """Tests for require_auth dependency."""

    def test_require_auth_returns_key(self) -> None:
        """Test require_auth returns key context."""
        key_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:read"],
            rate_limit_rpm=100,
        )

        result = require_auth(key_context)
        assert result is key_context


class TestRequireScope:
    """Tests for require_scope dependency factory."""

    @pytest.mark.asyncio
    async def test_require_scope_success_single(self) -> None:
        """Test require_scope succeeds when key has required scope."""
        key_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:read", "tuner:write"],
            rate_limit_rpm=100,
        )

        checker = require_scope("tuner:read")
        result = await checker(key_context)
        assert result is key_context

    @pytest.mark.asyncio
    async def test_require_scope_success_multiple(self) -> None:
        """Test require_scope succeeds when key has any of required scopes."""
        key_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:write"],
            rate_limit_rpm=100,
        )

        checker = require_scope("tuner:read", "tuner:write")
        result = await checker(key_context)
        assert result is key_context

    @pytest.mark.asyncio
    async def test_require_scope_missing(self) -> None:
        """Test require_scope raises 403 when scope missing."""
        key_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:read"],
            rate_limit_rpm=100,
        )

        checker = require_scope("tuner:write", "tuner:admin")

        with pytest.raises(HTTPException) as exc_info:
            await checker(key_context)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["error"]["code"] == "FORBIDDEN"
        assert "lacks required scope" in exc_info.value.detail["error"]["message"]
        assert "tuner:write" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_require_scope_empty_scopes(self) -> None:
        """Test require_scope raises 403 when key has no scopes."""
        key_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=[],
            rate_limit_rpm=100,
        )

        checker = require_scope("tuner:read")

        with pytest.raises(HTTPException) as exc_info:
            await checker(key_context)

        assert exc_info.value.status_code == 403


class TestAuthIntegration:
    """Integration tests for auth middleware with FastAPI."""

    def test_auth_protected_endpoint(self) -> None:
        """Test authentication on protected endpoint."""
        from tuner.middleware.auth import ApiKey, require_auth

        app = FastAPI()

        @app.get("/protected")
        async def protected_route(key: ApiKey = require_auth):
            return {"key_id": key.id}

        # Mock the auth handler
        mock_context = AuthContext(
            id="key-123",
            prefix="engram_live",
            method="api_key",
            type="live",
            user_id="user-456",
            scopes=["tuner:read"],
            rate_limit_rpm=100,
        )

        mock_auth = AsyncMock()
        mock_auth.validate.return_value = mock_context

        with patch("tuner.middleware.auth.get_auth_handler", return_value=mock_auth):
            client = TestClient(app)
            response = client.get(
                "/protected",
                headers={"Authorization": "Bearer engram_live_" + "a" * 32},
            )

            assert response.status_code == 200
            assert response.json()["key_id"] == "key-123"

    def test_auth_missing_header(self) -> None:
        """Test 401 when Authorization header missing."""
        from tuner.middleware.auth import ApiKey, require_auth

        app = FastAPI()

        @app.get("/protected")
        async def protected_route(key: ApiKey = require_auth):
            return {"key_id": key.id}

        client = TestClient(app)
        response = client.get("/protected")

        assert response.status_code == 401
        # The response should have error structure (either detail or error)
        json_response = response.json()
        assert "detail" in json_response or "error" in json_response

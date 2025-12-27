"""Tests for API key authentication middleware."""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import HTTPException, Request

from src.middleware.auth import (
    API_KEY_PATTERN,
    OAUTH_TOKEN_PATTERN,
    AuthContext,
    AuthHandler,
    _is_internal_network,
    get_api_key,
    get_auth_handler,
    hash_api_key,
    optional_scope,
    require_auth,
    require_scope,
    set_auth_handler,
)


def create_mock_pool_with_connection(mock_conn):
    """Helper to create a mock pool with proper async context manager."""
    mock_pool = MagicMock()
    mock_acquire = AsyncMock()
    mock_acquire.__aenter__.return_value = mock_conn
    mock_acquire.__aexit__.return_value = None
    mock_pool.acquire.return_value = mock_acquire
    return mock_pool


class TestHashApiKey:
    """Tests for hash_api_key function."""

    def test_hash_api_key_returns_sha256(self):
        """Test that hash_api_key returns SHA-256 hash."""
        key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        hashed = hash_api_key(key)
        assert isinstance(hashed, str)
        assert len(hashed) == 64  # SHA-256 produces 64 hex characters
        # Same input should produce same hash
        assert hash_api_key(key) == hashed

    def test_hash_api_key_different_keys_different_hashes(self):
        """Test that different keys produce different hashes."""
        key1 = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        key2 = "engram_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        assert hash_api_key(key1) != hash_api_key(key2)


class TestPatterns:
    """Tests for regex patterns."""

    def test_api_key_pattern_matches_live_key(self):
        """Test that API_KEY_PATTERN matches live keys."""
        assert API_KEY_PATTERN.match("engram_live_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

    def test_api_key_pattern_matches_test_key(self):
        """Test that API_KEY_PATTERN matches test keys."""
        assert API_KEY_PATTERN.match("engram_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")

    def test_api_key_pattern_rejects_invalid_prefix(self):
        """Test that API_KEY_PATTERN rejects invalid prefix."""
        assert not API_KEY_PATTERN.match("invalid_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

    def test_api_key_pattern_rejects_short_suffix(self):
        """Test that API_KEY_PATTERN rejects short suffix."""
        assert not API_KEY_PATTERN.match("engram_test_short")

    def test_oauth_token_pattern_matches_valid_token(self):
        """Test that OAUTH_TOKEN_PATTERN matches valid tokens."""
        assert OAUTH_TOKEN_PATTERN.match("engram_oauth_abcdef1234567890abcdef1234567890")

    def test_oauth_token_pattern_rejects_invalid_chars(self):
        """Test that OAUTH_TOKEN_PATTERN rejects non-hex chars."""
        assert not OAUTH_TOKEN_PATTERN.match("engram_oauth_gggggggggggggggggggggggggggggggg")


class TestAuthHandler:
    """Tests for AuthHandler class."""

    @pytest.mark.asyncio
    async def test_connect_creates_pool(self):
        """Test that connect() creates a connection pool."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_pool = AsyncMock()
        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            await handler.connect()

            mock_create_pool.assert_called_once()
            assert handler._pool is mock_pool

    @pytest.mark.asyncio
    async def test_connect_idempotent(self):
        """Test that connect() is idempotent."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_pool = AsyncMock()
        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            await handler.connect()
            await handler.connect()  # Second call should do nothing

            # Should only be called once
            assert mock_create_pool.call_count == 1

    @pytest.mark.asyncio
    async def test_disconnect_closes_pool(self):
        """Test that disconnect() closes the pool."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_pool = AsyncMock()
        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            await handler.connect()
            await handler.disconnect()

            mock_pool.close.assert_called_once()
            assert handler._pool is None

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self):
        """Test that disconnect() works when pool is None."""
        handler = AuthHandler("postgresql://test:test@localhost/test")
        # Should not raise
        await handler.disconnect()

    @pytest.mark.asyncio
    async def test_validate_oauth_token(self):
        """Test that validate() handles OAuth tokens."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        with patch.object(handler, "_validate_oauth_token") as mock_validate:
            mock_validate.return_value = AuthContext(
                id="test-id",
                prefix="engram_oauth_abc",
                method="oauth",
                type="oauth",
                user_id="user-123",
                scopes=["memory:read"],
                rate_limit_rpm=1000,
            )

            result = await handler.validate("engram_oauth_abcdef1234567890abcdef1234567890")

            assert result is not None
            mock_validate.assert_called_once()

    @pytest.mark.asyncio
    async def test_validate_api_key(self):
        """Test that validate() handles API keys."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        with patch.object(handler, "_validate_api_key") as mock_validate:
            mock_validate.return_value = AuthContext(
                id="test-id",
                prefix="engram_test_abc",
                method="api_key",
                type="test",
                user_id="user-123",
                scopes=["memory:read"],
                rate_limit_rpm=1000,
            )

            result = await handler.validate("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

            assert result is not None
            mock_validate.assert_called_once()

    @pytest.mark.asyncio
    async def test_validate_invalid_format(self):
        """Test that validate() returns None for invalid format."""
        handler = AuthHandler("postgresql://test:test@localhost/test")
        result = await handler.validate("invalid-token")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_key_not_found(self):
        """Test _validate_api_key when key not found in database."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_key_inactive(self):
        """Test _validate_api_key when key is inactive."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "key_prefix": "engram_test_abc",
            "key_type": "test",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": False,
            "expires_at": None,
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_key_expired(self):
        """Test _validate_api_key when key is expired."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        expired_time = datetime.now(UTC) - timedelta(days=1)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "key_prefix": "engram_test_abc",
            "key_type": "test",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": expired_time,
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_key_expired_naive_datetime(self):
        """Test _validate_api_key when expires_at is timezone-naive."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        # Create naive datetime in the past
        expired_time = datetime.now() - timedelta(days=1)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "key_prefix": "engram_test_abc",
            "key_type": "test",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": expired_time,
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_key_success(self):
        """Test _validate_api_key with valid key."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        future_time = datetime.now(UTC) + timedelta(days=30)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "key_prefix": "engram_test_abc",
            "key_type": "test",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": future_time,
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        assert result is not None
        assert result.id == "test-id"
        assert result.method == "api_key"
        assert result.type == "test"
        assert result.scopes == ["memory:read"]

    @pytest.mark.asyncio
    async def test_validate_api_key_null_scopes(self):
        """Test _validate_api_key handles null scopes."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "key_prefix": "engram_test_abc",
            "key_type": "test",
            "user_id": "user-123",
            "scopes": None,
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": None,
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        assert result is not None
        assert result.scopes == []

    @pytest.mark.asyncio
    async def test_validate_oauth_token_not_found(self):
        """Test _validate_oauth_token when token not found."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_oauth_token("engram_oauth_abcdef1234567890abcdef1234567890")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_oauth_token_revoked(self):
        """Test _validate_oauth_token when token is revoked."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "access_token_prefix": "engram_oauth_abc",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "access_token_expires_at": datetime.now(UTC) + timedelta(days=30),
            "revoked_at": datetime.now(UTC),
            "user_name": "Test User",
            "user_email": "test@example.com",
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_oauth_token("engram_oauth_abcdef1234567890abcdef1234567890")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_oauth_token_expired(self):
        """Test _validate_oauth_token when token is expired."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        expired_time = datetime.now(UTC) - timedelta(days=1)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "access_token_prefix": "engram_oauth_abc",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "access_token_expires_at": expired_time,
            "revoked_at": None,
            "user_name": "Test User",
            "user_email": "test@example.com",
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_oauth_token("engram_oauth_abcdef1234567890abcdef1234567890")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_oauth_token_success(self):
        """Test _validate_oauth_token with valid token."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        future_time = datetime.now(UTC) + timedelta(days=30)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "access_token_prefix": "engram_oauth_abc",
            "user_id": "user-123",
            "scopes": ["memory:read", "memory:write"],
            "access_token_expires_at": future_time,
            "revoked_at": None,
            "user_name": "Test User",
            "user_email": "test@example.com",
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_oauth_token("engram_oauth_abcdef1234567890abcdef1234567890")
        assert result is not None
        assert result.id == "test-id"
        assert result.method == "oauth"
        assert result.type == "oauth"
        assert result.scopes == ["memory:read", "memory:write"]
        assert result.user_name == "Test User"
        assert result.user_email == "test@example.com"
        assert result.rate_limit_rpm == 1000

    @pytest.mark.asyncio
    async def test_validate_oauth_token_expired_naive_datetime(self):
        """Test _validate_oauth_token when expires_at is timezone-naive."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        # Create naive datetime in the past
        expired_time = datetime.now() - timedelta(days=1)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "access_token_prefix": "engram_oauth_abc",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "access_token_expires_at": expired_time,
            "revoked_at": None,
            "user_name": "Test User",
            "user_email": "test@example.com",
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        handler._pool = mock_pool

        result = await handler._validate_oauth_token("engram_oauth_abcdef1234567890abcdef1234567890")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_api_key_auto_connect(self):
        """Test _validate_api_key auto-connects if pool is None."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        future_time = datetime.now(UTC) + timedelta(days=30)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "key_prefix": "engram_test_abc",
            "key_type": "test",
            "user_id": "user-123",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": future_time,
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            # Pool starts as None
            assert handler._pool is None

            result = await handler._validate_api_key("engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

            # Should have auto-connected
            mock_create_pool.assert_called_once()
            assert result is not None

    @pytest.mark.asyncio
    async def test_validate_oauth_token_auto_connect(self):
        """Test _validate_oauth_token auto-connects if pool is None."""
        handler = AuthHandler("postgresql://test:test@localhost/test")

        future_time = datetime.now(UTC) + timedelta(days=30)

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": "test-id",
            "access_token_prefix": "engram_oauth_abc",
            "user_id": "user-123",
            "scopes": ["memory:read", "memory:write"],
            "access_token_expires_at": future_time,
            "revoked_at": None,
            "user_name": "Test User",
            "user_email": "test@example.com",
        }
        mock_conn.execute = AsyncMock()

        mock_pool = create_mock_pool_with_connection(mock_conn)

        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            # Pool starts as None
            assert handler._pool is None

            result = await handler._validate_oauth_token("engram_oauth_abcdef1234567890abcdef1234567890")

            # Should have auto-connected
            mock_create_pool.assert_called_once()
            assert result is not None


class TestAuthHandlerGlobals:
    """Tests for global auth handler management."""

    def test_set_and_get_auth_handler(self):
        """Test setting and getting global auth handler."""
        handler = AuthHandler("postgresql://test:test@localhost/test")
        set_auth_handler(handler)
        assert get_auth_handler() is handler

    def test_get_auth_handler_not_initialized(self):
        """Test get_auth_handler when not initialized."""
        with patch("src.middleware.auth._auth_handler", None):
            with pytest.raises(RuntimeError, match="Auth handler not initialized"):
                get_auth_handler()


class TestGetApiKey:
    """Tests for get_api_key dependency."""

    @pytest.mark.asyncio
    async def test_missing_credentials(self):
        """Test get_api_key with missing credentials."""
        request = Mock(spec=Request)

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key(request, None)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_token_format(self):
        """Test get_api_key with invalid token format."""
        request = Mock(spec=Request)
        credentials = Mock()
        credentials.credentials = "invalid-token"

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key(request, credentials)

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
        assert "Invalid token format" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_validation_error(self):
        """Test get_api_key when validation raises exception."""
        request = Mock(spec=Request)
        credentials = Mock()
        credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        mock_handler = AsyncMock()
        mock_handler.validate.side_effect = Exception("Database error")

        with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key(request, credentials)

            assert exc_info.value.status_code == 500
            assert exc_info.value.detail["error"]["code"] == "INTERNAL_ERROR"
            assert "Failed to validate token" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_token(self):
        """Test get_api_key when token is invalid."""
        request = Mock(spec=Request)
        request.state = Mock()
        credentials = Mock()
        credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        mock_handler = AsyncMock()
        mock_handler.validate.return_value = None

        with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
            with pytest.raises(HTTPException) as exc_info:
                await get_api_key(request, credentials)

            assert exc_info.value.status_code == 401
            assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
            assert "Invalid or expired token" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_valid_token(self):
        """Test get_api_key with valid token."""
        request = Mock(spec=Request)
        request.state = Mock()
        credentials = Mock()
        credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        auth_context = AuthContext(
            id="test-id",
            prefix="engram_test_abc",
            method="api_key",
            type="test",
            user_id="user-123",
            scopes=["memory:read"],
            rate_limit_rpm=1000,
        )

        mock_handler = AsyncMock()
        mock_handler.validate.return_value = auth_context

        with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
            result = await get_api_key(request, credentials)

            assert result is auth_context
            assert request.state.api_key is auth_context


class TestRequireAuth:
    """Tests for require_auth dependency."""

    def test_require_auth_returns_key(self):
        """Test that require_auth returns the API key context."""
        context = AuthContext(
            id="test-id",
            prefix="engram_test_abc",
            method="api_key",
            type="test",
            user_id="user-123",
            scopes=["memory:read"],
            rate_limit_rpm=1000,
        )

        result = require_auth(context)
        assert result is context


class TestRequireScope:
    """Tests for require_scope dependency factory."""

    @pytest.mark.asyncio
    async def test_require_scope_success(self):
        """Test require_scope when key has required scope."""
        context = AuthContext(
            id="test-id",
            prefix="engram_test_abc",
            method="api_key",
            type="test",
            user_id="user-123",
            scopes=["memory:read", "memory:write"],
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read")
        result = await checker(context)
        assert result is context

    @pytest.mark.asyncio
    async def test_require_scope_any_match(self):
        """Test require_scope matches any of the required scopes."""
        context = AuthContext(
            id="test-id",
            prefix="engram_test_abc",
            method="api_key",
            type="test",
            user_id="user-123",
            scopes=["memory:write"],
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read", "memory:write")
        result = await checker(context)
        assert result is context

    @pytest.mark.asyncio
    async def test_require_scope_missing(self):
        """Test require_scope when key lacks required scope."""
        context = AuthContext(
            id="test-id",
            prefix="engram_test_abc",
            method="api_key",
            type="test",
            user_id="user-123",
            scopes=["search:read"],
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read")

        with pytest.raises(HTTPException) as exc_info:
            await checker(context)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["error"]["code"] == "FORBIDDEN"
        assert "memory:read" in exc_info.value.detail["error"]["message"]


class TestInternalNetwork:
    """Tests for _is_internal_network function."""

    def test_internal_network_docker_range(self):
        """Test _is_internal_network recognizes Docker network."""
        assert _is_internal_network("172.17.0.2")
        assert _is_internal_network("172.31.255.255")

    def test_internal_network_localhost_excluded(self):
        """Test _is_internal_network excludes localhost."""
        assert not _is_internal_network("127.0.0.1")
        assert not _is_internal_network("localhost")

    def test_internal_network_external_ip(self):
        """Test _is_internal_network rejects external IPs."""
        assert not _is_internal_network("192.168.1.1")
        assert not _is_internal_network("10.0.0.1")

    def test_internal_network_none(self):
        """Test _is_internal_network handles None."""
        assert not _is_internal_network(None)


class TestOptionalScope:
    """Tests for optional_scope dependency factory."""

    @pytest.mark.asyncio
    async def test_optional_scope_auth_disabled(self):
        """Test optional_scope when auth is disabled."""
        with patch("src.middleware.auth.get_settings") as mock_settings:
            mock_settings.return_value.auth_enabled = False

            checker = optional_scope("memory:read")
            result = await checker()

            assert result.id == "anonymous"
            assert result.method == "dev"
            assert "*" in result.scopes

    @pytest.mark.asyncio
    async def test_optional_scope_internal_network(self):
        """Test optional_scope with internal network request."""
        with patch("src.middleware.auth.get_settings") as mock_settings:
            mock_settings.return_value.auth_enabled = True

            request = Mock(spec=Request)
            request.client = Mock()
            request.client.host = "172.17.0.2"

            checker = optional_scope("memory:read")
            result = await checker(request, None)

            assert result.id == "internal"
            assert result.method == "internal"
            assert "*" in result.scopes

    @pytest.mark.asyncio
    async def test_optional_scope_external_with_valid_auth(self):
        """Test optional_scope with external request and valid auth."""
        with patch("src.middleware.auth.get_settings") as mock_settings:
            mock_settings.return_value.auth_enabled = True

            request = Mock(spec=Request)
            request.state = Mock()
            request.client = Mock()
            request.client.host = "203.0.113.1"

            credentials = Mock()
            credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

            auth_context = AuthContext(
                id="test-id",
                prefix="engram_test_abc",
                method="api_key",
                type="test",
                user_id="user-123",
                scopes=["memory:read", "memory:write"],
                rate_limit_rpm=1000,
            )

            mock_handler = AsyncMock()
            mock_handler.validate.return_value = auth_context

            with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
                checker = optional_scope("memory:read")
                result = await checker(request, credentials)

                assert result is auth_context

    @pytest.mark.asyncio
    async def test_optional_scope_external_missing_scope(self):
        """Test optional_scope with external request missing required scope."""
        with patch("src.middleware.auth.get_settings") as mock_settings:
            mock_settings.return_value.auth_enabled = True

            request = Mock(spec=Request)
            request.state = Mock()
            request.client = Mock()
            request.client.host = "203.0.113.1"

            credentials = Mock()
            credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

            auth_context = AuthContext(
                id="test-id",
                prefix="engram_test_abc",
                method="api_key",
                type="test",
                user_id="user-123",
                scopes=["search:read"],
                rate_limit_rpm=1000,
            )

            mock_handler = AsyncMock()
            mock_handler.validate.return_value = auth_context

            with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
                checker = optional_scope("memory:read")

                with pytest.raises(HTTPException) as exc_info:
                    await checker(request, credentials)

                assert exc_info.value.status_code == 403
                assert "memory:read" in exc_info.value.detail["error"]["message"]


class TestAuthMiddleware:
    """Tests for authentication middleware integration."""

    @pytest.mark.asyncio
    async def test_unauthenticated_request_returns_401(self, unauthenticated_client):
        """Test that requests without auth header return 401."""
        response = await unauthenticated_client.post(
            "/v1/search/query",
            json={"text": "test query"},
        )
        assert response.status_code == 401
        data = response.json()
        assert data["detail"]["error"]["code"] == "UNAUTHORIZED"
        assert "Missing Authorization header" in data["detail"]["error"]["message"]

    @pytest.mark.asyncio
    async def test_invalid_key_format_returns_401(self, unauthenticated_client):
        """Test that invalid API key format returns 401."""
        response = await unauthenticated_client.post(
            "/v1/search/query",
            json={"text": "test query"},
            headers={"Authorization": "Bearer invalid-key"},
        )
        assert response.status_code == 401
        data = response.json()
        assert data["detail"]["error"]["code"] == "UNAUTHORIZED"
        assert "Invalid token format" in data["detail"]["error"]["message"]

    @pytest.mark.asyncio
    async def test_health_endpoint_no_auth_required(self, unauthenticated_client):
        """Test that health endpoint works without authentication."""
        response = await unauthenticated_client.get("/v1/search/health")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_ready_endpoint_no_auth_required(self, unauthenticated_client):
        """Test that ready endpoint works without authentication."""
        response = await unauthenticated_client.get("/v1/search/ready")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_metrics_endpoint_no_auth_required(self, unauthenticated_client):
        """Test that metrics endpoint works without authentication."""
        response = await unauthenticated_client.get("/v1/search/metrics")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_authenticated_request_succeeds(self, client):
        """Test that authenticated request proceeds to handler."""
        # This will still fail if Qdrant isn't available, but with 503 not 401
        response = await client.post(
            "/v1/search/query",
            json={"text": "test query"},
        )
        # Should not be 401 - auth succeeded
        assert response.status_code != 401

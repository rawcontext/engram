"""Extended tests for API key authentication middleware."""

import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient

from src.middleware.auth import (
    API_KEY_PATTERN,
    ApiKeyAuth,
    ApiKeyContext,
    get_api_key,
    get_auth_handler,
    hash_api_key,
    require_auth,
    require_scope,
    set_auth_handler,
)


class TestApiKeyPattern:
    """Tests for API key format validation."""

    def test_valid_live_key_matches(self) -> None:
        """Test that valid live API keys match the pattern."""
        key = "engram_live_abcdefghijklmnopqrstuvwxyz123456"
        assert API_KEY_PATTERN.match(key) is not None

    def test_valid_test_key_matches(self) -> None:
        """Test that valid test API keys match the pattern."""
        key = "engram_test_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456"
        assert API_KEY_PATTERN.match(key) is not None

    def test_mixed_case_key_matches(self) -> None:
        """Test that mixed case alphanumeric keys match."""
        # engram_test_ prefix + exactly 32 alphanumeric chars (26 letters + 6 digits)
        key = "engram_test_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456"  # Mixed case, 32 chars
        assert API_KEY_PATTERN.match(key) is not None

    def test_short_key_does_not_match(self) -> None:
        """Test that short keys don't match."""
        key = "engram_test_abc123"  # Too short
        assert API_KEY_PATTERN.match(key) is None

    def test_long_key_does_not_match(self) -> None:
        """Test that long keys don't match."""
        key = "engram_test_abcdefghijklmnopqrstuvwxyz12345678"  # Too long (33 chars)
        assert API_KEY_PATTERN.match(key) is None

    def test_invalid_prefix_does_not_match(self) -> None:
        """Test that invalid prefix doesn't match."""
        key = "engram_prod_abcdefghijklmnopqrstuvwxyz123456"
        assert API_KEY_PATTERN.match(key) is None

    def test_special_chars_do_not_match(self) -> None:
        """Test that special characters don't match."""
        key = "engram_test_abcdefghijklmnopqrstuvwxyz12345!"
        assert API_KEY_PATTERN.match(key) is None

    def test_no_underscore_does_not_match(self) -> None:
        """Test that keys without proper underscores don't match."""
        key = "engram-test-abcdefghijklmnopqrstuvwxyz123456"
        assert API_KEY_PATTERN.match(key) is None


class TestHashApiKey:
    """Tests for API key hashing."""

    def test_hash_returns_hex_string(self) -> None:
        """Test that hash returns a hex string."""
        key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        result = hash_api_key(key)
        assert isinstance(result, str)
        assert len(result) == 64  # SHA-256 hex is 64 chars

    def test_hash_is_deterministic(self) -> None:
        """Test that same key produces same hash."""
        key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        hash1 = hash_api_key(key)
        hash2 = hash_api_key(key)
        assert hash1 == hash2

    def test_different_keys_have_different_hashes(self) -> None:
        """Test that different keys produce different hashes."""
        key1 = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        key2 = "engram_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        assert hash_api_key(key1) != hash_api_key(key2)

    def test_hash_matches_sha256(self) -> None:
        """Test that hash matches expected SHA-256."""
        key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        expected = hashlib.sha256(key.encode()).hexdigest()
        assert hash_api_key(key) == expected


class TestApiKeyContext:
    """Tests for ApiKeyContext dataclass."""

    def test_context_creation(self) -> None:
        """Test creating an API key context."""
        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_abc...",
            key_type="test",
            user_id="user-456",
            scopes=["memory:read", "search:read"],
            rate_limit_rpm=1000,
        )
        assert context.key_id == "key-123"
        assert context.key_type == "test"
        assert "memory:read" in context.scopes

    def test_context_with_no_user_id(self) -> None:
        """Test context with None user_id."""
        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_abc...",
            key_type="test",
            user_id=None,
            scopes=[],
            rate_limit_rpm=100,
        )
        assert context.user_id is None


class TestApiKeyAuth:
    """Tests for ApiKeyAuth class."""

    @pytest.fixture
    def auth_handler(self) -> ApiKeyAuth:
        """Create auth handler with test database URL."""
        return ApiKeyAuth(database_url="postgresql://test:test@localhost/test")

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self, auth_handler: ApiKeyAuth) -> None:
        """Test that disconnect is safe when not connected."""
        assert auth_handler._pool is None
        await auth_handler.disconnect()  # Should not raise

    @pytest.mark.asyncio
    async def test_validate_invalid_format(self, auth_handler: ApiKeyAuth) -> None:
        """Test that invalid format returns None."""
        result = await auth_handler.validate("invalid-key")
        assert result is None


class TestGlobalAuthHandler:
    """Tests for global auth handler functions."""

    def test_set_and_get_auth_handler(self) -> None:
        """Test setting and getting global auth handler."""
        handler = ApiKeyAuth(database_url="postgresql://test:test@localhost/test")
        set_auth_handler(handler)
        result = get_auth_handler()
        assert result is handler

    def test_get_auth_handler_not_set_raises(self) -> None:
        """Test that getting unset handler raises RuntimeError."""
        # Reset global handler
        with patch("src.middleware.auth._auth_handler", None):
            with pytest.raises(RuntimeError, match="Auth handler not initialized"):
                get_auth_handler()


class TestRequireAuth:
    """Tests for require_auth dependency."""

    def test_require_auth_returns_key(self) -> None:
        """Test that require_auth returns the key context."""
        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_abc...",
            key_type="test",
            user_id="user-456",
            scopes=["memory:read"],
            rate_limit_rpm=1000,
        )
        result = require_auth(context)
        assert result is context


class TestRequireScope:
    """Tests for require_scope dependency factory."""

    @pytest.mark.asyncio
    async def test_require_scope_allows_matching_scope(self) -> None:
        """Test that require_scope allows matching scope."""
        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_abc...",
            key_type="test",
            user_id="user-456",
            scopes=["memory:read", "search:read"],
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read")

        # Mock the get_api_key dependency
        with patch("src.middleware.auth.get_api_key", return_value=context):
            # The checker should not raise
            result = await checker(context)
            assert result is context

    @pytest.mark.asyncio
    async def test_require_scope_allows_any_of_multiple(self) -> None:
        """Test that require_scope allows any of multiple scopes."""
        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_abc...",
            key_type="test",
            user_id="user-456",
            scopes=["search:read"],  # Has only one of the required
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read", "search:read")
        result = await checker(context)
        assert result is context

    @pytest.mark.asyncio
    async def test_require_scope_denies_missing_scope(self) -> None:
        """Test that require_scope denies missing scope."""
        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_abc...",
            key_type="test",
            user_id="user-456",
            scopes=["other:scope"],  # Doesn't have required scope
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read")

        with pytest.raises(HTTPException) as exc_info:
            await checker(context)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["error"]["code"] == "FORBIDDEN"


class TestApiKeyAuthValidate:
    """Tests for ApiKeyAuth.validate method with mocked database."""

    @pytest.fixture
    def auth_handler(self) -> ApiKeyAuth:
        """Create auth handler with test database URL."""
        return ApiKeyAuth(database_url="postgresql://test:test@localhost/test")

    @pytest.fixture
    def mock_pool_with_conn(self):
        """Create mock pool with async context manager for connection."""
        mock_pool = MagicMock()
        mock_conn = MagicMock()
        mock_conn.fetchrow = AsyncMock(return_value=None)
        mock_conn.execute = AsyncMock()

        # Setup async context manager for acquire()
        async_cm = AsyncMock()
        async_cm.__aenter__.return_value = mock_conn
        async_cm.__aexit__.return_value = None
        mock_pool.acquire.return_value = async_cm
        mock_pool.close = AsyncMock()

        return mock_pool, mock_conn

    @pytest.mark.asyncio
    async def test_connect_creates_pool(self, auth_handler: ApiKeyAuth) -> None:
        """Test that connect creates a database pool."""
        mock_pool = MagicMock()

        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            await auth_handler.connect()

            mock_create_pool.assert_called_once()
            assert auth_handler._pool == mock_pool

    @pytest.mark.asyncio
    async def test_connect_noop_when_already_connected(
        self, auth_handler: ApiKeyAuth
    ) -> None:
        """Test that connect does nothing when already connected."""
        mock_pool = MagicMock()
        auth_handler._pool = mock_pool

        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            await auth_handler.connect()
            mock_create_pool.assert_not_called()

    @pytest.mark.asyncio
    async def test_disconnect_closes_pool(self, auth_handler: ApiKeyAuth) -> None:
        """Test that disconnect closes the pool."""
        mock_pool = MagicMock()
        mock_pool.close = AsyncMock()
        auth_handler._pool = mock_pool

        await auth_handler.disconnect()

        mock_pool.close.assert_called_once()
        assert auth_handler._pool is None

    @pytest.mark.asyncio
    async def test_validate_connects_if_not_connected(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate connects to database if not connected."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn

        with patch("src.middleware.auth.asyncpg.create_pool", new_callable=AsyncMock) as mock_create_pool:
            mock_create_pool.return_value = mock_pool

            result = await auth_handler.validate(valid_key)

            assert result is None
            mock_create_pool.assert_called_once()

    @pytest.mark.asyncio
    async def test_validate_returns_none_for_not_found(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate returns None if key not found."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        auth_handler._pool = mock_pool

        result = await auth_handler.validate(valid_key)

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_returns_none_for_inactive_key(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate returns None for inactive key."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_test_aaa...",
            "key_type": "test",
            "user_id": "user-456",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": False,  # Inactive
            "expires_at": None,
        }
        auth_handler._pool = mock_pool

        result = await auth_handler.validate(valid_key)

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_returns_none_for_expired_key(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate returns None for expired key."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_test_aaa...",
            "key_type": "test",
            "user_id": "user-456",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": datetime.now(UTC) - timedelta(days=1),  # Expired
        }
        auth_handler._pool = mock_pool

        result = await auth_handler.validate(valid_key)

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_returns_none_for_expired_naive_datetime(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate handles naive datetime expiration."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        # Naive datetime (no tzinfo)
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_test_aaa...",
            "key_type": "test",
            "user_id": "user-456",
            "scopes": ["memory:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": datetime.now() - timedelta(days=1),  # Naive, expired
        }
        auth_handler._pool = mock_pool

        result = await auth_handler.validate(valid_key)

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_returns_context_for_valid_key(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate returns context for valid key."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_test_aaa...",
            "key_type": "test",
            "user_id": "user-456",
            "scopes": ["memory:read", "search:read"],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": datetime.now(UTC) + timedelta(days=30),  # Valid
        }
        auth_handler._pool = mock_pool

        result = await auth_handler.validate(valid_key)

        assert result is not None
        assert result.key_id == "key-123"
        assert result.key_type == "test"
        assert "memory:read" in result.scopes

    @pytest.mark.asyncio
    async def test_validate_returns_context_with_no_expiry(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate returns context for key with no expiry."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_test_aaa...",
            "key_type": "test",
            "user_id": None,
            "scopes": None,  # Test None scopes
            "rate_limit_rpm": 500,
            "is_active": True,
            "expires_at": None,  # No expiry
        }
        auth_handler._pool = mock_pool

        result = await auth_handler.validate(valid_key)

        assert result is not None
        assert result.key_id == "key-123"
        assert result.user_id is None
        assert result.scopes == []  # Should default to empty list

    @pytest.mark.asyncio
    async def test_validate_updates_last_used_at(
        self, auth_handler: ApiKeyAuth, mock_pool_with_conn
    ) -> None:
        """Test that validate updates last_used_at."""
        valid_key = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        mock_pool, mock_conn = mock_pool_with_conn
        mock_conn.fetchrow.return_value = {
            "id": "key-123",
            "key_prefix": "engram_test_aaa...",
            "key_type": "test",
            "user_id": "user-456",
            "scopes": [],
            "rate_limit_rpm": 1000,
            "is_active": True,
            "expires_at": None,
        }
        auth_handler._pool = mock_pool

        await auth_handler.validate(valid_key)

        # Should have called execute to update last_used_at
        mock_conn.execute.assert_called_once()
        call_args = mock_conn.execute.call_args[0]
        assert "UPDATE api_keys SET last_used_at" in call_args[0]


class TestGetApiKey:
    """Tests for get_api_key dependency."""

    @pytest.mark.asyncio
    async def test_get_api_key_missing_credentials(self) -> None:
        """Test get_api_key raises 401 when credentials missing."""
        mock_request = MagicMock()

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key(mock_request, None)

        assert exc_info.value.status_code == 401
        assert "Missing Authorization header" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_invalid_format(self) -> None:
        """Test get_api_key raises 401 for invalid format."""
        mock_request = MagicMock()
        mock_credentials = MagicMock()
        mock_credentials.credentials = "invalid-key"

        with pytest.raises(HTTPException) as exc_info:
            await get_api_key(mock_request, mock_credentials)

        assert exc_info.value.status_code == 401
        assert "Invalid API key format" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_validation_error(self) -> None:
        """Test get_api_key raises 500 on validation error."""
        mock_request = MagicMock()
        mock_credentials = MagicMock()
        mock_credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        mock_handler = MagicMock()
        mock_handler.validate = AsyncMock(side_effect=Exception("DB connection failed"))

        with (
            patch("src.middleware.auth.get_auth_handler", return_value=mock_handler),
            pytest.raises(HTTPException) as exc_info,
        ):
            await get_api_key(mock_request, mock_credentials)

        assert exc_info.value.status_code == 500
        assert "Failed to validate API key" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_invalid_or_expired(self) -> None:
        """Test get_api_key raises 401 for invalid/expired key."""
        mock_request = MagicMock()
        mock_credentials = MagicMock()
        mock_credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        mock_handler = MagicMock()
        mock_handler.validate = AsyncMock(return_value=None)  # Key not found

        with (
            patch("src.middleware.auth.get_auth_handler", return_value=mock_handler),
            pytest.raises(HTTPException) as exc_info,
        ):
            await get_api_key(mock_request, mock_credentials)

        assert exc_info.value.status_code == 401
        assert "Invalid or expired API key" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_get_api_key_success(self) -> None:
        """Test get_api_key returns context on success."""
        mock_request = MagicMock()
        mock_request.state = MagicMock()
        mock_credentials = MagicMock()
        mock_credentials.credentials = "engram_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

        context = ApiKeyContext(
            key_id="key-123",
            key_prefix="engram_test_aaa...",
            key_type="test",
            user_id="user-456",
            scopes=["memory:read"],
            rate_limit_rpm=1000,
        )

        mock_handler = MagicMock()
        mock_handler.validate = AsyncMock(return_value=context)

        with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
            result = await get_api_key(mock_request, mock_credentials)

        assert result is context
        assert mock_request.state.api_key is context

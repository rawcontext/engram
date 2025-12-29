"""Tests for OAuth authentication middleware."""

from unittest.mock import AsyncMock, MagicMock, Mock, patch

import httpx
import pytest
from fastapi import HTTPException, Request

from src.middleware.auth import (
    CLIENT_TOKEN_PATTERN,
    USER_TOKEN_PATTERN,
    AuthContext,
    AuthHandler,
    _is_internal_network,
    get_api_key,
    get_auth_handler,
    optional_scope,
    require_auth,
    require_scope,
    set_auth_handler,
)


class TestPatterns:
    """Tests for regex patterns."""

    def test_user_token_pattern_matches_valid_token(self):
        """Test that USER_TOKEN_PATTERN matches valid user tokens."""
        # Format: egm_oauth_{32_hex}_{6_base62}
        assert USER_TOKEN_PATTERN.match("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

    def test_user_token_pattern_rejects_invalid_chars(self):
        """Test that USER_TOKEN_PATTERN rejects non-hex chars in random portion."""
        assert not USER_TOKEN_PATTERN.match("egm_oauth_gggggggggggggggggggggggggggggggg_X7kM2p")

    def test_user_token_pattern_rejects_legacy_format(self):
        """Test that USER_TOKEN_PATTERN rejects legacy engram_oauth format."""
        assert not USER_TOKEN_PATTERN.match("engram_oauth_abcdef1234567890abcdef1234567890")

    def test_client_token_pattern_matches_valid_token(self):
        """Test that CLIENT_TOKEN_PATTERN matches valid client tokens."""
        # Format: egm_client_{32_hex}_{6_base62}
        assert CLIENT_TOKEN_PATTERN.match("egm_client_abcdef1234567890abcdef1234567890_Y8nL3q")

    def test_client_token_pattern_rejects_user_token(self):
        """Test that CLIENT_TOKEN_PATTERN rejects user tokens."""
        assert not CLIENT_TOKEN_PATTERN.match("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")


class TestAuthHandler:
    """Tests for AuthHandler class."""

    @pytest.mark.asyncio
    async def test_connect_creates_http_client(self):
        """Test that connect() creates an HTTP client."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
            client_secret="test-secret",
        )

        await handler.connect()
        assert handler._http_client is not None
        assert isinstance(handler._http_client, httpx.AsyncClient)

        await handler.disconnect()

    @pytest.mark.asyncio
    async def test_connect_idempotent(self):
        """Test that connect() is idempotent."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        await handler.connect()
        first_client = handler._http_client

        await handler.connect()  # Second call should do nothing
        assert handler._http_client is first_client

        await handler.disconnect()

    @pytest.mark.asyncio
    async def test_disconnect_closes_client(self):
        """Test that disconnect() closes the HTTP client."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        await handler.connect()
        await handler.disconnect()

        assert handler._http_client is None

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self):
        """Test that disconnect() works when client is None."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )
        # Should not raise
        await handler.disconnect()

    @pytest.mark.asyncio
    async def test_validate_user_token_success(self):
        """Test validating a user token via introspection."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "active": True,
            "sub": "user-123",
            "scope": "memory:read memory:write",
            "name": "Test User",
            "email": "test@example.com",
        }

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        assert result is not None
        assert result.user_id == "user-123"
        assert result.method == "oauth"
        assert result.type == "oauth"
        assert result.scopes == ["memory:read", "memory:write"]
        assert result.user_name == "Test User"
        assert result.user_email == "test@example.com"

    @pytest.mark.asyncio
    async def test_validate_client_token_success(self):
        """Test validating a client credentials token via introspection."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "active": True,
            "client_id": "engram-search",
            "scope": "memory:read query:read",
        }

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_client_abcdef1234567890abcdef1234567890_Y8nL3q")

        assert result is not None
        assert result.user_id == "engram-search"
        assert result.method == "client_credentials"
        assert result.type == "client"
        assert result.scopes == ["memory:read", "query:read"]

    @pytest.mark.asyncio
    async def test_validate_inactive_token(self):
        """Test that inactive tokens return None."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"active": False}

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        assert result is None

    @pytest.mark.asyncio
    async def test_validate_invalid_format(self):
        """Test that invalid token formats return None."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        result = await handler.validate("invalid-token")
        assert result is None

    @pytest.mark.asyncio
    async def test_validate_network_error(self):
        """Test that network errors return None."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        mock_http_client = AsyncMock()
        mock_http_client.post.side_effect = httpx.RequestError("Connection failed")
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")
        assert result is None


class TestAuthHandlerGlobals:
    """Tests for global auth handler management."""

    def test_set_and_get_auth_handler(self):
        """Test setting and getting global auth handler."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )
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
    async def test_valid_token(self):
        """Test get_api_key with valid token."""
        request = Mock(spec=Request)
        request.state = Mock()
        request.headers = {"DPoP": None}
        credentials = Mock()
        credentials.credentials = "egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"

        auth_context = AuthContext(
            id="user-123",
            prefix="egm_oauth_abcdef12345...",
            method="oauth",
            type="oauth",
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
        """Test that require_auth returns the auth context."""
        context = AuthContext(
            id="user-123",
            prefix="egm_oauth_abcdef12345...",
            method="oauth",
            type="oauth",
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
        """Test require_scope when token has required scope."""
        context = AuthContext(
            id="user-123",
            prefix="egm_oauth_abcdef12345...",
            method="oauth",
            type="oauth",
            user_id="user-123",
            scopes=["memory:read", "memory:write"],
            rate_limit_rpm=1000,
        )

        checker = require_scope("memory:read")
        result = await checker(context)
        assert result is context

    @pytest.mark.asyncio
    async def test_require_scope_missing(self):
        """Test require_scope when token lacks required scope."""
        context = AuthContext(
            id="user-123",
            prefix="egm_oauth_abcdef12345...",
            method="oauth",
            type="oauth",
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
        """Test that invalid token format returns 401."""
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


class TestScopeEnforcement:
    """Tests for scope enforcement per client registration (RFC 6749 §3.3)."""

    @pytest.mark.asyncio
    async def test_client_token_with_insufficient_scopes_returns_403(self):
        """Test that client token lacking required scope is rejected."""
        # Client registered with scope='memory:read query:read'
        # Attempting to access endpoint requiring 'memory:write'
        context = AuthContext(
            id="engram-search",
            prefix="egm_client_abc123...",
            method="client_credentials",
            type="client",
            user_id="engram-search",
            scopes=["memory:read", "query:read"],  # Missing memory:write
            rate_limit_rpm=1000,
        )

        # Simulate require_scope("memory:write") dependency
        checker = require_scope("memory:write")

        with pytest.raises(HTTPException) as exc_info:
            await checker(context)

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail["error"]["code"] == "FORBIDDEN"
        assert "memory:write" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_client_token_with_exact_scopes_allows_access(self):
        """Test that client token with exact scopes can access endpoint."""
        context = AuthContext(
            id="engram-search",
            prefix="egm_client_abc123...",
            method="client_credentials",
            type="client",
            user_id="engram-search",
            scopes=["memory:read", "query:read"],
            rate_limit_rpm=1000,
        )

        # Check access to endpoint requiring memory:read
        checker = require_scope("memory:read")
        result = await checker(context)

        assert result is context

    @pytest.mark.asyncio
    async def test_client_token_cannot_access_mcp_scopes(self):
        """Test that client token cannot access MCP-specific scopes."""
        # engram-search client registered with scope='memory:read query:read'
        # Should not have access to mcp:tools, mcp:resources, mcp:prompts
        context = AuthContext(
            id="engram-search",
            prefix="egm_client_abc123...",
            method="client_credentials",
            type="client",
            user_id="engram-search",
            scopes=["memory:read", "query:read"],
            rate_limit_rpm=1000,
        )

        # Try to access MCP tools scope
        checker = require_scope("mcp:tools")

        with pytest.raises(HTTPException) as exc_info:
            await checker(context)

        assert exc_info.value.status_code == 403
        assert "mcp:tools" in exc_info.value.detail["error"]["message"]

    @pytest.mark.asyncio
    async def test_user_token_with_mcp_scopes_allows_access(self):
        """Test that user OAuth token with MCP scopes can access MCP endpoints."""
        context = AuthContext(
            id="user-123",
            prefix="egm_oauth_abc123...",
            method="oauth",
            type="oauth",
            user_id="user-123",
            scopes=["mcp:tools", "mcp:resources", "mcp:prompts"],
            rate_limit_rpm=100,
        )

        # Check access to MCP tools
        checker = require_scope("mcp:tools")
        result = await checker(context)

        assert result is context

    @pytest.mark.asyncio
    async def test_scope_validation_matches_client_registration(self):
        """Test that scope enforcement reflects client registration constraints."""
        # engram-tuner client registered with scope='memory:read memory:write tuner:read tuner:write'
        context = AuthContext(
            id="engram-tuner",
            prefix="egm_client_xyz789...",
            method="client_credentials",
            type="client",
            user_id="engram-tuner",
            scopes=["memory:read", "memory:write", "tuner:read", "tuner:write"],
            rate_limit_rpm=1000,
        )

        # Should allow tuner:read
        checker_tuner = require_scope("tuner:read")
        result = await checker_tuner(context)
        assert result is context

        # Should allow memory:write
        checker_memory = require_scope("memory:write")
        result = await checker_memory(context)
        assert result is context

        # Should NOT allow query:read (not in registration)
        checker_query = require_scope("query:read")
        with pytest.raises(HTTPException) as exc_info:
            await checker_query(context)

        assert exc_info.value.status_code == 403
        assert "query:read" in exc_info.value.detail["error"]["message"]


class TestClientTokenIntegration:
    """Integration tests for client credentials token validation."""

    @pytest.mark.asyncio
    async def test_client_token_accepted_for_query_endpoint(self, app):
        """Test that client credentials tokens authenticate correctly."""
        from httpx import ASGITransport, AsyncClient

        # Create a valid client credentials token
        valid_client_token = "egm_client_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_Y8nL3q"

        # Mock auth handler to return client credentials context
        client_auth_context = AuthContext(
            id="engram-search",
            prefix="egm_client_a1b2c3d4e5...",
            method="client_credentials",
            type="client",
            user_id="engram-search",
            scopes=["memory:read", "query:read"],
            rate_limit_rpm=5000,
        )

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=client_auth_context)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": f"Bearer {valid_client_token}"},
            ) as client:
                # Make a request to the query endpoint
                response = await client.post(
                    "/v1/search/query",
                    json={
                        "text": "test query",
                        "strategy": "hybrid",
                        "limit": 10,
                    },
                )

                # Should NOT return 401 or 403 - auth passed
                # May return 503 (service unavailable) if retriever not initialized
                assert response.status_code != 401
                assert response.status_code != 403

                # Verify the auth handler was called with the token
                mock_handler.validate.assert_called_once()
                call_args = mock_handler.validate.call_args
                assert call_args[0][0] == valid_client_token

    @pytest.mark.asyncio
    async def test_client_token_with_insufficient_scope_rejected(self, app):
        """Test that client tokens without required scope are rejected."""
        from httpx import ASGITransport, AsyncClient

        valid_client_token = "egm_client_b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7_Z9oP4r"

        # Mock auth handler to return client with insufficient scopes
        client_auth_context = AuthContext(
            id="engram-api",
            prefix="egm_client_b2c3d4e5f6...",
            method="client_credentials",
            type="client",
            user_id="engram-api",
            scopes=["memory:write"],  # Missing search:read scope
            rate_limit_rpm=5000,
        )

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=client_auth_context)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": f"Bearer {valid_client_token}"},
            ) as client:
                response = await client.post(
                    "/v1/search/query",
                    json={
                        "text": "test query",
                        "strategy": "hybrid",
                        "limit": 10,
                    },
                )

                # Should return 403 for insufficient scope
                assert response.status_code == 403
                data = response.json()
                assert data["detail"]["error"]["code"] == "FORBIDDEN"

    @pytest.mark.asyncio
    async def test_client_token_format_validation(self, unauthenticated_client):
        """Test that client token format is validated correctly."""
        # Invalid client token format (wrong prefix)
        response = await unauthenticated_client.post(
            "/v1/search/query",
            json={"text": "test query"},
            headers={"Authorization": "Bearer egm_oauth_invalidclienttoken123_ABC123"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_client_token_with_memory_read_scope(self, app):
        """Test client token with memory:read scope authenticates successfully."""
        from httpx import ASGITransport, AsyncClient

        valid_client_token = "egm_client_c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8_A0qR5s"

        client_auth_context = AuthContext(
            id="engram-memory",
            prefix="egm_client_c3d4e5f6a7...",
            method="client_credentials",
            type="client",
            user_id="engram-memory",
            scopes=["memory:read"],
            rate_limit_rpm=10000,
        )

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=client_auth_context)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": f"Bearer {valid_client_token}"},
            ) as client:
                response = await client.post(
                    "/v1/search/query",
                    json={
                        "text": "test query",
                        "strategy": "dense",
                        "limit": 5,
                    },
                )

                # Should NOT return 401 or 403 - auth passed
                assert response.status_code != 401
                assert response.status_code != 403


class TestUserTokenIntegration:
    """Integration tests for user OAuth token validation."""

    @pytest.mark.asyncio
    async def test_user_token_accepted_for_query_endpoint(self, app):
        """Test that user OAuth tokens authenticate correctly."""
        from httpx import ASGITransport, AsyncClient

        valid_user_token = "egm_oauth_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6_X7kM2p"

        user_auth_context = AuthContext(
            id="user-123",
            prefix="egm_oauth_a1b2c3d4e5...",
            method="oauth",
            type="oauth",
            user_id="user-123",
            scopes=["memory:read", "memory:write"],
            rate_limit_rpm=1000,
            user_name="Test User",
            user_email="test@example.com",
        )

        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=user_auth_context)

        with patch("src.middleware.auth._auth_handler", mock_handler):
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport,
                base_url="http://test",
                headers={"Authorization": f"Bearer {valid_user_token}"},
            ) as client:
                response = await client.post(
                    "/v1/search/query",
                    json={
                        "text": "test query",
                        "strategy": "hybrid",
                        "limit": 10,
                    },
                )

                # Should NOT return 401 or 403 - auth passed
                assert response.status_code != 401
                assert response.status_code != 403
                mock_handler.validate.assert_called_once()

"""Tests for OAuth token expiration handling in Python services.

Client credentials grant does NOT issue refresh tokens (RFC 6749 Section 4.4.3).
Services using httpx must request new access tokens when current token expires.

ACCESS_TOKEN_EXPIRES_IN = 7 days (604800 seconds)
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from fastapi import Request

from src.middleware.auth import (
    AuthHandler,
    get_api_key,
)


class TestTokenExpiration:
    """Tests for expired token rejection."""

    @pytest.mark.asyncio
    async def test_expired_token_returns_inactive(self):
        """Test that expired tokens return active=false from introspection."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # Mock introspection response for expired token
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "active": False,  # Expired tokens return active=false
        }

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        assert result is None  # Expired tokens return None

    @pytest.mark.asyncio
    async def test_valid_token_with_future_expiry(self):
        """Test that valid tokens with future expiry return active=true."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # Token expires in 7 days
        exp_timestamp = int((datetime.now(UTC) + timedelta(days=7)).timestamp())

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json = Mock(return_value={
            "active": True,
            "sub": "user-123",
            "scope": "memory:read memory:write",
            "exp": exp_timestamp,
        })

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        assert result is not None
        assert result.user_id == "user-123"
        assert result.scopes == ["memory:read", "memory:write"]

    @pytest.mark.asyncio
    async def test_get_api_key_rejects_expired_token(self):
        """Test that get_api_key raises 401 for expired tokens."""
        request = Mock(spec=Request)
        request.state = Mock()
        request.headers = Mock()
        request.headers.get.return_value = None  # No DPoP header
        request.method = "POST"
        request.url = "http://localhost:6176/v1/search/query"

        credentials = Mock()
        credentials.credentials = "egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"

        # Mock handler that returns None (expired token)
        mock_handler = AsyncMock()
        mock_handler.validate.return_value = None

        with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
            with pytest.raises(Exception) as exc_info:
                await get_api_key(request, credentials)

            # Verify we get 401 UNAUTHORIZED
            assert exc_info.value.status_code == 401
            assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
            assert "Invalid or expired token" in exc_info.value.detail["error"]["message"]


class TestClientCredentialsExpiration:
    """Tests for client credentials token expiration (no refresh tokens)."""

    @pytest.mark.asyncio
    async def test_expired_client_token_rejected(self):
        """Test that expired client credentials tokens are rejected.

        Client credentials grant does NOT issue refresh tokens per RFC 6749 Section 4.4.3.
        Services must request new tokens from /api/auth/token.
        """
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="engram-search",
            client_secret="test-secret",
        )

        # Expired client credentials token
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "active": False,  # Expired
        }

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_client_abcdef1234567890abcdef1234567890_Y8nL3q")

        # Service must request new token (no refresh token available)
        assert result is None

    @pytest.mark.asyncio
    async def test_valid_client_token_accepted(self):
        """Test that valid client credentials tokens are accepted."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="engram-search",
            client_secret="test-secret",
        )

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json = Mock(return_value={
            "active": True,
            "client_id": "engram-search",
            "scope": "memory:read query:read",
        })

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        handler._http_client = mock_http_client

        result = await handler.validate("egm_client_abcdef1234567890abcdef1234567890_Y8nL3q")

        assert result is not None
        assert result.user_id == "engram-search"
        assert result.method == "client_credentials"
        assert result.type == "client"
        assert result.scopes == ["memory:read", "query:read"]


class TestTokenReauthentication:
    """Tests for service re-authentication patterns.

    These tests verify the expected behavior when services receive 401 responses.
    Actual auto-retry logic should be implemented in HTTP client wrappers.
    """

    @pytest.mark.asyncio
    async def test_introspection_endpoint_handles_expired_token(self):
        """Test that introspection endpoint returns active=false for expired tokens."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # Simulate introspection endpoint behavior for expired token
        mock_response = AsyncMock()
        mock_response.status_code = 200  # Introspection always returns 200
        mock_response.json.return_value = {
            "active": False,  # Token is expired or revoked
        }

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_expired_token_example_here_abcd_X7kM2p")

        assert result is None

    @pytest.mark.asyncio
    async def test_network_error_during_validation(self):
        """Test that network errors during validation return None."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # Simulate network timeout or connection error
        mock_http_client = AsyncMock()
        mock_http_client.post.side_effect = httpx.TimeoutException("Request timed out")
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        assert result is None

    @pytest.mark.asyncio
    async def test_introspection_endpoint_500_error(self):
        """Test handling of 5xx errors from introspection endpoint."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # Introspection endpoint returns 500 Internal Server Error
        mock_response = AsyncMock()
        mock_response.status_code = 500

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        # Service treats 5xx as invalid token (fail closed)
        assert result is None


class TestTokenLifetime:
    """Tests for token lifetime edge cases."""

    @pytest.mark.asyncio
    async def test_token_expires_between_requests(self):
        """Test scenario where token expires between validation and request."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # First call: token is valid
        mock_response_1 = Mock()
        mock_response_1.status_code = 200
        mock_response_1.json = Mock(return_value={
            "active": True,
            "sub": "user-123",
            "scope": "memory:read",
        })

        # Second call: token expired
        mock_response_2 = Mock()
        mock_response_2.status_code = 200
        mock_response_2.json = Mock(return_value={
            "active": False,
        })

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(side_effect=[mock_response_1, mock_response_2])
        handler._http_client = mock_http_client

        # First request succeeds
        result_1 = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")
        assert result_1 is not None

        # Second request fails (token expired)
        result_2 = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")
        assert result_2 is None

    @pytest.mark.asyncio
    async def test_token_with_short_lifetime_remaining(self):
        """Test token that's about to expire but still valid."""
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="test-client",
        )

        # Token expires in 1 second
        exp_timestamp = int((datetime.now(UTC) + timedelta(seconds=1)).timestamp())

        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.json = Mock(return_value={
            "active": True,  # Still valid
            "sub": "user-123",
            "scope": "memory:read",
            "exp": exp_timestamp,
        })

        mock_http_client = AsyncMock()
        mock_http_client.post = AsyncMock(return_value=mock_response)
        handler._http_client = mock_http_client

        result = await handler.validate("egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p")

        # Token is still valid even with 1 second remaining
        assert result is not None
        assert result.user_id == "user-123"


class TestReauthenticationWorkflow:
    """Tests documenting expected re-authentication workflow for services.

    Note: These tests document the expected behavior. Actual implementation
    of auto-retry with token refresh should be in HTTP client wrappers.
    """

    @pytest.mark.asyncio
    async def test_service_receives_401_must_request_new_token(self):
        """Document: Service receiving 401 must request new client credentials token.

        Expected workflow:
        1. Service makes API request with expired token
        2. API returns 401 Unauthorized
        3. Service calls POST /api/auth/token with client_id + client_secret
        4. Service receives new access token
        5. Service retries original request with new token

        This test documents the expected 401 response format.
        """
        request = Mock(spec=Request)
        request.state = Mock()
        request.headers = Mock()
        request.headers.get.return_value = None
        request.method = "POST"
        request.url = "http://localhost:6176/v1/search/query"

        credentials = Mock()
        credentials.credentials = "egm_oauth_abcdef1234567890abcdef1234567890_X7kM2p"

        # Mock handler returns None (token expired)
        mock_handler = AsyncMock()
        mock_handler.validate = AsyncMock(return_value=None)

        with patch("src.middleware.auth.get_auth_handler", return_value=mock_handler):
            with pytest.raises(Exception) as exc_info:
                await get_api_key(request, credentials)

            # Verify 401 response format
            assert exc_info.value.status_code == 401
            assert exc_info.value.detail["success"] is False
            assert exc_info.value.detail["error"]["code"] == "UNAUTHORIZED"
            assert "Invalid or expired token" in exc_info.value.detail["error"]["message"]

            # Service should catch this 401 and request new token
            # Implementation left to HTTP client wrapper with retry logic

    @pytest.mark.asyncio
    async def test_token_refresh_not_available_for_client_credentials(self):
        """Document: Client credentials grant does not support refresh tokens.

        RFC 6749 Section 4.4.3:
        "A refresh token SHOULD NOT be included."

        Services must use client_id + client_secret to request new tokens.
        """
        handler = AuthHandler(
            introspection_url="http://localhost:6178/api/auth/introspect",
            client_id="engram-search",
            client_secret="test-secret",
        )

        # Expired client token
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "active": False,
        }

        mock_http_client = AsyncMock()
        mock_http_client.post.return_value = mock_response
        handler._http_client = mock_http_client

        result = await handler.validate("egm_client_abcdef1234567890abcdef1234567890_Y8nL3q")

        assert result is None

        # At this point, service must request new token:
        # POST /api/auth/token
        # grant_type=client_credentials
        # client_id=engram-search
        # client_secret=test-secret
        #
        # No refresh_token parameter available for client_credentials grant

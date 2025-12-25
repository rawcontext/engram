"""Tests for API key authentication middleware."""

import pytest


class TestAuthMiddleware:
    """Tests for authentication middleware."""

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
        assert "Invalid API key format" in data["detail"]["error"]["message"]

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

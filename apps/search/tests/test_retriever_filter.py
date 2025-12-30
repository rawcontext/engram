"""Tests for Qdrant filter building in SearchRetriever.

This module tests the tenant isolation enforcement in the _build_qdrant_filter method,
ensuring that org_id is ALWAYS required and properly included in all Qdrant queries.
"""

from unittest.mock import MagicMock

import pytest
from qdrant_client.http import models

from src.config import Settings
from src.retrieval import SearchFilters, SearchRetriever, TimeRange


@pytest.fixture
def mock_settings() -> Settings:
    """Create mock settings for testing."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_collection="test_collection",
        embedder_device="cpu",
    )


@pytest.fixture
def mock_qdrant_client() -> MagicMock:
    """Create a mock Qdrant client."""
    client = MagicMock()
    return client


@pytest.fixture
def mock_embedder_factory() -> MagicMock:
    """Create a mock embedder factory."""
    return MagicMock()


@pytest.fixture
def mock_reranker_router() -> MagicMock:
    """Create a mock reranker router."""
    return MagicMock()


@pytest.fixture
def retriever(
    mock_qdrant_client: MagicMock,
    mock_embedder_factory: MagicMock,
    mock_reranker_router: MagicMock,
    mock_settings: Settings,
) -> SearchRetriever:
    """Create a SearchRetriever with mocked dependencies."""
    return SearchRetriever(
        qdrant_client=mock_qdrant_client,
        embedder_factory=mock_embedder_factory,
        reranker_router=mock_reranker_router,
        settings=mock_settings,
    )


class TestBuildQdrantFilter:
    """Test _build_qdrant_filter method for tenant isolation enforcement."""

    def test_raises_when_filters_none(self, retriever: SearchRetriever) -> None:
        """Test that ValueError is raised when filters is None."""
        with pytest.raises(ValueError, match="Search filters are required for tenant isolation"):
            retriever._build_qdrant_filter(None)

    def test_raises_when_org_id_missing(self, retriever: SearchRetriever) -> None:
        """Test that ValueError is raised when filters object lacks org_id attribute."""
        # Create a mock object without org_id attribute
        filters_without_org_id = MagicMock(spec=[])
        del filters_without_org_id.org_id  # Ensure org_id doesn't exist

        with pytest.raises(ValueError, match="org_id is required for tenant isolation"):
            retriever._build_qdrant_filter(filters_without_org_id)

    def test_raises_when_org_id_empty_string(self, retriever: SearchRetriever) -> None:
        """Test that ValueError is raised when org_id is empty string."""
        filters = SearchFilters(org_id="")

        with pytest.raises(ValueError, match="org_id is required for tenant isolation"):
            retriever._build_qdrant_filter(filters)

    def test_raises_when_org_id_none(self, retriever: SearchRetriever) -> None:
        """Test that ValueError is raised when org_id is None."""
        filters = MagicMock()
        filters.org_id = None

        with pytest.raises(ValueError, match="org_id is required for tenant isolation"):
            retriever._build_qdrant_filter(filters)

    def test_valid_filters_with_org_id_only(self, retriever: SearchRetriever) -> None:
        """Test that valid filters with only org_id creates proper Qdrant filter."""
        filters = SearchFilters(org_id="test-org-123")

        result = retriever._build_qdrant_filter(filters)

        # Verify result is a Qdrant Filter
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 1

        # Verify org_id condition
        org_condition = result.must[0]
        assert isinstance(org_condition, models.FieldCondition)
        assert org_condition.key == "org_id"
        assert isinstance(org_condition.match, models.MatchValue)
        assert org_condition.match.value == "test-org-123"

    def test_filters_with_session_id(self, retriever: SearchRetriever) -> None:
        """Test that session_id filter is properly added when provided."""
        filters = SearchFilters(
            org_id="test-org-123",
            session_id="session-456",
        )

        result = retriever._build_qdrant_filter(filters)

        # Verify we have 2 conditions
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 2

        # Find org_id condition
        org_conditions = [c for c in result.must if c.key == "org_id"]
        assert len(org_conditions) == 1
        assert org_conditions[0].match.value == "test-org-123"

        # Find session_id condition
        session_conditions = [c for c in result.must if c.key == "session_id"]
        assert len(session_conditions) == 1
        assert session_conditions[0].match.value == "session-456"

    def test_filters_with_type(self, retriever: SearchRetriever) -> None:
        """Test that type filter is properly added when provided."""
        filters = SearchFilters(
            org_id="test-org-123",
            type="code",
        )

        result = retriever._build_qdrant_filter(filters)

        # Verify we have 2 conditions
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 2

        # Find org_id condition
        org_conditions = [c for c in result.must if c.key == "org_id"]
        assert len(org_conditions) == 1
        assert org_conditions[0].match.value == "test-org-123"

        # Find type condition
        type_conditions = [c for c in result.must if c.key == "type"]
        assert len(type_conditions) == 1
        assert type_conditions[0].match.value == "code"

    def test_filters_with_time_range(self, retriever: SearchRetriever) -> None:
        """Test that time_range filter is properly added when provided."""
        time_range = TimeRange(start=1000000, end=2000000)
        filters = SearchFilters(
            org_id="test-org-123",
            time_range=time_range,
        )

        result = retriever._build_qdrant_filter(filters)

        # Verify we have 2 conditions
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 2

        # Find org_id condition
        org_conditions = [c for c in result.must if c.key == "org_id"]
        assert len(org_conditions) == 1
        assert org_conditions[0].match.value == "test-org-123"

        # Find timestamp condition
        timestamp_conditions = [c for c in result.must if c.key == "timestamp"]
        assert len(timestamp_conditions) == 1
        assert isinstance(timestamp_conditions[0].range, models.Range)
        assert timestamp_conditions[0].range.gte == 1000000
        assert timestamp_conditions[0].range.lte == 2000000

    def test_filters_with_all_optional_fields(self, retriever: SearchRetriever) -> None:
        """Test that all optional filters are properly added when provided."""
        time_range = TimeRange(start=1000000, end=2000000)
        filters = SearchFilters(
            org_id="test-org-123",
            session_id="session-456",
            type="thought",
            time_range=time_range,
        )

        result = retriever._build_qdrant_filter(filters)

        # Verify we have 4 conditions (org_id + 3 optional)
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 4

        # Verify org_id is always present
        org_conditions = [c for c in result.must if c.key == "org_id"]
        assert len(org_conditions) == 1
        assert org_conditions[0].match.value == "test-org-123"

        # Verify session_id
        session_conditions = [c for c in result.must if c.key == "session_id"]
        assert len(session_conditions) == 1
        assert session_conditions[0].match.value == "session-456"

        # Verify type
        type_conditions = [c for c in result.must if c.key == "type"]
        assert len(type_conditions) == 1
        assert type_conditions[0].match.value == "thought"

        # Verify timestamp
        timestamp_conditions = [c for c in result.must if c.key == "timestamp"]
        assert len(timestamp_conditions) == 1
        assert timestamp_conditions[0].range.gte == 1000000
        assert timestamp_conditions[0].range.lte == 2000000

    def test_org_id_always_included(self, retriever: SearchRetriever) -> None:
        """Test that org_id is ALWAYS included regardless of other filters.

        This is a critical security test to ensure tenant isolation is enforced.
        """
        test_cases = [
            # Only org_id
            SearchFilters(org_id="org-1"),
            # org_id + session_id
            SearchFilters(org_id="org-2", session_id="session-1"),
            # org_id + type
            SearchFilters(org_id="org-3", type="code"),
            # org_id + time_range
            SearchFilters(org_id="org-4", time_range=TimeRange(start=1000, end=2000)),
            # All fields
            SearchFilters(
                org_id="org-5",
                session_id="session-2",
                type="thought",
                time_range=TimeRange(start=3000, end=4000),
            ),
        ]

        for filters in test_cases:
            result = retriever._build_qdrant_filter(filters)

            # Verify org_id is always present
            assert isinstance(result, models.Filter)
            assert result.must is not None
            org_conditions = [c for c in result.must if c.key == "org_id"]
            assert len(org_conditions) == 1, f"org_id missing for filters: {filters}"
            assert org_conditions[0].match.value == filters.org_id

    def test_empty_session_id_not_added(self, retriever: SearchRetriever) -> None:
        """Test that empty session_id is not added to filter."""
        filters = SearchFilters(org_id="test-org-123", session_id="")

        result = retriever._build_qdrant_filter(filters)

        # Should only have org_id condition
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 1
        assert result.must[0].key == "org_id"

    def test_empty_type_not_added(self, retriever: SearchRetriever) -> None:
        """Test that empty type is not added to filter."""
        filters = SearchFilters(org_id="test-org-123", type="")

        result = retriever._build_qdrant_filter(filters)

        # Should only have org_id condition
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 1
        assert result.must[0].key == "org_id"

    def test_none_session_id_not_added(self, retriever: SearchRetriever) -> None:
        """Test that None session_id is not added to filter."""
        filters = SearchFilters(org_id="test-org-123", session_id=None)

        result = retriever._build_qdrant_filter(filters)

        # Should only have org_id condition
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 1
        assert result.must[0].key == "org_id"

    def test_none_type_not_added(self, retriever: SearchRetriever) -> None:
        """Test that None type is not added to filter."""
        filters = SearchFilters(org_id="test-org-123", type=None)

        result = retriever._build_qdrant_filter(filters)

        # Should only have org_id condition
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 1
        assert result.must[0].key == "org_id"

    def test_none_time_range_not_added(self, retriever: SearchRetriever) -> None:
        """Test that None time_range is not added to filter."""
        filters = SearchFilters(org_id="test-org-123", time_range=None)

        result = retriever._build_qdrant_filter(filters)

        # Should only have org_id condition
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert len(result.must) == 1
        assert result.must[0].key == "org_id"

    def test_filter_structure_is_correct(self, retriever: SearchRetriever) -> None:
        """Test that the returned filter has correct structure for Qdrant."""
        filters = SearchFilters(
            org_id="test-org-123",
            session_id="session-456",
            type="code",
        )

        result = retriever._build_qdrant_filter(filters)

        # Verify overall structure
        assert isinstance(result, models.Filter)
        assert result.must is not None
        assert isinstance(result.must, list)
        assert all(isinstance(c, models.FieldCondition) for c in result.must)

        # Verify FieldCondition structure
        for condition in result.must:
            assert hasattr(condition, "key")
            assert isinstance(condition.key, str)
            # Each condition should have either match or range
            assert hasattr(condition, "match") or hasattr(condition, "range")

    def test_multiple_org_ids_not_possible(self, retriever: SearchRetriever) -> None:
        """Test that only one org_id condition is created.

        This ensures we don't accidentally create multiple org_id filters
        which could weaken tenant isolation.
        """
        filters = SearchFilters(org_id="test-org-123")

        result = retriever._build_qdrant_filter(filters)

        # Count org_id conditions
        org_conditions = [c for c in result.must if c.key == "org_id"]
        assert len(org_conditions) == 1, "Should only have exactly one org_id condition"

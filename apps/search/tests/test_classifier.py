"""Tests for query classifier."""

import pytest

from src.retrieval.classifier import (
    ClassificationResult,
    QueryClassifier,
    QueryFeatures,
)
from src.retrieval.types import QueryComplexity, SearchStrategy


@pytest.fixture
def classifier() -> QueryClassifier:
    """Create QueryClassifier instance."""
    return QueryClassifier()


class TestQueryClassifier:
    """Tests for QueryClassifier."""

    def test_classify_quoted_query_as_sparse(self, classifier: QueryClassifier) -> None:
        """Test that queries with quotes are classified as sparse."""
        result = classifier.classify('"exact match query"')

        assert result["strategy"] == SearchStrategy.SPARSE
        assert result["alpha"] == 0.1

    def test_classify_code_syntax_as_hybrid_sparse(self, classifier: QueryClassifier) -> None:
        """Test that code-like queries are classified as hybrid (lean sparse)."""
        code_queries = [
            "findUser(id)",
            "user.getName()",
            "obj.method",  # property access pattern
        ]

        for query in code_queries:
            result = classifier.classify(query)
            assert result["strategy"] == SearchStrategy.HYBRID
            assert result["alpha"] == 0.3

    def test_classify_natural_language_as_hybrid_dense(self, classifier: QueryClassifier) -> None:
        """Test that natural language queries are hybrid (lean dense)."""
        result = classifier.classify("How do I implement authentication?")

        assert result["strategy"] == SearchStrategy.HYBRID
        assert result["alpha"] == 0.7

    def test_extract_features_length(self, classifier: QueryClassifier) -> None:
        """Test feature extraction for query length."""
        features = classifier.extract_features("short")

        assert features.length == 5
        assert features.word_count == 1

    def test_extract_features_quotes(self, classifier: QueryClassifier) -> None:
        """Test feature extraction detects quotes."""
        features = classifier.extract_features('"quoted text"')

        assert features.has_quotes is True

    def test_extract_features_operators(self, classifier: QueryClassifier) -> None:
        """Test feature extraction detects boolean operators."""
        queries_with_ops = [
            "term AND another",
            "term OR another",
            "term NOT another",
            "term+suffix",
        ]

        for query in queries_with_ops:
            features = classifier.extract_features(query)
            assert features.has_operators is True

    def test_extract_features_code(self, classifier: QueryClassifier) -> None:
        """Test feature extraction detects code patterns."""
        code_queries = [
            "function test() { }",
            "class MyClass extends Base",
            "import React from 'react'",
            "export default Component",
            "const arrow = () => result",
        ]

        for query in code_queries:
            features = classifier.extract_features(query)
            assert features.has_code is True

    def test_extract_features_question(self, classifier: QueryClassifier) -> None:
        """Test feature extraction detects questions."""
        questions = [
            "What is the answer?",
            "How do I do this?",
            "Why does this happen?",
            "When should I use this?",
            "Where is the file?",
            "Who created this?",
            "Which option is better?",
            "Can I do this?",
            "Does this work?",
            "Is this correct?",
            "Are these valid?",
        ]

        for query in questions:
            features = classifier.extract_features(query)
            assert features.is_question is True

    def test_extract_features_agentic(self, classifier: QueryClassifier) -> None:
        """Test feature extraction detects agentic terms."""
        agentic_queries = [
            "call the user API",
            "execute this function",
            "invoke the tool",
            "run the endpoint",
        ]

        for query in agentic_queries:
            features = classifier.extract_features(query)
            assert features.has_agentic is True

    def test_classify_complexity_simple(self, classifier: QueryClassifier) -> None:
        """Test complexity classification for simple queries."""
        simple_queries = ["user", "login", "test"]

        for query in simple_queries:
            result = classifier.classify_complexity(query)
            assert result.complexity == QueryComplexity.SIMPLE
            assert result.score < 2

    def test_classify_complexity_moderate(self, classifier: QueryClassifier) -> None:
        """Test complexity classification for moderate queries."""
        moderate_queries = [
            "How do I authenticate users?",  # Question + moderate length: score=2
            "What are the best practices for API design?",  # Question + more words: score=3
        ]

        for query in moderate_queries:
            result = classifier.classify_complexity(query)
            assert result.complexity == QueryComplexity.MODERATE
            assert 2 <= result.score < 5

    def test_classify_complexity_complex(self, classifier: QueryClassifier) -> None:
        """Test complexity classification for complex queries."""
        complex_queries = [
            # Code with function keyword: +3 code, +2 length, +1 words = 6
            "function authenticateUser() { return jwt.sign(user, secret); }",
            # Quotes + operators: +1 quotes, +2 operators, +2 length, +1 words = 6+
            'search for "exact match" AND complex OR query with operators',
            # Very long question: +3 length, +2 words, +1 question = 6
            (
                "How do I implement OAuth2 authentication with refresh tokens "
                "using JWT and ensure secure token storage?"
            ),
        ]

        for query in complex_queries:
            result = classifier.classify_complexity(query)
            assert result.complexity == QueryComplexity.COMPLEX
            assert result.score >= 5

    def test_classify_complexity_scoring_length(self, classifier: QueryClassifier) -> None:
        """Test that length contributes to complexity score."""
        short = classifier.classify_complexity("test")
        medium = classifier.classify_complexity("a" * 30)
        long = classifier.classify_complexity("a" * 60)
        very_long = classifier.classify_complexity("a" * 120)

        # Longer queries should have higher scores (all else being equal)
        assert short.score < medium.score
        assert medium.score < long.score
        assert long.score < very_long.score

    def test_classify_complexity_scoring_words(self, classifier: QueryClassifier) -> None:
        """Test that word count contributes to complexity score."""
        few_words = classifier.classify_complexity("one two three")
        many_words = classifier.classify_complexity(" ".join([f"word{i}" for i in range(10)]))
        very_many = classifier.classify_complexity(" ".join([f"word{i}" for i in range(15)]))

        assert few_words.score < many_words.score
        assert many_words.score < very_many.score

    def test_classify_complexity_returns_features(self, classifier: QueryClassifier) -> None:
        """Test that classify_complexity returns features."""
        # Test with a code query
        code_result = classifier.classify_complexity("function test() { return true; }")
        assert isinstance(code_result.features, QueryFeatures)
        assert code_result.features.has_code is True

        # Test with a question query
        question_result = classifier.classify_complexity("What is authentication?")
        assert isinstance(question_result.features, QueryFeatures)
        assert question_result.features.is_question is True
        assert question_result.features.has_code is False

    def test_classify_complexity_returns_strategy(self, classifier: QueryClassifier) -> None:
        """Test that classify_complexity returns strategy and alpha."""
        result = classifier.classify_complexity("test query")

        assert result.strategy in [
            SearchStrategy.SPARSE,
            SearchStrategy.DENSE,
            SearchStrategy.HYBRID,
        ]
        assert 0.0 <= result.alpha <= 1.0

    def test_is_code_query(self, classifier: QueryClassifier) -> None:
        """Test is_code_query helper method."""
        assert classifier.is_code_query("function test() { }") is True
        assert classifier.is_code_query("class MyClass extends Base") is True
        assert classifier.is_code_query("How do I authenticate?") is False

    def test_is_agentic_query(self, classifier: QueryClassifier) -> None:
        """Test is_agentic_query helper method."""
        assert classifier.is_agentic_query("call the API endpoint") is True
        assert classifier.is_agentic_query("execute this function") is True
        assert classifier.is_agentic_query("How do I authenticate?") is False

    def test_classification_result_dataclass(self) -> None:
        """Test ClassificationResult dataclass."""
        features = QueryFeatures(
            length=10,
            word_count=2,
            has_quotes=False,
            has_operators=False,
            has_code=False,
            is_question=False,
            has_agentic=False,
        )

        result = ClassificationResult(
            strategy=SearchStrategy.HYBRID,
            alpha=0.7,
            complexity=QueryComplexity.SIMPLE,
            features=features,
            score=1,
        )

        assert result.strategy == SearchStrategy.HYBRID
        assert result.alpha == 0.7
        assert result.complexity == QueryComplexity.SIMPLE
        assert result.features == features
        assert result.score == 1

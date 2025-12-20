"""Query classification for search strategy and reranker tier selection.

Classifies queries to determine:
- Search strategy (sparse, dense, hybrid)
- Alpha weight for dense/sparse blending in hybrid search
- Query complexity for reranker tier selection
"""

import re
from dataclasses import dataclass

from src.retrieval.types import QueryComplexity, SearchStrategy


@dataclass
class QueryFeatures:
    """Features extracted from a query for classification."""

    length: int
    word_count: int
    has_quotes: bool
    has_operators: bool
    has_code: bool
    is_question: bool
    has_agentic: bool


@dataclass
class ClassificationResult:
    """Result of query classification."""

    strategy: SearchStrategy
    alpha: float
    complexity: QueryComplexity
    features: QueryFeatures
    score: int


class QueryClassifier:
    """Classifier for query analysis and search strategy selection.

    Uses heuristics to classify queries into search strategies and
    complexity levels for optimal retrieval and reranking.
    """

    # Regex patterns for feature extraction
    QUOTED_PATTERN = re.compile(r'"[^"]+"')
    OPERATOR_PATTERN = re.compile(r"\b(AND|OR|NOT)\b|\+|-")
    CODE_PATTERN = re.compile(r"[a-zA-Z]+\.[a-zA-Z]+\(|function\s|class\s|=>|import\s|export\s")
    QUESTION_PATTERN = re.compile(
        r"^(what|how|why|when|where|who|which|can|does|is|are)\b",
        re.IGNORECASE,
    )
    AGENTIC_PATTERN = re.compile(
        r"\b(tool|function|call|execute|invoke|run|api|endpoint)\b",
        re.IGNORECASE,
    )
    CODE_SYNTAX_PATTERN = re.compile(r"[a-zA-Z0-9_]+\(.*\)|[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+")

    def classify(self, query: str) -> dict[str, SearchStrategy | float]:
        """Classify query into search strategy with alpha weight.

        Heuristic classification:
        1. Quoted strings imply exact match intent -> Sparse
        2. Code-like patterns (function calls, imports) -> Hybrid (lean sparse)
        3. Natural language -> Hybrid (lean dense)

        Args:
            query: Search query to classify.

        Returns:
            Dict with 'strategy' and 'alpha' keys.
            Alpha is weight for dense (0=sparse, 1=dense).
        """
        # Check for quoted strings (exact match intent)
        if self.QUOTED_PATTERN.search(query):
            # Alpha 0.1 = 10% dense, 90% sparse
            return {"strategy": SearchStrategy.SPARSE, "alpha": 0.1}

        # Check for code syntax patterns
        if self.CODE_SYNTAX_PATTERN.search(query):
            # Lean towards sparse for code queries
            return {"strategy": SearchStrategy.HYBRID, "alpha": 0.3}

        # Default: Hybrid leaning dense for natural language
        return {"strategy": SearchStrategy.HYBRID, "alpha": 0.7}

    def extract_features(self, query: str) -> QueryFeatures:
        """Extract features from a query for complexity analysis.

        Args:
            query: Query text to analyze.

        Returns:
            QueryFeatures with extracted feature flags.
        """
        words = [w for w in query.split() if w]

        return QueryFeatures(
            length=len(query),
            word_count=len(words),
            has_quotes=bool(self.QUOTED_PATTERN.search(query)),
            has_operators=bool(self.OPERATOR_PATTERN.search(query)),
            has_code=bool(self.CODE_PATTERN.search(query)),
            is_question=bool(self.QUESTION_PATTERN.search(query)),
            has_agentic=bool(self.AGENTIC_PATTERN.search(query)),
        )

    def classify_complexity(self, query: str) -> ClassificationResult:
        """Classify query complexity for reranker tier selection.

        Used by RerankerRouter to choose between fast/accurate/code tiers.

        Scoring:
        - Length > 100 chars: +3; > 50: +2; > 25: +1
        - Word count > 12: +2; > 8: +1
        - Has quotes: +1
        - Has operators: +2
        - Has code: +3
        - Is question: +1
        - Has agentic terms: +2

        Complexity levels:
        - simple (score < 2): Use fast reranker
        - moderate (score 2-4): Use accurate reranker
        - complex (score >= 5): Use code/accurate reranker

        Args:
            query: Query text to classify.

        Returns:
            ClassificationResult with complexity level, features, and score.
        """
        features = self.extract_features(query)

        score = 0

        # Length-based scoring
        if features.length > 100:
            score += 3
        elif features.length > 50:
            score += 2
        elif features.length > 25:
            score += 1

        # Word count scoring
        if features.word_count > 12:
            score += 2
        elif features.word_count > 8:
            score += 1

        # Feature-based scoring
        if features.has_quotes:
            score += 1
        if features.has_operators:
            score += 2
        if features.has_code:
            score += 3
        if features.is_question:
            score += 1
        if features.has_agentic:
            score += 2

        # Determine complexity level
        if score >= 5:
            complexity = QueryComplexity.COMPLEX
        elif score >= 2:
            complexity = QueryComplexity.MODERATE
        else:
            complexity = QueryComplexity.SIMPLE

        # Get strategy and alpha
        classification = self.classify(query)

        return ClassificationResult(
            strategy=classification["strategy"],  # type: ignore
            alpha=classification["alpha"],  # type: ignore
            complexity=complexity,
            features=features,
            score=score,
        )

    def is_code_query(self, query: str) -> bool:
        """Check if query contains code patterns.

        Used for routing to code-specialized reranker.

        Args:
            query: Query text to check.

        Returns:
            True if query contains code patterns.
        """
        features = self.extract_features(query)
        return features.has_code

    def is_agentic_query(self, query: str) -> bool:
        """Check if query is agentic/tool-related.

        May benefit from more accurate reranking.

        Args:
            query: Query text to check.

        Returns:
            True if query contains agentic terms.
        """
        features = self.extract_features(query)
        return features.has_agentic

"""Tests for embedder implementations."""

import numpy as np
import pytest

from search.config import Settings
from search.embedders import (
    CodeEmbedder,
    ColBERTEmbedder,
    EmbedderFactory,
    SparseEmbedder,
    TextEmbedder,
)


@pytest.fixture
def settings() -> Settings:
    """Create test settings."""
    return Settings(
        embedder_device="cpu",
        embedder_batch_size=2,
        embedder_cache_size=100,
        embedder_preload=False,
    )


@pytest.fixture
async def text_embedder() -> TextEmbedder:
    """Create and load text embedder for testing."""
    embedder = TextEmbedder(
        model_name="BAAI/bge-small-en-v1.5",  # Smaller model for faster tests
        device="cpu",
        batch_size=2,
    )
    await embedder.load()
    yield embedder
    await embedder.unload()


@pytest.fixture
async def code_embedder() -> CodeEmbedder:
    """Create and load code embedder for testing."""
    embedder = CodeEmbedder(
        model_name="sentence-transformers/all-MiniLM-L6-v2",  # Smaller model
        device="cpu",
        batch_size=2,
        max_seq_length=512,  # Match model's actual limit
        chunk_size=1500,  # Smaller chunks for test model (~400 tokens)
        chunk_overlap=200,
    )
    await embedder.load()
    yield embedder
    await embedder.unload()


class TestTextEmbedder:
    """Tests for TextEmbedder."""

    async def test_embed_returns_correct_dimensions(self, text_embedder: TextEmbedder) -> None:
        """Test that embedding returns correct dimension."""
        result = await text_embedder.embed("test query")
        assert isinstance(result, list)
        assert len(result) == 384  # bge-small dimension
        assert all(isinstance(x, float) for x in result)

    async def test_embed_query_vs_document(self, text_embedder: TextEmbedder) -> None:
        """Test that query and document embeddings differ due to prefix."""
        query_emb = await text_embedder.embed("machine learning", is_query=True)
        doc_emb = await text_embedder.embed("machine learning", is_query=False)

        # Embeddings should be different due to query prefix
        cosine_sim = np.dot(query_emb, doc_emb) / (
            np.linalg.norm(query_emb) * np.linalg.norm(doc_emb)
        )

        # Should be similar but not identical
        assert 0.8 < cosine_sim < 0.99

    async def test_embed_batch_processes_multiple(self, text_embedder: TextEmbedder) -> None:
        """Test batch embedding."""
        texts = ["query 1", "query 2", "query 3"]
        results = await text_embedder.embed_batch(texts)

        assert len(results) == 3
        assert all(len(emb) == 384 for emb in results)

    async def test_embed_normalized(self, text_embedder: TextEmbedder) -> None:
        """Test that embeddings are normalized (unit length)."""
        result = await text_embedder.embed("test")
        norm = np.linalg.norm(result)
        assert 0.99 < norm < 1.01  # Allow small floating point error

    async def test_similar_texts_have_high_similarity(self, text_embedder: TextEmbedder) -> None:
        """Test that similar texts have high cosine similarity."""
        emb1 = await text_embedder.embed("The cat sat on the mat", is_query=False)
        emb2 = await text_embedder.embed("A cat is sitting on a mat", is_query=False)

        cosine_sim = np.dot(emb1, emb2) / (np.linalg.norm(emb1) * np.linalg.norm(emb2))

        assert cosine_sim > 0.7  # Should be quite similar


class TestCodeEmbedder:
    """Tests for CodeEmbedder."""

    async def test_embed_returns_vector(self, code_embedder: CodeEmbedder) -> None:
        """Test that embedding returns a vector."""
        code = "def hello(): return 'world'"
        result = await code_embedder.embed(code, is_query=False)

        assert isinstance(result, list)
        assert len(result) > 0
        assert all(isinstance(x, float) for x in result)

    async def test_embed_with_prefix(self, code_embedder: CodeEmbedder) -> None:
        """Test that query and document prefixes are applied."""
        code = "def hello(): pass"
        query_emb = await code_embedder.embed(code, is_query=True)
        doc_emb = await code_embedder.embed(code, is_query=False)

        # Should be different due to prefixes
        assert query_emb != doc_emb

    async def test_chunk_large_code(self, code_embedder: CodeEmbedder) -> None:
        """Test chunking of large code files."""
        # Create large code file
        large_code = "\n".join([f"def function_{i}(): pass" for i in range(200)])

        # Should handle without error
        result = await code_embedder.embed(large_code, is_query=False)
        assert isinstance(result, list)
        assert len(result) > 0

    async def test_batch_embedding(self, code_embedder: CodeEmbedder) -> None:
        """Test batch code embedding."""
        codes = [
            "def func1(): pass",
            "class MyClass: pass",
            "import numpy as np",
        ]

        results = await code_embedder.embed_batch(codes, is_query=False)
        assert len(results) == 3
        assert all(len(emb) > 0 for emb in results)


class TestSparseEmbedder:
    """Tests for SparseEmbedder."""

    @pytest.fixture
    async def sparse_embedder(self) -> SparseEmbedder:
        """Create sparse embedder with smaller model."""
        embedder = SparseEmbedder(
            model_name="naver/splade-cocondenser-ensembledistil",
            device="cpu",
            batch_size=2,
        )
        await embedder.load()
        yield embedder
        await embedder.unload()

    async def test_embed_returns_sparse_dict(self, sparse_embedder: SparseEmbedder) -> None:
        """Test sparse embedding returns dictionary."""
        sparse_vec = sparse_embedder.embed_sparse("machine learning")

        assert isinstance(sparse_vec, dict)
        assert len(sparse_vec) > 0
        assert all(isinstance(k, int) for k in sparse_vec)
        assert all(isinstance(v, float) for v in sparse_vec.values())
        assert all(v > 0 for v in sparse_vec.values())  # SPLADE uses ReLU

    async def test_sparse_vectors_are_sparse(self, sparse_embedder: SparseEmbedder) -> None:
        """Test that sparse vectors have mostly zeros."""
        sparse_vec = sparse_embedder.embed_sparse("test query")

        vocab_size = sparse_embedder.dimensions
        sparsity = 1 - (len(sparse_vec) / vocab_size)

        # Should be >95% sparse
        assert sparsity > 0.95

    async def test_embed_batch_sparse(self, sparse_embedder: SparseEmbedder) -> None:
        """Test batch sparse embedding."""
        texts = ["query 1", "query 2"]
        results = sparse_embedder.embed_sparse_batch(texts)

        assert len(results) == 2
        assert all(isinstance(r, dict) for r in results)


@pytest.mark.skip(
    reason="ragatouille has langchain import compatibility issue with langchain>=1.0"
)
class TestColBERTEmbedder:
    """Tests for ColBERTEmbedder."""

    @pytest.fixture
    async def colbert_embedder(self) -> ColBERTEmbedder:
        """Create ColBERT embedder."""
        embedder = ColBERTEmbedder(
            model_name="colbert-ir/colbertv2.0",
            device="cpu",
            batch_size=2,
        )
        await embedder.load()
        yield embedder
        await embedder.unload()

    async def test_embed_query_multi_vector(self, colbert_embedder: ColBERTEmbedder) -> None:
        """Test that ColBERT produces multiple vectors per query."""
        multi_vec = colbert_embedder.embed_query("machine learning query")

        assert isinstance(multi_vec, list)
        assert len(multi_vec) > 0  # Multiple token vectors
        assert all(isinstance(vec, list) for vec in multi_vec)
        assert all(len(vec) == 128 for vec in multi_vec)  # ColBERT dim

    async def test_embed_document_multi_vector(self, colbert_embedder: ColBERTEmbedder) -> None:
        """Test document multi-vector embedding."""
        multi_vec = colbert_embedder.embed_document("This is a test document")

        assert isinstance(multi_vec, list)
        assert len(multi_vec) > 0
        assert all(len(vec) == 128 for vec in multi_vec)

    async def test_dimensions_property(self, colbert_embedder: ColBERTEmbedder) -> None:
        """Test dimensions property."""
        assert colbert_embedder.dimensions == 128


class TestEmbedderFactory:
    """Tests for EmbedderFactory."""

    def test_factory_creates_text_embedder(self, settings: Settings) -> None:
        """Test factory creates text embedder."""
        factory = EmbedderFactory(settings)
        embedder = factory.get_text_embedder()

        assert isinstance(embedder, TextEmbedder)
        assert embedder.model_name == settings.embedder_text_model

    def test_factory_creates_code_embedder(self, settings: Settings) -> None:
        """Test factory creates code embedder."""
        factory = EmbedderFactory(settings)
        embedder = factory.get_code_embedder()

        assert isinstance(embedder, CodeEmbedder)
        assert embedder.model_name == settings.embedder_code_model

    def test_factory_creates_sparse_embedder(self, settings: Settings) -> None:
        """Test factory creates sparse embedder."""
        factory = EmbedderFactory(settings)
        embedder = factory.get_sparse_embedder()

        assert isinstance(embedder, SparseEmbedder)
        assert embedder.model_name == settings.embedder_sparse_model

    def test_factory_creates_colbert_embedder(self, settings: Settings) -> None:
        """Test factory creates ColBERT embedder."""
        factory = EmbedderFactory(settings)
        embedder = factory.get_colbert_embedder()

        assert isinstance(embedder, ColBERTEmbedder)
        assert embedder.model_name == settings.embedder_colbert_model

    def test_factory_singleton_pattern(self, settings: Settings) -> None:
        """Test that factory returns same instance for same type."""
        factory = EmbedderFactory(settings)

        embedder1 = factory.get_text_embedder()
        embedder2 = factory.get_text_embedder()

        assert embedder1 is embedder2

    def test_factory_get_embedder_by_type(self, settings: Settings) -> None:
        """Test getting embedder by type string."""
        factory = EmbedderFactory(settings)

        text_emb = factory.get_embedder("text")
        code_emb = factory.get_embedder("code")
        sparse_emb = factory.get_embedder("sparse")
        colbert_emb = factory.get_embedder("colbert")

        assert isinstance(text_emb, TextEmbedder)
        assert isinstance(code_emb, CodeEmbedder)
        assert isinstance(sparse_emb, SparseEmbedder)
        assert isinstance(colbert_emb, ColBERTEmbedder)

    def test_factory_invalid_type_raises_error(self, settings: Settings) -> None:
        """Test that invalid embedder type raises ValueError."""
        factory = EmbedderFactory(settings)

        with pytest.raises(ValueError, match="Invalid embedder type"):
            factory.get_embedder("invalid")  # type: ignore

    async def test_factory_preload_all(self, settings: Settings) -> None:
        """Test preloading all embedders."""
        factory = EmbedderFactory(settings)

        # Should load without error (ColBERT may fail due to ragatouille issue)
        await factory.preload_all()

        # At least text, code, sparse should be loaded (ColBERT may fail)
        assert len(factory) >= 3

        # Cleanup
        await factory.unload_all()

    async def test_factory_unload_all(self, settings: Settings) -> None:
        """Test unloading all embedders."""
        factory = EmbedderFactory(settings)

        # Load some embedders
        factory.get_text_embedder()
        factory.get_code_embedder()
        assert len(factory) == 2

        # Unload all
        await factory.unload_all()
        assert len(factory) == 0

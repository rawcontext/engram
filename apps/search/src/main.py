"""Engram Search Service - FastAPI application entry point."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api import router
from src.clients import QdrantClientWrapper
from src.config import get_settings
from src.embedders import EmbedderFactory
from src.rerankers import RerankerRouter
from src.retrieval import SearchRetriever
from src.retrieval.multi_query import MultiQueryRetriever
from src.retrieval.session import SessionAwareRetriever
from src.services import SchemaManager, get_turns_collection_schema
from src.utils.logging import configure_logging, get_logger
from src.utils.metrics import SERVICE_INFO
from src.utils.tracing import TracingMiddleware

# Configure structured logging
settings = get_settings()
configure_logging(
    level="DEBUG" if settings.debug else "INFO",
    json_format=not settings.debug,  # Human-readable in debug mode
)
logger = get_logger(__name__)

# Set service info metrics
SERVICE_INFO.info({"version": "0.1.0", "service": "search-py"})


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager.

    Initializes and cleans up resources like Qdrant client.
    This follows the FastAPI 0.115+ lifespan pattern for proper
    resource management during startup and shutdown.

    Args:
        app: FastAPI application instance.

    Yields:
        None after startup, before shutdown.
    """
    settings = get_settings()

    # Startup: Initialize Qdrant client and embedders
    logger.info("Starting Engram Search Service...")
    logger.info(f"Qdrant URL: {settings.qdrant_url}")
    logger.info(f"Qdrant Collection: {settings.qdrant_collection}")
    logger.info(f"Embedder Device: {settings.embedder_device}")
    logger.info(f"Embedder Preload: {settings.embedder_preload}")

    qdrant_client = QdrantClientWrapper(settings)
    embedder_factory = EmbedderFactory(settings)

    try:
        await qdrant_client.connect()
        app.state.qdrant = qdrant_client
        logger.info("Qdrant client initialized successfully")

        # Check if legacy collection exists
        collection_info = await qdrant_client.get_collection_info()
        if collection_info:
            logger.info(
                f"Collection '{settings.qdrant_collection}' exists with "
                f"{collection_info.points_count} points"
            )
        else:
            logger.warning(
                f"Collection '{settings.qdrant_collection}' does not exist yet. "
                "It will be created when first indexing occurs."
            )

        # Ensure engram_turns collection exists for turn-level indexing
        schema_manager = SchemaManager(qdrant_client, settings)
        turns_schema = get_turns_collection_schema(settings.qdrant_turns_collection)
        created = await schema_manager.ensure_collection(turns_schema)
        if created:
            logger.info(
                f"Created turns collection '{settings.qdrant_turns_collection}' "
                f"with 384-dim dense, sparse, and ColBERT vectors"
            )
        app.state.schema_manager = schema_manager

    except Exception as e:
        logger.error(f"Failed to initialize Qdrant client: {e}")
        logger.warning("Service starting in degraded mode without Qdrant")
        app.state.qdrant = None

    # Initialize embedder factory
    app.state.embedder_factory = embedder_factory

    # Initialize reranker router
    reranker_router = RerankerRouter(settings)
    app.state.reranker_router = reranker_router
    logger.info("Reranker router initialized")

    # Initialize search retriever (only if Qdrant is available)
    if app.state.qdrant is not None:
        search_retriever = SearchRetriever(
            qdrant_client=app.state.qdrant,
            embedder_factory=embedder_factory,
            reranker_router=reranker_router,
            settings=settings,
        )
        app.state.search_retriever = search_retriever
        logger.info("Search retriever initialized")

        # Initialize multi-query retriever
        multi_query_retriever = MultiQueryRetriever(
            base_retriever=search_retriever,
            model=settings.reranker_llm_model,
        )
        app.state.multi_query_retriever = multi_query_retriever
        logger.info("Multi-query retriever initialized")

        # Initialize session-aware retriever
        session_aware_retriever = SessionAwareRetriever(
            qdrant_client=app.state.qdrant,
            embedder_factory=embedder_factory,
            settings=settings,
            reranker_router=reranker_router,
        )
        app.state.session_aware_retriever = session_aware_retriever
        logger.info("Session-aware retriever initialized")
    else:
        app.state.search_retriever = None
        app.state.multi_query_retriever = None
        app.state.session_aware_retriever = None
        logger.warning("Retrievers not initialized (Qdrant unavailable)")

    # Preload models if configured
    if settings.embedder_preload:
        try:
            logger.info("Preloading embedder models...")
            await embedder_factory.preload_all()
            logger.info("All embedder models preloaded successfully")
        except Exception as e:
            logger.error(f"Failed to preload embedder models: {e}")
            logger.warning("Service starting without preloaded models")

    logger.info("Engram Search Service startup complete")

    yield

    # Shutdown: Cleanup resources
    logger.info("Shutting down Engram Search Service...")

    # Unload embedder models
    if hasattr(app.state, "embedder_factory") and app.state.embedder_factory is not None:
        try:
            await app.state.embedder_factory.unload_all()
            logger.info("Embedder models unloaded successfully")
        except Exception as e:
            logger.error(f"Error unloading embedder models: {e}")

    # Close Qdrant client
    if hasattr(app.state, "qdrant") and app.state.qdrant is not None:
        try:
            await app.state.qdrant.close()
            logger.info("Qdrant client closed successfully")
        except Exception as e:
            logger.error(f"Error closing Qdrant client: {e}")

    logger.info("Engram Search Service shutdown complete")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns:
        Configured FastAPI application instance.
    """
    app_settings = get_settings()

    app = FastAPI(
        title="Engram Search Service",
        description=(
            "Intelligent vector search service with embedding, sparse retrieval, "
            "and multi-tier reranking for the Engram memory system"
        ),
        version="0.1.0",
        lifespan=lifespan,
        debug=app_settings.debug,
    )

    # Request tracing middleware (must be added first for correlation IDs)
    app.add_middleware(TracingMiddleware)

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include API router
    app.include_router(router)

    return app


# Create app instance for uvicorn
app = create_app()


def run() -> None:
    """Run the application with uvicorn.

    This is the entry point for the 'search' command defined in pyproject.toml.
    """
    settings = get_settings()

    logger.info(f"Starting server on {settings.search_host}:{settings.search_port}")

    uvicorn.run(
        "search.main:app",
        host=settings.search_host,
        port=settings.search_port,
        reload=settings.debug,
        log_level="info",
    )


if __name__ == "__main__":
    run()

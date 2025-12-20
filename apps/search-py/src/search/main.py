"""Engram Search Service - FastAPI application entry point."""

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from search.api import router
from search.clients import QdrantClientWrapper
from search.config import get_settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


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

    # Startup: Initialize Qdrant client
    logger.info("Starting Engram Search Service...")
    logger.info(f"Qdrant URL: {settings.qdrant_url}")
    logger.info(f"Qdrant Collection: {settings.qdrant_collection}")

    qdrant_client = QdrantClientWrapper(settings)

    try:
        await qdrant_client.connect()
        app.state.qdrant = qdrant_client
        logger.info("Qdrant client initialized successfully")

        # Check if collection exists
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

    except Exception as e:
        logger.error(f"Failed to initialize Qdrant client: {e}")
        logger.warning("Service starting in degraded mode without Qdrant")
        app.state.qdrant = None

    logger.info("Engram Search Service startup complete")

    yield

    # Shutdown: Cleanup resources
    logger.info("Shutting down Engram Search Service...")

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
    settings = get_settings()

    app = FastAPI(
        title="Engram Search Service",
        description=(
            "Intelligent vector search service with embedding, sparse retrieval, "
            "and multi-tier reranking for the Engram memory system"
        ),
        version="0.1.0",
        lifespan=lifespan,
        debug=settings.debug,
    )

    # CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
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

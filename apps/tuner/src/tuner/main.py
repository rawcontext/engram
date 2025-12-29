"""Engram Tuner Service - FastAPI application entry point."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tuner.api import router
from tuner.config import get_settings
from tuner.core import get_storage
from tuner.middleware.auth import AuthHandler, set_auth_handler
from tuner.utils.logging import configure_logging, get_logger

configure_logging(json_format=True)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan manager.

    Initializes and cleans up resources like database connections.
    """
    settings = get_settings()

    # Initialize auth handler if enabled
    auth_handler: AuthHandler | None = None
    if settings.auth_enabled:
        logger.info("Initializing authentication (API keys + OAuth)")
        auth_handler = AuthHandler(settings.auth_database_url)
        try:
            await auth_handler.connect()
            set_auth_handler(auth_handler)
            app.state.auth_handler = auth_handler
            logger.info("Authentication initialized (API keys + OAuth tokens)")
        except Exception as e:
            logger.error("Failed to initialize auth", error=str(e))
            raise RuntimeError(
                f"Auth database connection failed: {e}. "
                "Set AUTH_ENABLED=false to run without authentication (NOT RECOMMENDED)."
            ) from e
    else:
        logger.warning("Authentication DISABLED (AUTH_ENABLED=false)")

    # Initialize Optuna storage
    try:
        storage = get_storage()
        app.state.storage = storage
        logger.info("Connected to Optuna storage", database_url=str(settings.database_url))
    except Exception as e:
        logger.warning("Could not connect to storage", error=str(e))
        app.state.storage = None

    yield

    # Close auth handler
    if hasattr(app.state, "auth_handler") and app.state.auth_handler is not None:
        try:
            await app.state.auth_handler.disconnect()
            logger.info("Auth handler closed")
        except Exception as e:
            logger.error("Error closing auth handler", error=str(e))

    # Cleanup (storage cleanup handled by SQLAlchemy connection pool)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    settings = get_settings()

    app = FastAPI(
        title="Engram Tuner Service",
        description="Hyperparameter optimization service for Engram search using Optuna",
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
    """Run the application with uvicorn."""
    settings = get_settings()
    uvicorn.run(
        "tuner.main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    run()

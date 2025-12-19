"""Engram Tuner Service - FastAPI application entry point."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from tuner.api import router
from tuner.config import get_settings
from tuner.core import get_storage


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
    """Application lifespan manager.

    Initializes and cleans up resources like database connections.
    """
    settings = get_settings()

    # Initialize Optuna storage
    try:
        storage = get_storage()
        app.state.storage = storage
        print(f"Connected to Optuna storage: {settings.database_url.host}")
    except Exception as e:
        print(f"Warning: Could not connect to storage: {e}")
        app.state.storage = None

    yield

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

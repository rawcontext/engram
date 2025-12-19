"""Health check endpoints."""

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str
    storage_connected: bool


@router.get("/health", response_model=HealthResponse)
async def health_check(request: Request) -> HealthResponse:
    """Check service health and storage connectivity."""
    storage = getattr(request.app.state, "storage", None)
    storage_connected = False

    if storage is not None:
        try:
            # Verify storage by listing studies (lightweight operation)
            storage.get_all_studies()
            storage_connected = True
        except Exception:
            storage_connected = False

    return HealthResponse(
        status="healthy" if storage_connected else "degraded",
        version="0.1.0",
        storage_connected=storage_connected,
    )


@router.get("/ready")
async def readiness_check(request: Request) -> dict[str, str]:
    """Kubernetes readiness probe."""
    storage = getattr(request.app.state, "storage", None)
    if storage is None:
        return {"status": "not_ready", "reason": "storage not initialized"}

    try:
        storage.get_all_studies()
        return {"status": "ready"}
    except Exception as e:
        return {"status": "not_ready", "reason": str(e)}

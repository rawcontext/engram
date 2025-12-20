"""Main API router aggregating all endpoints."""

from fastapi import APIRouter

from search.api import routes

router = APIRouter()

# Include all route modules
router.include_router(routes.router, tags=["search"])

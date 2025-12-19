"""Main API router aggregating all endpoints."""

from fastapi import APIRouter

from tuner.api import analysis, health, studies, trials

router = APIRouter(prefix="/api/v1")

router.include_router(health.router, tags=["health"])
router.include_router(studies.router, prefix="/studies", tags=["studies"])
router.include_router(trials.router, prefix="/studies", tags=["trials"])
router.include_router(analysis.router, prefix="/studies", tags=["analysis"])

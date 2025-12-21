"""Optuna storage management with PostgreSQL backend."""

from functools import lru_cache
from typing import TYPE_CHECKING

import optuna

if TYPE_CHECKING:
    from optuna.storages import RDBStorage

from tuner.config import get_settings


@lru_cache(maxsize=1)
def get_storage() -> "RDBStorage":
    """Get cached RDBStorage instance for PostgreSQL.

    Uses connection pooling for distributed optimization.
    """
    settings = get_settings()
    # Convert Pydantic PostgresDsn to string using unicode()
    db_url = str(settings.database_url)
    return optuna.storages.RDBStorage(
        url=db_url,
        engine_kwargs={
            "pool_size": 20,
            "max_overflow": 40,
            "pool_pre_ping": True,
            "pool_recycle": 3600,
        },
    )


def reset_storage() -> None:
    """Clear the cached storage instance (for testing)."""
    get_storage.cache_clear()

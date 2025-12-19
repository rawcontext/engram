"""Study models for Optuna study management."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from tuner.models.search_space import SearchSpaceParameter


class CreateStudyRequest(BaseModel):
    """Request to create a new optimization study."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=256)
    direction: Literal["maximize", "minimize"] | list[Literal["maximize", "minimize"]] = (
        "maximize"
    )
    search_space: list[SearchSpaceParameter]
    sampler: Literal["tpe", "gp", "random", "nsgaii", "qmc"] = "tpe"
    pruner: Literal["hyperband", "median", "none"] = "hyperband"
    load_if_exists: bool = True


class StudyResponse(BaseModel):
    """Response after creating or fetching a study."""

    model_config = ConfigDict(extra="forbid")

    study_id: int
    study_name: str
    direction: str | list[str]
    n_trials: int
    best_value: float | list[float] | None = None
    best_params: dict[str, float | int | str | bool] | None = None
    datetime_start: datetime | None = None
    user_attrs: dict[str, object] = Field(default_factory=dict)


class StudySummary(BaseModel):
    """Summary of a study for listing."""

    model_config = ConfigDict(extra="forbid")

    study_id: int
    study_name: str
    direction: str | list[str]
    n_trials: int
    best_value: float | list[float] | None = None
    datetime_start: datetime | None = None

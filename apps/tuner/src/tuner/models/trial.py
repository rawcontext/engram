"""Trial models for Optuna trial management."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TrialState(str, Enum):
    """Trial execution state."""

    RUNNING = "RUNNING"
    COMPLETE = "COMPLETE"
    PRUNED = "PRUNED"
    FAIL = "FAIL"
    WAITING = "WAITING"


class TrialSuggestion(BaseModel):
    """Suggested parameters for a trial."""

    model_config = ConfigDict(extra="forbid")

    trial_id: int
    params: dict[str, float | int | str | bool]
    study_name: str


class TrialCompleteRequest(BaseModel):
    """Request to complete a trial with results."""

    model_config = ConfigDict(extra="forbid")

    values: float | list[float] = Field(
        ..., description="Objective value(s) to report. Single value or list for multi-objective."
    )
    intermediate_values: dict[int, float] = Field(
        default_factory=dict,
        description="Intermediate values keyed by step number for pruning.",
    )
    user_attrs: dict[str, Any] = Field(
        default_factory=dict,
        description="Custom attributes to store with the trial (e.g., metrics breakdown).",
    )


class TrialResponse(BaseModel):
    """Response with trial details."""

    model_config = ConfigDict(extra="forbid")

    trial_id: int
    study_name: str
    state: TrialState
    values: list[float] | None = None
    params: dict[str, float | int | str | bool]
    datetime_start: datetime | None = None
    datetime_complete: datetime | None = None
    duration_seconds: float | None = None
    user_attrs: dict[str, Any] = Field(default_factory=dict)

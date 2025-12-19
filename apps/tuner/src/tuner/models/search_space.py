"""Search space parameter models."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class FloatParameter(BaseModel):
    """Continuous float parameter."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["float"] = "float"
    name: str
    low: float
    high: float
    step: float | None = None
    log: bool = False


class IntParameter(BaseModel):
    """Integer parameter."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["int"] = "int"
    name: str
    low: int
    high: int
    step: int = 1
    log: bool = False


class CategoricalParameter(BaseModel):
    """Categorical parameter with discrete choices."""

    model_config = ConfigDict(extra="forbid")

    type: Literal["categorical"] = "categorical"
    name: str
    choices: list[str | int | float | bool]


SearchSpaceParameter = Annotated[
    FloatParameter | IntParameter | CategoricalParameter,
    Field(discriminator="type"),
]

"""Optuna pruner factory."""

from typing import Literal

import optuna

PrunerType = Literal["hyperband", "median", "none"]


def create_pruner(
    pruner_type: PrunerType,
    *,
    min_resource: int = 10,
    max_resource: int = 1000,
    reduction_factor: int = 3,
) -> optuna.pruners.BasePruner | None:
    """Create an Optuna pruner by type.

    Args:
        pruner_type: Type of pruner to create.
        min_resource: Minimum resource before pruning can occur.
        max_resource: Maximum resource (full evaluation size).
        reduction_factor: Reduction factor for Hyperband.

    Returns:
        Configured Optuna pruner instance, or None for no pruning.
    """
    match pruner_type:
        case "hyperband":
            return optuna.pruners.HyperbandPruner(
                min_resource=min_resource,
                max_resource=max_resource,
                reduction_factor=reduction_factor,
            )
        case "median":
            return optuna.pruners.MedianPruner(
                n_startup_trials=5,
                n_warmup_steps=10,
                interval_steps=1,
            )
        case "none":
            return None
        case _:
            msg = f"Unknown pruner type: {pruner_type}"
            raise ValueError(msg)

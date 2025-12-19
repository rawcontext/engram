"""Optuna sampler factory."""

from typing import Literal

import optuna

SamplerType = Literal["tpe", "gp", "random", "nsgaii", "qmc"]


def create_sampler(
    sampler_type: SamplerType,
    *,
    seed: int | None = None,
    n_startup_trials: int = 10,
) -> optuna.samplers.BaseSampler:
    """Create an Optuna sampler by type.

    Args:
        sampler_type: Type of sampler to create.
        seed: Random seed for reproducibility.
        n_startup_trials: Number of random trials before optimization begins.

    Returns:
        Configured Optuna sampler instance.
    """
    match sampler_type:
        case "tpe":
            return optuna.samplers.TPESampler(
                seed=seed,
                n_startup_trials=n_startup_trials,
                multivariate=True,
                constant_liar=True,  # Better for parallel optimization
            )
        case "gp":
            return optuna.samplers.GPSampler(
                seed=seed,
                n_startup_trials=n_startup_trials,
            )
        case "random":
            return optuna.samplers.RandomSampler(seed=seed)
        case "nsgaii":
            return optuna.samplers.NSGAIISampler(
                seed=seed,
                population_size=50,
            )
        case "qmc":
            return optuna.samplers.QMCSampler(
                seed=seed,
            )
        case _:
            msg = f"Unknown sampler type: {sampler_type}"
            raise ValueError(msg)

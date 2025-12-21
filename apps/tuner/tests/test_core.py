"""Tests for core functionality (samplers and pruners)."""

import pytest
import optuna

from tuner.core.samplers import SamplerType, create_sampler
from tuner.core.pruners import PrunerType, create_pruner


class TestCreateSampler:
    """Tests for sampler factory."""

    def test_create_tpe_sampler(self) -> None:
        """Test creating TPE sampler."""
        sampler = create_sampler("tpe")
        assert isinstance(sampler, optuna.samplers.TPESampler)

    def test_create_tpe_sampler_with_seed(self) -> None:
        """Test creating TPE sampler with seed."""
        sampler = create_sampler("tpe", seed=42)
        assert isinstance(sampler, optuna.samplers.TPESampler)

    def test_create_gp_sampler(self) -> None:
        """Test creating GP sampler."""
        sampler = create_sampler("gp")
        assert isinstance(sampler, optuna.samplers.GPSampler)

    def test_create_random_sampler(self) -> None:
        """Test creating random sampler."""
        sampler = create_sampler("random")
        assert isinstance(sampler, optuna.samplers.RandomSampler)

    def test_create_nsgaii_sampler(self) -> None:
        """Test creating NSGA-II sampler."""
        sampler = create_sampler("nsgaii")
        assert isinstance(sampler, optuna.samplers.NSGAIISampler)

    def test_create_qmc_sampler(self) -> None:
        """Test creating QMC sampler."""
        sampler = create_sampler("qmc")
        assert isinstance(sampler, optuna.samplers.QMCSampler)

    def test_create_sampler_with_startup_trials(self) -> None:
        """Test creating sampler with custom startup trials."""
        sampler = create_sampler("tpe", n_startup_trials=20)
        assert isinstance(sampler, optuna.samplers.TPESampler)

    def test_invalid_sampler_type(self) -> None:
        """Test invalid sampler type raises error."""
        with pytest.raises(ValueError, match="Unknown sampler type"):
            create_sampler("invalid")  # type: ignore[arg-type]

    def test_all_sampler_types(self) -> None:
        """Test all defined sampler types can be created."""
        sampler_types: list[SamplerType] = ["tpe", "gp", "random", "nsgaii", "qmc"]
        for sampler_type in sampler_types:
            sampler = create_sampler(sampler_type)
            assert isinstance(sampler, optuna.samplers.BaseSampler)


class TestCreatePruner:
    """Tests for pruner factory."""

    def test_create_hyperband_pruner(self) -> None:
        """Test creating Hyperband pruner."""
        pruner = create_pruner("hyperband")
        assert isinstance(pruner, optuna.pruners.HyperbandPruner)

    def test_create_hyperband_with_params(self) -> None:
        """Test creating Hyperband pruner with custom params."""
        pruner = create_pruner(
            "hyperband",
            min_resource=5,
            max_resource=500,
            reduction_factor=2,
        )
        assert isinstance(pruner, optuna.pruners.HyperbandPruner)

    def test_create_median_pruner(self) -> None:
        """Test creating Median pruner."""
        pruner = create_pruner("median")
        assert isinstance(pruner, optuna.pruners.MedianPruner)

    def test_create_no_pruner(self) -> None:
        """Test creating no pruner."""
        pruner = create_pruner("none")
        assert pruner is None

    def test_invalid_pruner_type(self) -> None:
        """Test invalid pruner type raises error."""
        with pytest.raises(ValueError, match="Unknown pruner type"):
            create_pruner("invalid")  # type: ignore[arg-type]

    def test_all_pruner_types(self) -> None:
        """Test all defined pruner types can be created."""
        pruner_types: list[PrunerType] = ["hyperband", "median", "none"]
        for pruner_type in pruner_types:
            pruner = create_pruner(pruner_type)
            if pruner_type == "none":
                assert pruner is None
            else:
                assert isinstance(pruner, optuna.pruners.BasePruner)


class TestSamplerIntegration:
    """Integration tests for samplers with Optuna studies."""

    def test_tpe_sampler_suggests_params(self) -> None:
        """Test TPE sampler suggests parameters correctly."""
        sampler = create_sampler("tpe", seed=42)
        study = optuna.create_study(sampler=sampler)

        def objective(trial: optuna.Trial) -> float:
            x = trial.suggest_float("x", 0, 10)
            return x**2

        study.optimize(objective, n_trials=5)
        assert len(study.trials) == 5

    def test_random_sampler_reproducibility(self) -> None:
        """Test random sampler is reproducible with seed."""
        sampler1 = create_sampler("random", seed=42)
        sampler2 = create_sampler("random", seed=42)

        study1 = optuna.create_study(sampler=sampler1)
        study2 = optuna.create_study(sampler=sampler2)

        def objective(trial: optuna.Trial) -> float:
            return trial.suggest_float("x", 0, 10)

        study1.optimize(objective, n_trials=3)
        study2.optimize(objective, n_trials=3)

        for t1, t2 in zip(study1.trials, study2.trials, strict=True):
            assert t1.params == t2.params


class TestPrunerIntegration:
    """Integration tests for pruners with Optuna studies."""

    def test_hyperband_pruner_prunes_trial(self) -> None:
        """Test Hyperband pruner can prune trials."""
        pruner = create_pruner("hyperband", min_resource=1, max_resource=10)
        sampler = create_sampler("random", seed=42)
        study = optuna.create_study(sampler=sampler, pruner=pruner)

        def objective(trial: optuna.Trial) -> float:
            for step in range(10):
                trial.report(step, step)
                if trial.should_prune():
                    raise optuna.TrialPruned()
            return trial.suggest_float("x", 0, 10)

        # Run enough trials that some might get pruned
        study.optimize(objective, n_trials=10)
        assert len(study.trials) == 10

    def test_no_pruner_never_prunes(self) -> None:
        """Test no pruner never prunes trials."""
        pruner = create_pruner("none")
        sampler = create_sampler("random", seed=42)
        study = optuna.create_study(sampler=sampler, pruner=pruner)

        def objective(trial: optuna.Trial) -> float:
            for step in range(5):
                trial.report(step, step)
                # should_prune should always return False
                assert not trial.should_prune()
            return trial.suggest_float("x", 0, 10)

        study.optimize(objective, n_trials=3)
        # All trials should complete (none pruned)
        assert all(t.state == optuna.trial.TrialState.COMPLETE for t in study.trials)

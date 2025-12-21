"""Tests for Pydantic models."""

from datetime import datetime
from typing import Any

import pytest
from pydantic import ValidationError

from tuner.models.search_space import (
    CategoricalParameter,
    FloatParameter,
    IntParameter,
)
from tuner.models.study import CreateStudyRequest, StudyResponse, StudySummary
from tuner.models.trial import (
    TrialCompleteRequest,
    TrialResponse,
    TrialState,
    TrialSuggestion,
)


class TestFloatParameter:
    """Tests for FloatParameter model."""

    def test_valid_float_parameter(self, sample_float_param: dict[str, Any]) -> None:
        """Test creating a valid float parameter."""
        param = FloatParameter(**sample_float_param)
        assert param.name == "learning_rate"
        assert param.low == 1e-5
        assert param.high == 1e-1
        assert param.log is True
        assert param.type == "float"

    def test_float_parameter_defaults(self) -> None:
        """Test float parameter default values."""
        param = FloatParameter(name="test", low=0.0, high=1.0)
        assert param.step is None
        assert param.log is False

    def test_float_parameter_with_step(self) -> None:
        """Test float parameter with step."""
        param = FloatParameter(name="test", low=0.0, high=1.0, step=0.1)
        assert param.step == 0.1

    def test_float_parameter_forbids_extra(self) -> None:
        """Test that extra fields are forbidden."""
        with pytest.raises(ValidationError):
            FloatParameter(name="test", low=0.0, high=1.0, extra_field="invalid")


class TestIntParameter:
    """Tests for IntParameter model."""

    def test_valid_int_parameter(self, sample_int_param: dict[str, Any]) -> None:
        """Test creating a valid int parameter."""
        param = IntParameter(**sample_int_param)
        assert param.name == "batch_size"
        assert param.low == 16
        assert param.high == 256
        assert param.step == 16
        assert param.type == "int"

    def test_int_parameter_defaults(self) -> None:
        """Test int parameter default values."""
        param = IntParameter(name="test", low=1, high=10)
        assert param.step == 1
        assert param.log is False

    def test_int_parameter_forbids_extra(self) -> None:
        """Test that extra fields are forbidden."""
        with pytest.raises(ValidationError):
            IntParameter(name="test", low=1, high=10, extra_field="invalid")


class TestCategoricalParameter:
    """Tests for CategoricalParameter model."""

    def test_valid_categorical_parameter(self, sample_categorical_param: dict[str, Any]) -> None:
        """Test creating a valid categorical parameter."""
        param = CategoricalParameter(**sample_categorical_param)
        assert param.name == "optimizer"
        assert param.choices == ["adam", "sgd", "adamw"]
        assert param.type == "categorical"

    def test_categorical_with_mixed_types(self) -> None:
        """Test categorical with mixed choice types."""
        param = CategoricalParameter(name="mixed", choices=[1, 2.5, "three", True])
        assert param.choices == [1, 2.5, "three", True]

    def test_categorical_forbids_extra(self) -> None:
        """Test that extra fields are forbidden."""
        with pytest.raises(ValidationError):
            CategoricalParameter(name="test", choices=["a"], extra_field="invalid")


class TestCreateStudyRequest:
    """Tests for CreateStudyRequest model."""

    def test_valid_study_request(self, sample_search_space: list[dict[str, Any]]) -> None:
        """Test creating a valid study request."""
        request = CreateStudyRequest(
            name="test_study",
            search_space=sample_search_space,
        )
        assert request.name == "test_study"
        assert request.direction == "maximize"
        assert request.sampler == "tpe"
        assert request.pruner == "hyperband"
        assert request.load_if_exists is True
        assert len(request.search_space) == 3

    def test_study_request_minimize(self, sample_search_space: list[dict[str, Any]]) -> None:
        """Test study with minimize direction."""
        request = CreateStudyRequest(
            name="test_study",
            direction="minimize",
            search_space=sample_search_space,
        )
        assert request.direction == "minimize"

    def test_study_request_multi_objective(self, sample_search_space: list[dict[str, Any]]) -> None:
        """Test multi-objective study."""
        request = CreateStudyRequest(
            name="test_study",
            direction=["maximize", "minimize"],
            search_space=sample_search_space,
        )
        assert request.direction == ["maximize", "minimize"]

    def test_study_request_custom_sampler(self, sample_search_space: list[dict[str, Any]]) -> None:
        """Test study with custom sampler."""
        request = CreateStudyRequest(
            name="test_study",
            sampler="gp",
            search_space=sample_search_space,
        )
        assert request.sampler == "gp"

    def test_study_request_name_validation(self, sample_search_space: list[dict[str, Any]]) -> None:
        """Test study name validation."""
        with pytest.raises(ValidationError):
            CreateStudyRequest(name="", search_space=sample_search_space)

    def test_study_request_invalid_sampler(self, sample_search_space: list[dict[str, Any]]) -> None:
        """Test invalid sampler type."""
        with pytest.raises(ValidationError):
            CreateStudyRequest(
                name="test",
                sampler="invalid_sampler",
                search_space=sample_search_space,
            )


class TestStudyResponse:
    """Tests for StudyResponse model."""

    def test_valid_study_response(self) -> None:
        """Test creating a valid study response."""
        response = StudyResponse(
            study_id=1,
            study_name="test_study",
            direction="maximize",
            n_trials=10,
            best_value=0.95,
            best_params={"lr": 0.001, "batch_size": 32},
        )
        assert response.study_id == 1
        assert response.best_value == 0.95

    def test_study_response_multi_objective(self) -> None:
        """Test multi-objective study response."""
        response = StudyResponse(
            study_id=1,
            study_name="test_study",
            direction=["maximize", "minimize"],
            n_trials=10,
            best_value=[0.95, 0.05],
        )
        assert response.best_value == [0.95, 0.05]

    def test_study_response_no_trials(self) -> None:
        """Test study response with no trials."""
        response = StudyResponse(
            study_id=1,
            study_name="test_study",
            direction="maximize",
            n_trials=0,
        )
        assert response.best_value is None
        assert response.best_params is None


class TestStudySummary:
    """Tests for StudySummary model."""

    def test_valid_study_summary(self) -> None:
        """Test creating a valid study summary."""
        summary = StudySummary(
            study_id=1,
            study_name="test_study",
            direction="maximize",
            n_trials=50,
            best_value=0.99,
            datetime_start=datetime.now(),
        )
        assert summary.study_id == 1
        assert summary.n_trials == 50


class TestTrialState:
    """Tests for TrialState enum."""

    def test_all_states_defined(self) -> None:
        """Test all trial states are defined."""
        states = list(TrialState)
        assert TrialState.RUNNING in states
        assert TrialState.COMPLETE in states
        assert TrialState.PRUNED in states
        assert TrialState.FAIL in states
        assert TrialState.WAITING in states

    def test_state_values(self) -> None:
        """Test trial state string values."""
        assert TrialState.RUNNING.value == "RUNNING"
        assert TrialState.COMPLETE.value == "COMPLETE"


class TestTrialSuggestion:
    """Tests for TrialSuggestion model."""

    def test_valid_suggestion(self) -> None:
        """Test creating a valid trial suggestion."""
        suggestion = TrialSuggestion(
            trial_id=1,
            params={"lr": 0.001, "batch_size": 32},
            study_name="test_study",
        )
        assert suggestion.trial_id == 1
        assert suggestion.params["lr"] == 0.001


class TestTrialCompleteRequest:
    """Tests for TrialCompleteRequest model."""

    def test_single_objective(self) -> None:
        """Test single objective completion."""
        request = TrialCompleteRequest(values=0.95)
        assert request.values == 0.95
        assert request.intermediate_values == {}
        assert request.user_attrs == {}

    def test_multi_objective(self) -> None:
        """Test multi-objective completion."""
        request = TrialCompleteRequest(values=[0.95, 0.05])
        assert request.values == [0.95, 0.05]

    def test_with_intermediate_values(self) -> None:
        """Test completion with intermediate values."""
        request = TrialCompleteRequest(
            values=0.95,
            intermediate_values={1: 0.5, 2: 0.7, 3: 0.9},
        )
        assert request.intermediate_values[2] == 0.7

    def test_with_user_attrs(self) -> None:
        """Test completion with user attributes."""
        request = TrialCompleteRequest(
            values=0.95,
            user_attrs={"precision": 0.96, "recall": 0.94},
        )
        assert request.user_attrs["precision"] == 0.96


class TestTrialResponse:
    """Tests for TrialResponse model."""

    def test_valid_trial_response(self) -> None:
        """Test creating a valid trial response."""
        response = TrialResponse(
            trial_id=1,
            study_name="test_study",
            state=TrialState.COMPLETE,
            values=[0.95],
            params={"lr": 0.001},
            datetime_start=datetime.now(),
            datetime_complete=datetime.now(),
            duration_seconds=120.5,
        )
        assert response.trial_id == 1
        assert response.state == TrialState.COMPLETE
        assert response.duration_seconds == 120.5

    def test_running_trial_response(self) -> None:
        """Test running trial response."""
        response = TrialResponse(
            trial_id=1,
            study_name="test_study",
            state=TrialState.RUNNING,
            params={"lr": 0.001},
        )
        assert response.values is None
        assert response.datetime_complete is None

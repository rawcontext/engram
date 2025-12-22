"""Trial management endpoints for the ask/tell optimization loop."""

import asyncio

import optuna
from fastapi import APIRouter, Depends, HTTPException, Request, status

from tuner.middleware.auth import ApiKeyContext, require_scope
from tuner.models import TrialCompleteRequest, TrialResponse, TrialState, TrialSuggestion

router = APIRouter()

# Auth dependency for tuner operations
tuner_auth = Depends(require_scope("tuner:read", "tuner:write", "memory:write"))


def _get_storage(request: Request) -> optuna.storages.RDBStorage:
    """Get storage from app state."""
    storage = getattr(request.app.state, "storage", None)
    if storage is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Storage not initialized",
        )
    return storage


async def _load_study(storage: optuna.storages.RDBStorage, study_name: str) -> optuna.Study:
    """Load a study by name."""
    try:
        return await asyncio.to_thread(optuna.load_study, study_name=study_name, storage=storage)
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study '{study_name}' not found",
        ) from e


def _suggest_value(
    trial: optuna.Trial,
    param: dict,
) -> float | int | str | bool:
    """Suggest a value for a parameter based on its type."""
    name = param["name"]
    param_type = param["type"]

    match param_type:
        case "float":
            return trial.suggest_float(
                name,
                param["low"],
                param["high"],
                step=param.get("step"),
                log=param.get("log", False),
            )
        case "int":
            return trial.suggest_int(
                name,
                param["low"],
                param["high"],
                step=param.get("step", 1),
                log=param.get("log", False),
            )
        case "categorical":
            return trial.suggest_categorical(name, param["choices"])
        case _:
            msg = f"Unknown parameter type: {param_type}"
            raise ValueError(msg)


@router.post("/{study_name}/trials/suggest", response_model=TrialSuggestion)
async def suggest_trial(
    request: Request,
    study_name: str,
    api_key: ApiKeyContext = tuner_auth,
) -> TrialSuggestion:
    """Get next trial parameters using Optuna's ask interface.

    This is the 'ask' part of the ask/tell pattern for distributed optimization.
    """
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    # Create a new trial
    trial = await asyncio.to_thread(study.ask)

    # Get search space from study user_attrs
    search_space = study.user_attrs.get("search_space", [])
    if not search_space:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No search space defined for this study",
        )

    # Suggest values for each parameter
    params: dict[str, float | int | str | bool] = {}
    for param in search_space:
        params[param["name"]] = _suggest_value(trial, param)

    return TrialSuggestion(
        trial_id=trial.number,
        params=params,
        study_name=study_name,
    )


@router.post("/{study_name}/trials/{trial_id}/complete", response_model=TrialResponse)
async def complete_trial(
    request: Request,
    study_name: str,
    trial_id: int,
    body: TrialCompleteRequest,
    api_key: ApiKeyContext = tuner_auth,
) -> TrialResponse:
    """Complete a trial with objective value(s).

    This is the 'tell' part of the ask/tell pattern for distributed optimization.
    """
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    # Normalize values to list for consistent handling
    values = body.values if isinstance(body.values, list) else [body.values]

    # Report intermediate values if provided (for pruning)
    if trial_id < 0 or trial_id >= len(study.trials):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Trial {trial_id} not found in study '{study_name}'",
        )
    trial = study.trials[trial_id]
    for step, value in body.intermediate_values.items():
        await asyncio.to_thread(trial.report, value, step)

    # Set user attributes
    for key, value in body.user_attrs.items():
        await asyncio.to_thread(trial.set_user_attr, key, value)

    # Tell Optuna the result
    await asyncio.to_thread(study.tell, trial_id, values)

    # Fetch updated trial
    trial = study.trials[trial_id]

    return TrialResponse(
        trial_id=trial.number,
        study_name=study_name,
        state=TrialState(trial.state.name),
        values=trial.values,
        params=trial.params,
        datetime_start=trial.datetime_start,
        datetime_complete=trial.datetime_complete,
        duration_seconds=(
            (trial.datetime_complete - trial.datetime_start).total_seconds()
            if trial.datetime_complete and trial.datetime_start
            else None
        ),
        user_attrs=trial.user_attrs,
    )


@router.post("/{study_name}/trials/{trial_id}/prune", response_model=TrialResponse)
async def prune_trial(
    request: Request,
    study_name: str,
    trial_id: int,
    api_key: ApiKeyContext = tuner_auth,
) -> TrialResponse:
    """Mark a trial as pruned (early stopped)."""
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    # Validate trial_id exists
    if trial_id < 0 or trial_id >= len(study.trials):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Trial {trial_id} not found in study '{study_name}'",
        )

    # Tell Optuna the trial was pruned
    await asyncio.to_thread(study.tell, trial_id, state=optuna.trial.TrialState.PRUNED)

    # Fetch updated trial
    trial = study.trials[trial_id]

    return TrialResponse(
        trial_id=trial.number,
        study_name=study_name,
        state=TrialState.PRUNED,
        values=None,
        params=trial.params,
        datetime_start=trial.datetime_start,
        datetime_complete=trial.datetime_complete,
        duration_seconds=(
            (trial.datetime_complete - trial.datetime_start).total_seconds()
            if trial.datetime_complete and trial.datetime_start
            else None
        ),
        user_attrs=trial.user_attrs,
    )


@router.get("/{study_name}/trials", response_model=list[TrialResponse])
async def list_trials(
    request: Request,
    study_name: str,
    state: TrialState | None = None,
    limit: int = 100,
    offset: int = 0,
    api_key: ApiKeyContext = tuner_auth,
) -> list[TrialResponse]:
    """List trials for a study with optional filtering."""
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    trials = study.trials

    # Filter by state if specified
    if state is not None:
        optuna_state = optuna.trial.TrialState[state.value]
        trials = [t for t in trials if t.state == optuna_state]

    # Apply pagination
    trials = trials[offset : offset + limit]

    return [
        TrialResponse(
            trial_id=t.number,
            study_name=study_name,
            state=TrialState(t.state.name),
            values=t.values,
            params=t.params,
            datetime_start=t.datetime_start,
            datetime_complete=t.datetime_complete,
            duration_seconds=(
                (t.datetime_complete - t.datetime_start).total_seconds()
                if t.datetime_complete and t.datetime_start
                else None
            ),
            user_attrs=t.user_attrs,
        )
        for t in trials
    ]

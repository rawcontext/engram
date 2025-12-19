"""Study management endpoints."""

from datetime import datetime

import optuna
from fastapi import APIRouter, HTTPException, Request, status

from tuner.core import create_pruner, create_sampler
from tuner.models import CreateStudyRequest, StudyResponse, StudySummary

router = APIRouter()


def _get_storage(request: Request) -> optuna.storages.RDBStorage:
    """Get storage from app state."""
    storage = getattr(request.app.state, "storage", None)
    if storage is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Storage not initialized",
        )
    return storage


@router.post("", response_model=StudyResponse, status_code=status.HTTP_201_CREATED)
async def create_study(request: Request, body: CreateStudyRequest) -> StudyResponse:
    """Create a new optimization study."""
    storage = _get_storage(request)

    # Determine directions
    if isinstance(body.direction, list):
        directions = [
            optuna.study.StudyDirection.MAXIMIZE
            if d == "maximize"
            else optuna.study.StudyDirection.MINIMIZE
            for d in body.direction
        ]
    else:
        directions = (
            optuna.study.StudyDirection.MAXIMIZE
            if body.direction == "maximize"
            else optuna.study.StudyDirection.MINIMIZE
        )

    # Create sampler and pruner
    sampler = create_sampler(body.sampler)
    pruner = create_pruner(body.pruner)

    try:
        study = optuna.create_study(
            study_name=body.name,
            storage=storage,
            direction=directions if not isinstance(directions, list) else None,
            directions=directions if isinstance(directions, list) else None,
            sampler=sampler,
            pruner=pruner,
            load_if_exists=body.load_if_exists,
        )

        # Store search space in user_attrs for retrieval during suggest
        study.set_user_attr("search_space", [p.model_dump() for p in body.search_space])
        study.set_user_attr("sampler", body.sampler)
        study.set_user_attr("pruner", body.pruner)

    except optuna.exceptions.DuplicatedStudyError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Study '{body.name}' already exists",
        ) from e

    return StudyResponse(
        study_id=study._study_id,
        study_name=study.study_name,
        direction=body.direction,
        n_trials=len(study.trials),
        best_value=None,
        best_params=None,
        datetime_start=datetime.now(),
        user_attrs=study.user_attrs,
    )


@router.get("", response_model=list[StudySummary])
async def list_studies(request: Request) -> list[StudySummary]:
    """List all studies."""
    storage = _get_storage(request)
    summaries = storage.get_all_studies()

    return [
        StudySummary(
            study_id=s._study_id,
            study_name=s.study_name,
            direction=(
                [d.name.lower() for d in s.directions]
                if len(s.directions) > 1
                else s.directions[0].name.lower()
            ),
            n_trials=s.n_trials,
            best_value=None,  # Would require loading full study
            datetime_start=s.datetime_start,
        )
        for s in summaries
    ]


@router.get("/{study_name}", response_model=StudyResponse)
async def get_study(request: Request, study_name: str) -> StudyResponse:
    """Get study details by name."""
    storage = _get_storage(request)

    try:
        study = optuna.load_study(study_name=study_name, storage=storage)
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study '{study_name}' not found",
        ) from e

    # Get best trial info if available
    best_value = None
    best_params = None
    if len(study.trials) > 0:
        try:
            best_trial = study.best_trial
            best_value = best_trial.value if not study._is_multi_objective() else best_trial.values
            best_params = best_trial.params
        except ValueError:
            # No completed trials yet
            pass

    return StudyResponse(
        study_id=study._study_id,
        study_name=study.study_name,
        direction=(
            [d.name.lower() for d in study.directions]
            if len(study.directions) > 1
            else study.directions[0].name.lower()
        ),
        n_trials=len(study.trials),
        best_value=best_value,
        best_params=best_params,
        datetime_start=study.trials[0].datetime_start if study.trials else None,
        user_attrs=study.user_attrs,
    )


@router.delete("/{study_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_study(request: Request, study_name: str) -> None:
    """Delete a study by name."""
    storage = _get_storage(request)

    try:
        # Verify study exists before deleting
        _ = storage.get_study_id_from_name(study_name)
        optuna.delete_study(study_name=study_name, storage=storage)
    except KeyError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Study '{study_name}' not found",
        ) from e

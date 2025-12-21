"""Analysis endpoints for study results."""

import asyncio

import optuna
from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

router = APIRouter()


class BestParamsResponse(BaseModel):
    """Response with best parameters from a study."""

    params: dict[str, float | int | str | bool]
    value: float | list[float]
    trial_id: int


class ParamImportance(BaseModel):
    """Parameter importance scores."""

    importances: dict[str, float]
    method: str


class ParetoTrialResponse(BaseModel):
    """Trial on the Pareto frontier."""

    trial_id: int
    values: list[float]
    params: dict[str, float | int | str | bool]


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


@router.get("/{study_name}/best", response_model=BestParamsResponse)
async def get_best_params(request: Request, study_name: str) -> BestParamsResponse:
    """Get the best parameters from a study.

    For multi-objective studies, returns the first Pareto-optimal trial.
    """
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    if len(study.trials) == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No trials completed yet",
        )

    try:
        if study._is_multi_objective():
            # For multi-objective, return first Pareto-optimal trial
            pareto_trials = study.best_trials
            if not pareto_trials:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No Pareto-optimal trials found",
                )
            best = pareto_trials[0]
            return BestParamsResponse(
                params=best.params,
                value=best.values,
                trial_id=best.number,
            )
        else:
            best = study.best_trial
            return BestParamsResponse(
                params=best.params,
                value=best.value,
                trial_id=best.number,
            )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No completed trials found",
        ) from e


@router.get("/{study_name}/pareto", response_model=list[ParetoTrialResponse])
async def get_pareto_front(request: Request, study_name: str) -> list[ParetoTrialResponse]:
    """Get the Pareto frontier for a multi-objective study."""
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    if not study._is_multi_objective():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Pareto frontier is only available for multi-objective studies",
        )

    pareto_trials = study.best_trials

    return [
        ParetoTrialResponse(
            trial_id=t.number,
            values=t.values,
            params=t.params,
        )
        for t in pareto_trials
    ]


@router.get("/{study_name}/importance", response_model=ParamImportance)
async def get_param_importance(
    request: Request,
    study_name: str,
    target_idx: int = 0,
) -> ParamImportance:
    """Calculate parameter importance using fANOVA.

    For multi-objective studies, use target_idx to specify which objective.
    """
    storage = _get_storage(request)
    study = await _load_study(storage, study_name)

    completed_trials = [t for t in study.trials if t.state == optuna.trial.TrialState.COMPLETE]

    if len(completed_trials) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 completed trials required for importance analysis",
        )

    try:
        # Use fANOVA for parameter importance
        importance = await asyncio.to_thread(
            optuna.importance.get_param_importances,
            study,
            evaluator=optuna.importance.FanovaImportanceEvaluator(),
            target=lambda t: t.values[target_idx] if study._is_multi_objective() else t.value,
        )
    except Exception as e:
        # Fall back to mean decrease impurity if fANOVA fails
        try:
            importance = await asyncio.to_thread(
                optuna.importance.get_param_importances,
                study,
                evaluator=optuna.importance.MeanDecreaseImpurityImportanceEvaluator(),
                target=lambda t: (t.values[target_idx] if study._is_multi_objective() else t.value),
            )
            return ParamImportance(importances=importance, method="mean_decrease_impurity")
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to calculate importance: {e}",
            ) from e

    return ParamImportance(importances=importance, method="fanova")

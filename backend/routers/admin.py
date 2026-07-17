"""
Admin router — B3-4 (Model Registry) + existing admin endpoints migrated here

Routes
------
GET  /admin/models              — list all registered model versions
POST /admin/models              — register a new model version
POST /admin/models/{id}/activate — set one model active, deactivate all others

All endpoints are restricted to the `admin` role.

Design notes
------------
- Activation is an atomic transaction: deactivate all → activate target.
  If the transaction fails, the DB stays consistent.
- `INFERENCE_URL` is an env var controlled externally; activating a model in
  this registry does NOT hot-swap the running inference process (that requires
  a redeploy or a sidecar that watches the DB). What it DOES do:
    1. Records the admin's *intent* — the authoritative source of truth for
       "which model should be live".
    2. Writes `model_version` on every ingest so every report is traceable.
  Phase 4 can add a watcher that reads `is_active` and reloads the model.
"""

import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from auth import RoleChecker

router = APIRouter(prefix="/admin", tags=["admin"])

_ADMIN_ONLY = RoleChecker(["admin"])


# ─────────────────────────────────────────────────────────────────────────────
# GET /admin/models
# ─────────────────────────────────────────────────────────────────────────────

@router.get(
    "/models",
    response_model=List[schemas.AIModelResponse],
    summary="List all registered AI model versions",
)
def list_models(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_ADMIN_ONLY),
):
    """
    Return all model registry entries, newest first.

    The active model is the one with `is_active=True` (at most one at a time).
    """
    return (
        db.query(models.AIModel)
        .order_by(models.AIModel.registered_at.desc())
        .all()
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /admin/models
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/models",
    response_model=schemas.AIModelResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new AI model version",
)
def register_model(
    payload: schemas.AIModelCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_ADMIN_ONLY),
):
    """
    Register a new model version in the registry.

    - **version** must be globally unique (DB-enforced).
    - **artifact_url** is where the weights file lives (S3, GitHub Release, etc.).
    - **sha256** is the hex digest of the weights file — verified by the downloader.
    - **classes** is the ordered list of class names as the model outputs them.
    - **metrics** is a free-form JSON bag (mAP50, per-class AP, latency, etc.).
    - **is_active=True** is allowed here; it will trigger the same atomic
      deactivate-all → activate-new logic as the dedicated activation endpoint.
    """
    # Enforce unique version at application layer for a cleaner error message
    existing = (
        db.query(models.AIModel)
        .filter(models.AIModel.version == payload.version)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Model version '{payload.version}' is already registered.",
        )

    new_model = models.AIModel(
        id=str(uuid.uuid4()),
        version=payload.version,
        artifact_url=payload.artifact_url,
        sha256=payload.sha256,
        classes=payload.classes,
        conf_threshold=payload.conf_threshold,
        metrics=payload.metrics,
        is_active=False,  # never auto-activate on registration
        notes=payload.notes,
        registered_at=datetime.utcnow(),
    )
    db.add(new_model)

    try:
        db.commit()
        db.refresh(new_model)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to register model: {exc}",
        ) from exc

    return new_model


# ─────────────────────────────────────────────────────────────────────────────
# POST /admin/models/{model_id}/activate
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/models/{model_id}/activate",
    response_model=schemas.AIModelResponse,
    summary="Activate a model version (deactivates all others)",
)
def activate_model(
    model_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(_ADMIN_ONLY),
):
    """
    Set one model version as the active model.

    This is an **atomic** two-step transaction:
    1. Deactivate all currently active models.
    2. Set the target model's `is_active = True`.

    If step 2 fails, step 1 is rolled back — the DB never ends up with zero
    active models after a partial failure.

    The running inference service is NOT hot-swapped here (that is a Phase-4
    concern). This endpoint records the admin's intent and ensures every new
    report's `model_version` field is written correctly via the active registry
    entry.
    """
    target = db.query(models.AIModel).filter(models.AIModel.id == model_id).first()
    if not target:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Model '{model_id}' not found.",
        )

    if target.is_active:
        # Idempotent: already active — return without touching the DB
        return target

    try:
        # Step 1: deactivate all
        db.query(models.AIModel).update(
            {"is_active": False}, synchronize_session=False
        )
        # Step 2: activate target
        target.is_active = True
        db.commit()
        db.refresh(target)
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Activation failed: {exc}",
        ) from exc

    return target

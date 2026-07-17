"""
Notifications router — B3-2

Endpoints
---------
GET  /notifications                 — bell-icon feed for the current user
POST /notifications/{id}/read       — mark a single notification as read
POST /notifications/read-all        — mark all unread as read
GET  /notifications/preferences     — fetch current user's prefs
PUT  /notifications/preferences     — update current user's prefs

All endpoints require authentication (any role). Authority and admin users
also receive broadcast notifications (user_id IS NULL) in their feed.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

import models
import schemas
from database import get_db
from auth import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


# ─────────────────────────────────────────────────────────────────────────────
# GET /notifications
# ─────────────────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=schemas.NotificationListResponse,
    summary="Fetch in-app notifications for the current user",
)
def get_notifications(
    unread_only: bool = Query(False, description="Return only unread notifications"),
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """
    Return the bell-icon notification feed for the authenticated user.

    Authority and admin users additionally receive **broadcast** notifications
    (user_id IS NULL), which are platform-wide high-severity alerts not
    directed at a specific user.
    """
    # Base filter: notifications directed at the user OR broadcast to their role
    is_privileged = current_user.role in ("authority", "admin")

    if is_privileged:
        q = db.query(models.Notification).filter(
            or_(
                models.Notification.user_id == current_user.id,
                models.Notification.user_id.is_(None),
            )
        )
    else:
        q = db.query(models.Notification).filter(
            models.Notification.user_id == current_user.id
        )

    if unread_only:
        q = q.filter(models.Notification.is_read.is_(False))

    total = q.count()
    unread_count = (
        db.query(models.Notification)
        .filter(
            models.Notification.user_id == current_user.id,
            models.Notification.is_read.is_(False),
        )
        .count()
    )

    items = (
        q.order_by(models.Notification.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    return schemas.NotificationListResponse(
        notifications=[schemas.NotificationResponse.model_validate(n) for n in items],
        total=total,
        unread_count=unread_count,
    )


# ─────────────────────────────────────────────────────────────────────────────
# POST /notifications/{id}/read
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/{notification_id}/read",
    response_model=schemas.NotificationResponse,
    summary="Mark a single notification as read",
)
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Mark the specified notification as read for the current user."""
    notif = (
        db.query(models.Notification)
        .filter(
            models.Notification.id == notification_id,
            or_(
                models.Notification.user_id == current_user.id,
                models.Notification.user_id.is_(None),
            ),
        )
        .first()
    )
    if not notif:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Notification '{notification_id}' not found.",
        )
    notif.is_read = True
    db.commit()
    db.refresh(notif)
    return schemas.NotificationResponse.model_validate(notif)


# ─────────────────────────────────────────────────────────────────────────────
# POST /notifications/read-all
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/read-all",
    summary="Mark all unread notifications as read",
)
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Bulk-mark every unread notification for the current user as read."""
    updated = (
        db.query(models.Notification)
        .filter(
            models.Notification.user_id == current_user.id,
            models.Notification.is_read.is_(False),
        )
        .update({"is_read": True}, synchronize_session=False)
    )
    db.commit()
    return {"marked_read": updated}


# ─────────────────────────────────────────────────────────────────────────────
# GET /notifications/preferences
# ─────────────────────────────────────────────────────────────────────────────


@router.get(
    "/preferences",
    response_model=schemas.NotificationPreferenceResponse,
    summary="Fetch notification preferences for the current user",
)
def get_preferences(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Return the current user's notification preferences (created with defaults on first call)."""
    prefs = (
        db.query(models.NotificationPreference)
        .filter(models.NotificationPreference.user_id == current_user.id)
        .first()
    )
    if prefs is None:
        # Lazily create defaults
        prefs = models.NotificationPreference(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            min_severity="high",
            email_enabled=True,
            area_filter=None,
            digest_interval_seconds=300,
            updated_at=datetime.utcnow(),
        )
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return schemas.NotificationPreferenceResponse.model_validate(prefs)


# ─────────────────────────────────────────────────────────────────────────────
# PUT /notifications/preferences
# ─────────────────────────────────────────────────────────────────────────────


@router.put(
    "/preferences",
    response_model=schemas.NotificationPreferenceResponse,
    summary="Update notification preferences for the current user",
)
def update_preferences(
    payload: schemas.NotificationPreferenceUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Upsert the current user's notification preferences."""
    prefs = (
        db.query(models.NotificationPreference)
        .filter(models.NotificationPreference.user_id == current_user.id)
        .first()
    )
    if prefs is None:
        prefs = models.NotificationPreference(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            updated_at=datetime.utcnow(),
        )
        db.add(prefs)

    if payload.min_severity is not None:
        prefs.min_severity = payload.min_severity
    if payload.email_enabled is not None:
        prefs.email_enabled = payload.email_enabled
    if payload.area_filter is not None:
        prefs.area_filter = payload.area_filter
    if payload.digest_interval_seconds is not None:
        prefs.digest_interval_seconds = payload.digest_interval_seconds

    prefs.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(prefs)
    return schemas.NotificationPreferenceResponse.model_validate(prefs)

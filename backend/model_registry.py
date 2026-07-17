"""
model_registry.py — B3-4 · bridge Person A's ai/models.json into the DB registry

Two registries exist and they are NOT duplicates — they answer different questions:

  ai/models.json   (Person A, A3-7) — the DISTRIBUTION catalog: which versions
                                      exist, where to download them, their
                                      SHA256, their real numbers and their
                                      known weaknesses. Source of truth for
                                      "what is published".

  ai_models table  (Person B, B3-4) — the DEPLOYMENT registry: which version
                                      *this* deployment has, and which one an
                                      admin has activated. Source of truth for
                                      "what is live here".

This module syncs the first into the second so the Admin UI shows Person A's
real data instead of an empty table, without a second /admin/models route
(a duplicate path is exactly the G-10 bug that turned CI red before).

Sync rules
----------
- **Upsert by version.** A new version is inserted; a known version has its
  metadata refreshed (url/sha256/classes/conf/metrics/notes).
- **Activation is never overridden.** `is_active` reflects the *admin's* intent
  and is deployment state, not distribution state. Sync only ever activates when
  NOTHING is active yet — it seeds `models.json`'s `default` so a fresh install
  is usable. It will never silently flip a deliberate admin choice because
  Person A shipped a new default.
- **metrics are copied verbatim**, including Person A's `_note`. His numbers are
  deliberately not normalised into a single headline `map50`: he is explicit that
  RDD test AP is *not comparable across versions* (different test splits) and
  that the real-footage numbers are the ship gate. Inventing a comparable-looking
  metric here would launder exactly the caveat he attached.
"""

import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

import models

# repo_root/ai/models.json — this file lives at repo_root/backend/model_registry.py
_DEFAULT_REGISTRY_PATH = Path(__file__).resolve().parents[1] / "ai" / "models.json"

# Overridable so a container can mount the registry elsewhere.
REGISTRY_PATH = Path(os.getenv("MODELS_REGISTRY_PATH", str(_DEFAULT_REGISTRY_PATH)))

# models.notes is String(2000).
_NOTES_MAX = 2000


def _truncate(text: str, limit: int = _NOTES_MAX) -> str:
    """Trim to `limit` chars without splitting the string mid-escape."""
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _compose_notes(entry: dict) -> str:
    """Fold `trained_on` + `known_weaknesses` into the notes column.

    The weaknesses are the most valuable thing in Person A's registry — they are
    what stops someone trusting the model outside its validated domain — so they
    belong in front of whoever is choosing a model in the Admin UI.
    """
    parts = []
    if entry.get("trained_on"):
        parts.append(f"Trained on: {entry['trained_on']}")
    weaknesses = entry.get("known_weaknesses") or []
    if weaknesses:
        bullets = " ".join(f"• {w}" for w in weaknesses)
        parts.append(f"Known weaknesses: {bullets}")
    return _truncate(" | ".join(parts))


def load_registry(path: Optional[Path] = None) -> dict:
    """Read and parse ai/models.json. Raises FileNotFoundError / JSONDecodeError."""
    target = Path(path) if path else REGISTRY_PATH
    with open(target, "r", encoding="utf-8") as fh:
        return json.load(fh)


def sync_registry_to_db(db: Session, path: Optional[Path] = None) -> dict:
    """Upsert every entry from ai/models.json into the ai_models table.

    Returns a summary dict: {created, updated, activated, total, default}.
    Caller owns the commit boundary decision only insofar as this commits once
    at the end; on failure it rolls back and re-raises.
    """
    registry = load_registry(path)
    entries = registry.get("models") or {}
    default_version = registry.get("default")

    created, updated = [], []

    for version, entry in entries.items():
        existing = (
            db.query(models.AIModel).filter(models.AIModel.version == version).first()
        )
        notes = _compose_notes(entry)

        if existing:
            # Refresh distribution metadata. Deliberately does NOT touch is_active.
            existing.artifact_url = entry.get("url") or existing.artifact_url
            existing.sha256 = entry.get("sha256") or existing.sha256
            existing.classes = entry.get("classes") or existing.classes
            if entry.get("conf_threshold") is not None:
                existing.conf_threshold = entry["conf_threshold"]
            existing.metrics = entry.get("metrics")
            existing.notes = notes
            updated.append(version)
        else:
            db.add(
                models.AIModel(
                    id=str(uuid.uuid4()),
                    version=version,
                    artifact_url=entry.get("url", ""),
                    sha256=entry.get("sha256", ""),
                    classes=entry.get("classes") or [],
                    conf_threshold=entry.get("conf_threshold") or 0.0,
                    metrics=entry.get("metrics"),
                    is_active=False,  # activation is the admin's call, not the file's
                    notes=notes,
                    registered_at=datetime.utcnow(),
                )
            )
            created.append(version)

    try:
        db.flush()

        # Seed activation ONLY when nothing is active — a fresh install should be
        # usable, but a deliberate admin activation is never overridden by a file.
        activated = None
        has_active = (
            db.query(models.AIModel).filter(models.AIModel.is_active.is_(True)).first()
        )
        if not has_active and default_version:
            target = (
                db.query(models.AIModel)
                .filter(models.AIModel.version == default_version)
                .first()
            )
            if target:
                target.is_active = True
                activated = default_version

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "created": created,
        "updated": updated,
        "activated": activated,
        "total": len(entries),
        "default": default_version,
    }


def seed_model_registry() -> None:
    """Best-effort sync at startup, mirroring the seed_users() pattern.

    Never raises: a missing or malformed ai/models.json must not stop the API
    from booting. The Admin UI's Sync button surfaces the real error on demand.
    """
    import sys

    if "pytest" in sys.modules or os.getenv("TESTING") == "1":
        return

    from database import SessionLocal

    db = SessionLocal()
    try:
        summary = sync_registry_to_db(db)
        if summary["created"] or summary["updated"]:
            print(
                f"Model registry synced from {REGISTRY_PATH.name}: "
                f"{len(summary['created'])} new, {len(summary['updated'])} updated"
                + (
                    f", activated '{summary['activated']}'"
                    if summary["activated"]
                    else ""
                ),
                flush=True,
            )
    except FileNotFoundError:
        print(
            f"Model registry not synced: {REGISTRY_PATH} not found "
            "(run from a full checkout, or set MODELS_REGISTRY_PATH).",
            flush=True,
        )
    except Exception as exc:
        print(f"Model registry sync failed: {exc}", flush=True)
    finally:
        db.close()

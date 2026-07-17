"""Add ai_models table (model registry — B3-4)

Revision ID: d4f9e2b71a08
Revises: b8e2f47a1c39
Create Date: 2026-07-16 23:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d4f9e2b71a08"
down_revision: Union[str, Sequence[str], None] = "b8e2f47a1c39"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add ai_models table for the model registry."""
    op.create_table(
        "ai_models",
        sa.Column("id", sa.String(length=36), nullable=False),
        # Human-readable version tag, e.g. "roadsense-yolov8s-v4"
        sa.Column("version", sa.String(length=100), nullable=False),
        # Where the weights file lives: S3 URL, GitHub Release URL, local path, etc.
        sa.Column("artifact_url", sa.String(length=1000), nullable=False),
        # SHA-256 hex digest of the weights file — used to verify downloads
        sa.Column("sha256", sa.String(length=64), nullable=False),
        # JSON array of class name strings e.g. ["pothole", "road_crack"]
        sa.Column("classes", sa.JSON(), nullable=False),
        # Confidence threshold that was F1-optimal during training/eval
        sa.Column("conf_threshold", sa.Float(), nullable=False),
        # JSON bag of metrics: mAP50, per-class AP, real-footage numbers, etc.
        sa.Column("metrics", sa.JSON(), nullable=True),
        # Exactly one row has is_active=True at any time — the live model
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
        # Free-text notes: training config, dataset version, known weaknesses
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.Column("registered_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    # Fast lookup for the active model (used at startup and by /detect-image)
    op.create_index(
        "ix_ai_models_is_active",
        "ai_models",
        ["is_active"],
    )
    # Enforce unique version strings so duplicates are caught at DB level
    op.create_index(
        "ix_ai_models_version",
        "ai_models",
        ["version"],
        unique=True,
    )


def downgrade() -> None:
    """Drop ai_models table."""
    op.drop_index("ix_ai_models_version", table_name="ai_models")
    op.drop_index("ix_ai_models_is_active", table_name="ai_models")
    op.drop_table("ai_models")

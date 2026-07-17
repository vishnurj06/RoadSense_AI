"""Add notifications and notification_preferences tables

Revision ID: b8e2f47a1c39
Revises: a7f3c91e0b25
Create Date: 2026-07-16 23:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b8e2f47a1c39"
down_revision: Union[str, Sequence[str], None] = "a7f3c91e0b25"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add notification_preferences and notifications tables."""

    # ── notification_preferences ──────────────────────────────────────────────
    # One row per user (upserted when prefs change).
    op.create_table(
        "notification_preferences",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        # Minimum severity that triggers a notification: low | medium | high
        sa.Column(
            "min_severity", sa.String(length=10), nullable=False, server_default="high"
        ),
        # Whether to receive email digests
        sa.Column(
            "email_enabled", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
        # Optional bounding-box filter  [lat_min, lon_min, lat_max, lon_max]  NULL = anywhere
        sa.Column("area_filter", sa.JSON(), nullable=True),
        # Minimum seconds between consecutive email digests for the same user
        # Default: 300 s = 5 min  →  a 50-detection burst produces exactly 1 email
        sa.Column(
            "digest_interval_seconds",
            sa.Integer(),
            nullable=False,
            server_default="300",
        ),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_notification_preferences_user_id",
        "notification_preferences",
        ["user_id"],
        unique=True,  # one prefs row per user
    )

    # ── notifications ─────────────────────────────────────────────────────────
    # In-app bell feed; also used to back the email digest.
    op.create_table(
        "notifications",
        sa.Column("id", sa.String(length=36), nullable=False),
        # Recipient user — NULL means "broadcast" (visible to all authority users)
        sa.Column("user_id", sa.String(length=36), nullable=True),
        # One of: "new_high_severity_issue" | "digest" | "system"
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("body", sa.String(length=2000), nullable=True),
        # Link to the triggering resource (issue id, etc.)
        sa.Column("resource_id", sa.String(length=36), nullable=True),
        sa.Column("resource_type", sa.String(length=50), nullable=True),  # "issue"
        # Whether the user has dismissed it in the bell UI
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    # Indexes for the two common read patterns: bell feed + unread count
    op.create_index(
        "ix_notifications_user_created",
        "notifications",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_notifications_unread",
        "notifications",
        ["user_id", "is_read"],
    )


def downgrade() -> None:
    """Drop notification tables."""
    op.drop_index("ix_notifications_unread", table_name="notifications")
    op.drop_index("ix_notifications_user_created", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index(
        "ix_notification_preferences_user_id",
        table_name="notification_preferences",
    )
    op.drop_table("notification_preferences")

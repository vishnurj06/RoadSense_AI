"""Add assigned_to to issues (repair assignment — crew/contractor)

An Issue can be dispatched to a repair crew/contractor/team. Free text, nullable:
an issue may be "assigned" (queued) before a specific crew is named, and existing
rows have no assignee.

Revision ID: c3d8e1a9f472
Revises: f2a7b9c4d1e8
Create Date: 2026-07-18 05:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3d8e1a9f472"
down_revision: Union[str, Sequence[str], None] = "f2a7b9c4d1e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add issues.assigned_to (nullable free-text crew/contractor)."""
    op.add_column(
        "issues",
        sa.Column("assigned_to", sa.String(length=120), nullable=True),
    )


def downgrade() -> None:
    """Drop issues.assigned_to."""
    op.drop_column("issues", "assigned_to")

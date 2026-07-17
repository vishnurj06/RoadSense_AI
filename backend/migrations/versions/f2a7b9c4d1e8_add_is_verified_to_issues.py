"""Add is_verified to issues (code item #1 — verification threshold)

An Issue becomes is_verified=True only once >=2 distinct vehicles have reported it.
Existing rows default to False (unverified) via the server_default.

Revision ID: f2a7b9c4d1e8
Revises: e5c1a2f3b6d7
Create Date: 2026-07-18 03:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f2a7b9c4d1e8"
down_revision: Union[str, Sequence[str], None] = "e5c1a2f3b6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add issues.is_verified (default False for all existing rows)."""
    op.add_column(
        "issues",
        sa.Column(
            "is_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Drop issues.is_verified."""
    op.drop_column("issues", "is_verified")

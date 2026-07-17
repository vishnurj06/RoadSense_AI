"""Add vehicles table

Revision ID: a7f3c91e0b25
Revises: c12d856d463c
Create Date: 2026-07-16 22:20:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "a7f3c91e0b25"
down_revision: Union[str, Sequence[str], None] = "c12d856d463c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema — add vehicles table."""
    op.create_table(
        "vehicles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("plate", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("camera_id", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("last_seen", sa.DateTime(), nullable=True),
        sa.Column("registered_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_vehicles_plate"), "vehicles", ["plate"], unique=True)


def downgrade() -> None:
    """Downgrade schema — drop vehicles table."""
    op.drop_index(op.f("ix_vehicles_plate"), table_name="vehicles")
    op.drop_table("vehicles")

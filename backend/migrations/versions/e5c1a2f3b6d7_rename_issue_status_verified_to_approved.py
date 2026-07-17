"""Rename issue workflow status 'verified' -> 'approved' (code item #2)

The workflow status "verified" collided with the automatic verification-by-sightings
concept (code item #1). This data migration renames existing rows; also updates the
audit-log history so old_status/new_status stay consistent with the new vocabulary.

Revision ID: e5c1a2f3b6d7
Revises: d7a1f0962038
Create Date: 2026-07-18 02:55:00.000000

"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "e5c1a2f3b6d7"
down_revision: Union[str, Sequence[str], None] = "d7a1f0962038"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Rename 'verified' -> 'approved' in issues.status and the audit log."""
    op.execute(text("UPDATE issues SET status = 'approved' WHERE status = 'verified'"))
    op.execute(
        text(
            "UPDATE issue_audit_logs SET old_status = 'approved' "
            "WHERE old_status = 'verified'"
        )
    )
    op.execute(
        text(
            "UPDATE issue_audit_logs SET new_status = 'approved' "
            "WHERE new_status = 'verified'"
        )
    )


def downgrade() -> None:
    """Revert 'approved' -> 'verified'."""
    op.execute(text("UPDATE issues SET status = 'verified' WHERE status = 'approved'"))
    op.execute(
        text(
            "UPDATE issue_audit_logs SET old_status = 'verified' "
            "WHERE old_status = 'approved'"
        )
    )
    op.execute(
        text(
            "UPDATE issue_audit_logs SET new_status = 'verified' "
            "WHERE new_status = 'approved'"
        )
    )

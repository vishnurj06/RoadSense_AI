"""
notification_service.py — B3-2

Core notification logic for RoadSense AI.

Responsibilities
----------------
1. Persist an in-app Notification row whenever a new high-severity verified
   issue is created.
2. Email a digest to every eligible authority/admin user — **rate-limited** so
   a 50-detection burst produces exactly one email per user (not 50).
3. SMTP transport is intentionally mocked: set SMTP_MOCK=0 and fill in the
   real SMTP_* env vars to send actual mail.

Rate-limiting strategy
----------------------
We track the *last email digest timestamp* per user in Redis (key:
``notif:last_email:{user_id}``).  Before sending, we check whether
``now - last_email < prefs.digest_interval_seconds`` (default 300 s / 5 min).
If still within the window we skip the send — the in-app notification row was
already written, so no information is lost.  When Redis is unavailable we fall
back to a small in-process dict (process-local, not cluster-safe, but safe
enough for a single-worker dev server).

Usage
-----
Call ``trigger_high_severity_notification(issue, db, redis_client)`` from any
endpoint that creates or verifies a **high-severity** issue.  The call is
synchronous but cheap (<5 ms without real SMTP).
"""

import os
import uuid
import smtplib
import logging
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy.orm import Session

import models

logger = logging.getLogger(__name__)

# ── SMTP configuration (all optional — defaults to mock mode) ─────────────────
SMTP_MOCK: bool = os.getenv("SMTP_MOCK", "1") != "0"
SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.example.com")
SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER: str = os.getenv("SMTP_USER", "noreply@roadsense.ai")
SMTP_PASS: str = os.getenv("SMTP_PASS", "")
SMTP_FROM: str = os.getenv("SMTP_FROM", "RoadSense AI <noreply@roadsense.ai>")

# ── Fallback in-process rate-limit store (used when Redis is absent) ──────────
# Maps user_id → datetime of last email sent
_local_last_email: dict[str, datetime] = {}

# Redis key template
_REDIS_KEY = "notif:last_email:{user_id}"


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────


def _get_last_email_time(user_id: str, redis_client) -> Optional[datetime]:
    """Return the last email send time for *user_id*, or None if never sent."""
    if redis_client:
        try:
            raw = redis_client.get(_REDIS_KEY.format(user_id=user_id))
            if raw:
                return datetime.fromisoformat(raw)
        except Exception as exc:
            logger.warning("Redis read failed for notif key: %s", exc)
    # Fallback to in-process store
    return _local_last_email.get(user_id)


def _set_last_email_time(user_id: str, ts: datetime, redis_client) -> None:
    """Persist the last email send timestamp."""
    if redis_client:
        try:
            # TTL = 24 h — self-cleaning; we only care about the recent window
            redis_client.set(
                _REDIS_KEY.format(user_id=user_id),
                ts.isoformat(),
                ex=86400,
            )
            return
        except Exception as exc:
            logger.warning("Redis write failed for notif key: %s", exc)
    _local_last_email[user_id] = ts


def _get_or_create_prefs(user: models.User, db: Session) -> models.NotificationPreference:
    """Fetch or lazily create a NotificationPreference row for *user*."""
    prefs = (
        db.query(models.NotificationPreference)
        .filter(models.NotificationPreference.user_id == user.id)
        .first()
    )
    if prefs is None:
        prefs = models.NotificationPreference(
            id=str(uuid.uuid4()),
            user_id=user.id,
            min_severity="high",
            email_enabled=True,
            area_filter=None,
            digest_interval_seconds=300,
            updated_at=datetime.utcnow(),
        )
        db.add(prefs)
        db.flush()  # don't commit — caller owns the transaction
    return prefs


def _severity_meets_threshold(issue_severity: str, min_severity: str) -> bool:
    """Return True if *issue_severity* >= *min_severity*."""
    rank = {"low": 0, "medium": 1, "high": 2}
    return rank.get(issue_severity, 0) >= rank.get(min_severity, 2)


def _build_email(
    to_address: str,
    issue: models.Issue,
) -> MIMEMultipart:
    """Construct the HTML digest email."""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = (
        f"[RoadSense AI] ⚠️ New High-Severity Issue — "
        f"{issue.class_name.replace('_', ' ').title()} at "
        f"({issue.latitude:.4f}, {issue.longitude:.4f})"
    )
    msg["From"] = SMTP_FROM
    msg["To"] = to_address

    text_body = (
        f"A new high-severity road issue has been detected and verified.\n\n"
        f"  Type     : {issue.class_name}\n"
        f"  Severity : {issue.severity}\n"
        f"  Location : {issue.latitude:.5f}, {issue.longitude:.5f}\n"
        f"  Detected : {issue.created_at.strftime('%Y-%m-%d %H:%M UTC')}\n\n"
        f"Log in to the RoadSense AI dashboard to review and assign this issue.\n"
    )
    html_body = f"""
    <html><body style="font-family:sans-serif;color:#1a202c;background:#f7fafc;padding:24px">
      <div style="max-width:560px;margin:auto;background:#fff;border-radius:8px;
                  box-shadow:0 2px 8px rgba(0,0,0,.08);padding:32px">
        <h2 style="margin:0 0 8px;color:#e53e3e">⚠️ High-Severity Road Issue Detected</h2>
        <p style="color:#718096;margin:0 0 24px;font-size:14px">
          RoadSense AI Platform • {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:15px">
          <tr><td style="padding:8px 0;color:#718096;width:100px">Type</td>
              <td style="padding:8px 0;font-weight:600">
                {issue.class_name.replace('_',' ').title()}</td></tr>
          <tr style="background:#fff5f5">
              <td style="padding:8px 0;color:#718096">Severity</td>
              <td style="padding:8px 0;font-weight:700;color:#e53e3e;text-transform:uppercase">
                {issue.severity}</td></tr>
          <tr><td style="padding:8px 0;color:#718096">Location</td>
              <td style="padding:8px 0">{issue.latitude:.5f}, {issue.longitude:.5f}</td></tr>
          <tr style="background:#f0fff4">
              <td style="padding:8px 0;color:#718096">Detected</td>
              <td style="padding:8px 0">{issue.created_at.strftime('%Y-%m-%d %H:%M UTC')}</td></tr>
        </table>
        <div style="margin-top:28px">
          <a href="http://localhost:3000"
             style="background:#3182ce;color:#fff;padding:10px 22px;
                    border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">
            Open Dashboard →
          </a>
        </div>
        <p style="margin-top:24px;font-size:12px;color:#a0aec0">
          You received this because your RoadSense AI account is set to receive
          high-severity alerts. Adjust preferences in your profile settings.
        </p>
      </div>
    </body></html>
    """

    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))
    return msg


def _send_email(to_address: str, issue: models.Issue) -> bool:
    """
    Deliver the digest email.

    Returns True on success (or mock success), False on failure.
    Never raises — email failure must never break the ingest path.
    """
    msg = _build_email(to_address, issue)

    if SMTP_MOCK:
        # In mock mode: log the email to stdout so developers can inspect it.
        logger.info(
            "📧 [SMTP MOCK] Would send to %s — Subject: %s",
            to_address,
            msg["Subject"],
        )
        print(
            f"\n{'='*72}\n"
            f"📧  SMTP MOCK — email digest (not actually sent)\n"
            f"  To      : {to_address}\n"
            f"  Subject : {msg['Subject']}\n"
            f"  Issue   : {issue.id} | {issue.class_name} | {issue.severity}\n"
            f"{'='*72}\n",
            flush=True,
        )
        return True

    # Real SMTP (STARTTLS on port 587)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_FROM, [to_address], msg.as_string())
        logger.info("Email digest sent to %s for issue %s", to_address, issue.id)
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_address, exc)
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────


def create_in_app_notification(
    db: Session,
    *,
    issue: models.Issue,
    user_id: Optional[str] = None,
) -> models.Notification:
    """
    Persist a single in-app Notification row.

    If *user_id* is None the notification is broadcast (visible to all
    authority/admin users in the bell feed via the NULL user_id sentinel).
    """
    notif = models.Notification(
        id=str(uuid.uuid4()),
        user_id=user_id,
        type="new_high_severity_issue",
        title=(
            f"⚠️ New {issue.severity.title()} severity "
            f"{issue.class_name.replace('_', ' ').title()} detected"
        ),
        body=(
            f"A {issue.severity}-severity {issue.class_name.replace('_', ' ')} "
            f"was detected and verified at "
            f"({issue.latitude:.4f}, {issue.longitude:.4f})."
        ),
        resource_id=issue.id,
        resource_type="issue",
        is_read=False,
        created_at=datetime.utcnow(),
    )
    db.add(notif)
    # Caller is responsible for commit
    return notif


def trigger_high_severity_notification(
    issue: models.Issue,
    db: Session,
    redis_client=None,
) -> None:
    """
    Main entry point — called after a high-severity issue is created/verified.

    For every authority/admin user:
      1. Write an in-app Notification row (always).
      2. Check the per-user email rate-limit window.
      3. Send (or mock-send) a digest email if outside the window.

    This function never raises. All errors are logged; the caller's DB
    transaction is NOT affected (notifications are flushed separately).
    """
    if issue.severity != "high":
        return  # Only trigger for high-severity issues

    try:
        # Fetch all users eligible to receive high-severity alerts
        eligible_users: list[models.User] = (
            db.query(models.User)
            .filter(models.User.role.in_(["authority", "admin"]))
            .all()
        )

        now = datetime.utcnow()

        for user in eligible_users:
            try:
                prefs = _get_or_create_prefs(user, db)

                # Severity threshold check
                if not _severity_meets_threshold(issue.severity, prefs.min_severity):
                    continue

                # Write in-app notification (broadcast-style, one row per user)
                create_in_app_notification(db, issue=issue, user_id=user.id)

                # Email rate-limit check
                if not prefs.email_enabled:
                    continue

                last_sent = _get_last_email_time(user.id, redis_client)
                if last_sent is not None:
                    elapsed = (now - last_sent).total_seconds()
                    if elapsed < prefs.digest_interval_seconds:
                        logger.info(
                            "Rate-limit: skipping email for user %s "
                            "(%.0f s since last send, window=%d s)",
                            user.username,
                            elapsed,
                            prefs.digest_interval_seconds,
                        )
                        continue

                # Determine destination address.
                # In Phase 3 we don't have an `email` column on User yet; use a
                # deterministic placeholder that makes mock output readable.
                to_address = f"{user.username}@roadsense.local"

                ok = _send_email(to_address, issue)
                if ok:
                    _set_last_email_time(user.id, now, redis_client)

            except Exception as exc:
                logger.error(
                    "Notification error for user %s: %s",
                    getattr(user, "username", "?"),
                    exc,
                )

        # Flush the new notification rows within the caller's session.
        # The caller must still call db.commit() to persist them.
        db.flush()

    except Exception as exc:
        logger.error("trigger_high_severity_notification failed: %s", exc)

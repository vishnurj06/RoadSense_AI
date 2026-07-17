"""Login rate-limiting (B3-9 security hardening).

Throttles failed login attempts per client to blunt brute-force password guessing.

Mirrors ``notification_service``'s Redis-with-in-process-fallback pattern: when Redis
is available it is the source of truth (atomic ``INCR`` + ``EXPIRE`` window); when it
is absent the limiter degrades gracefully to an in-process dict so the server never
crashes or silently stops limiting.

The counter is keyed per ``{client_ip}:{username}`` — this catches the real threat
(many password guesses against one account from one source) without locking an entire
shared/NAT IP out because someone mistyped a different account's password.
"""

import logging
import os
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ── Config (env-overridable) ─────────────────────────────────────────────────
MAX_ATTEMPTS: int = int(os.getenv("LOGIN_MAX_ATTEMPTS", "5"))
WINDOW_SECONDS: int = int(os.getenv("LOGIN_WINDOW_SECONDS", "900"))  # 15 minutes

_REDIS_KEY = "login:fails:{key}"

# In-process fallback: key → (count, window_start_epoch). Used only when Redis is None.
_local_attempts: dict[str, tuple[int, float]] = {}


def _get_count(key: str, redis_client) -> int:
    """Current failed-attempt count for *key* within the active window (0 if none)."""
    if redis_client:
        try:
            raw = redis_client.get(_REDIS_KEY.format(key=key))
            return int(raw) if raw else 0
        except Exception as exc:
            logger.warning("Redis read failed for login limiter: %s", exc)
    entry = _local_attempts.get(key)
    if not entry:
        return 0
    count, start = entry
    if time.time() - start > WINDOW_SECONDS:
        _local_attempts.pop(key, None)
        return 0
    return count


def is_rate_limited(key: str, redis_client) -> bool:
    """True if *key* has already reached ``MAX_ATTEMPTS`` within the window."""
    return _get_count(key, redis_client) >= MAX_ATTEMPTS


def record_failure(key: str, redis_client) -> None:
    """Increment the failed-attempt counter for *key*, starting the window if new."""
    if redis_client:
        try:
            redis_key = _REDIS_KEY.format(key=key)
            new_count = redis_client.incr(redis_key)
            if new_count == 1:
                # First failure in this window — arm the expiry so it self-cleans.
                redis_client.expire(redis_key, WINDOW_SECONDS)
            return
        except Exception as exc:
            logger.warning("Redis write failed for login limiter: %s", exc)
    now = time.time()
    entry = _local_attempts.get(key)
    if not entry or now - entry[1] > WINDOW_SECONDS:
        _local_attempts[key] = (1, now)
    else:
        _local_attempts[key] = (entry[0] + 1, entry[1])


def reset(key: str, redis_client) -> None:
    """Clear the counter for *key* — called on a successful login."""
    if redis_client:
        try:
            redis_client.delete(_REDIS_KEY.format(key=key))
        except Exception as exc:
            logger.warning("Redis delete failed for login limiter: %s", exc)
    _local_attempts.pop(key, None)


def retry_after_seconds(key: str, redis_client) -> Optional[int]:
    """Seconds until the window resets for *key* (best-effort; None if unknown)."""
    if redis_client:
        try:
            ttl = redis_client.ttl(_REDIS_KEY.format(key=key))
            return ttl if ttl and ttl > 0 else WINDOW_SECONDS
        except Exception:
            return WINDOW_SECONDS
    entry = _local_attempts.get(key)
    if not entry:
        return None
    remaining = WINDOW_SECONDS - (time.time() - entry[1])
    return max(1, int(remaining))

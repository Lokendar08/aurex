"""Fixed-window rate limiting with a Redis backend and an in-process fallback.

Redis is used when ``AUREX_REDIS_URL`` is configured and reachable (required for multi-process
production deployments). Otherwise an in-memory limiter is used, which is correct for a single
API process (local development, tests).
"""

from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict

from app.core.config import get_settings
from app.core.errors import RateLimitedError

logger = logging.getLogger("aurex.ratelimit")


class _MemoryBackend:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))

    def hit(self, key: str, window_s: int) -> tuple[int, int]:
        now = time.time()
        with self._lock:
            count, reset_at = self._counts[key]
            if now >= reset_at:
                count, reset_at = 0, now + window_s
            count += 1
            self._counts[key] = (count, reset_at)
            if len(self._counts) > 50_000:  # bound memory
                for stale in [k for k, (_, r) in self._counts.items() if r < now]:
                    self._counts.pop(stale, None)
            return count, max(1, int(reset_at - now))

    def reset(self) -> None:
        with self._lock:
            self._counts.clear()


class _RedisBackend:
    def __init__(self, url: str) -> None:
        import redis

        self._client = redis.Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)
        self._client.ping()

    def hit(self, key: str, window_s: int) -> tuple[int, int]:
        bucket = int(time.time() // window_s)
        redis_key = f"aurex:rl:{key}:{bucket}"
        pipe = self._client.pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, window_s + 1)
        count, _ = pipe.execute()
        return int(count), window_s - int(time.time() % window_s)

    def reset(self) -> None:  # pragma: no cover - only used in tests with memory backend
        pass


class RateLimiter:
    def __init__(self) -> None:
        self._backend: _MemoryBackend | _RedisBackend | None = None
        self._lock = threading.Lock()

    def _get_backend(self) -> _MemoryBackend | _RedisBackend:
        if self._backend is None:
            with self._lock:
                if self._backend is None:
                    url = get_settings().redis_url
                    if url:
                        try:
                            self._backend = _RedisBackend(url)
                        except Exception as exc:  # noqa: BLE001
                            logger.warning("Redis unavailable for rate limiting (%s); using in-memory limiter", exc)
                    if self._backend is None:
                        self._backend = _MemoryBackend()
        return self._backend

    def check(self, scope: str, identity: str, limit: int, window_s: int = 60) -> None:
        if not get_settings().rate_limit_enabled or limit <= 0:
            return
        count, retry_after = self._get_backend().hit(f"{scope}:{identity}", window_s)
        if count > limit:
            raise RateLimitedError(
                "Too many requests. Please wait before trying again.",
                details={"retry_after": retry_after, "limit": limit, "window_seconds": window_s},
            )

    def reset(self) -> None:
        self._get_backend().reset()


rate_limiter = RateLimiter()

"""Structured logging with secret redaction.

Every log record passes through ``RedactingFilter`` which masks values that look like credentials
(bearer tokens, API keys, passwords, cookies, Fernet tokens) before any handler formats them.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

_SENSITIVE_KEYS = re.compile(
    r"(?i)(password|passwd|secret|token|api[_-]?key|authorization|cookie|set-cookie|private[_-]?key|client[_-]?secret)"
)
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"(?i)bearer\s+[a-z0-9\-._~+/]+=*"), "Bearer [REDACTED]"),
    (re.compile(r"(?i)\b(sk|pk|rk)-[a-z0-9\-_]{12,}"), "[REDACTED_KEY]"),
    (re.compile(r"\bgAAAAA[0-9A-Za-z_\-=]{20,}"), "[REDACTED_CIPHERTEXT]"),
    (re.compile(r"eyJ[0-9A-Za-z_\-]{8,}\.[0-9A-Za-z_\-]{8,}\.[0-9A-Za-z_\-]{8,}"), "[REDACTED_JWT]"),
    (
        re.compile(r"(?i)((?:password|secret|token|api[_-]?key|client_secret)[\"']?\s*[:=]\s*[\"']?)([^\"'\s,&}]+)"),
        r"\1[REDACTED]",
    ),
    (re.compile(r"(postgres(?:ql)?(?:\+\w+)?://[^:/\s]+:)([^@\s]+)(@)"), r"\1[REDACTED]\3"),
    # Invitation tokens travel in the URL path (GET /auth/invitations/{token}); keep them out of access logs.
    (re.compile(r"(/auth/invitations/)[^/\s?\"]+"), r"\1[REDACTED]"),
]


def redact_text(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_value(value: object, key: str | None = None) -> object:
    """Recursively redact a structure (dicts/lists/str). Keys that look sensitive are fully masked."""
    if key is not None and _SENSITIVE_KEYS.search(key):
        return "[REDACTED]"
    if isinstance(value, dict):
        return {k: redact_value(v, str(k)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [redact_value(v) for v in value]
    if isinstance(value, str):
        return redact_text(value)
    return value


class RedactingFilter(logging.Filter):
    """Mask secrets before any handler formats a record.

    uvicorn's access formatter unpacks ``record.args`` (client, method, path, version, status), so for those
    records each string argument is redacted in place and the tuple is kept. Every other record is formatted
    once and replaced by its redacted text.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if record.name == "uvicorn.access" and isinstance(record.args, tuple):
                record.args = tuple(redact_text(a) if isinstance(a, str) else a for a in record.args)
                return True
            message = record.getMessage()
        except Exception:  # noqa: BLE001 - never let logging crash the app
            return True
        record.msg = redact_text(message)
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for attr in ("request_id", "org_id", "user_id", "path", "status", "duration_ms"):
            if hasattr(record, attr):
                payload[attr] = getattr(record, attr)
        if record.exc_info:
            payload["exc"] = redact_text(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging(level: str = "INFO", json_output: bool = False) -> None:
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactingFilter())
    if json_output:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
    for noisy in ("uvicorn.access",):
        logging.getLogger(noisy).addFilter(RedactingFilter())

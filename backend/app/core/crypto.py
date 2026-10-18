"""Encryption of integration credentials at rest.

Credentials are serialised to JSON and encrypted with Fernet (AES-128-CBC + HMAC-SHA256).
The key comes from ``AUREX_SECRET_ENCRYPTION_KEY`` and never touches the database.
API responses only ever expose a masked fingerprint (see ``mask_secret``).
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


class SecretDecryptionError(RuntimeError):
    pass


def _fernet() -> Fernet:
    raw = get_settings().secret_encryption_key.get_secret_value().encode()
    try:
        return Fernet(raw)
    except ValueError:
        # Allow any passphrase by deriving a valid Fernet key from it (documented in SECURITY.md).
        derived = base64.urlsafe_b64encode(hashlib.sha256(raw).digest())
        return Fernet(derived)


def encrypt_secrets(values: dict[str, Any]) -> bytes:
    return _fernet().encrypt(json.dumps(values, sort_keys=True).encode())


def decrypt_secrets(ciphertext: bytes | None) -> dict[str, Any]:
    if not ciphertext:
        return {}
    try:
        return json.loads(_fernet().decrypt(bytes(ciphertext)).decode())
    except (InvalidToken, ValueError) as exc:
        raise SecretDecryptionError("Stored credentials could not be decrypted (key rotated or data corrupted)") from exc


def secret_fingerprint(values: dict[str, Any]) -> dict[str, str]:
    """Masked, non-reversible description of each stored credential field."""
    return {key: mask_secret(str(val)) for key, val in values.items() if val not in (None, "")}


def mask_secret(value: str) -> str:
    if len(value) <= 4:
        return "••••"
    return "••••" + value[-4:]

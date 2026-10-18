"""Local file storage for uploads, reports and model artifacts (configure a mounted volume in production)."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import BinaryIO

from app.core.config import get_settings


def _root(kind: str) -> Path:
    root = Path(get_settings().storage_dir) / kind
    root.mkdir(parents=True, exist_ok=True)
    return root


def store_upload(org_id: uuid.UUID, sha256: str, suffix: str, stream: BinaryIO) -> Path:
    folder = _root("uploads") / str(org_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{sha256}{suffix}"
    with path.open("wb") as handle:
        shutil.copyfileobj(stream, handle)
    return path


def report_path(org_id: uuid.UUID, report_id: uuid.UUID, extension: str) -> Path:
    folder = _root("reports") / str(org_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{report_id}.{extension}"


def model_artifact_path(org_id: uuid.UUID, model_id: uuid.UUID) -> Path:
    folder = _root("models") / str(org_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"{model_id}.joblib"

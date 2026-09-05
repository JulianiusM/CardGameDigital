"""Opaque secret references stored separately with best-effort owner-only permissions."""

from __future__ import annotations

import json
import threading
import uuid
from pathlib import Path
from typing import Optional

from .profile_store import StorageVersionError, atomic_json_write


MAX_SECRET_STORE_BYTES = 2 * 1024 * 1024
MAX_SECRET_ENTRIES = 100


class SecretStore:
    def __init__(self, profile_directory: str | Path) -> None:
        self.path = Path(profile_directory).resolve() / "secrets.json"
        self._lock = threading.RLock()

    def put(self, secret: str, reference: Optional[str] = None) -> str:
        if not secret or len(secret) > 16_384:
            raise ValueError("Secret length is invalid")
        key = reference or str(uuid.uuid4())
        with self._lock:
            values = self._load()
            values[key] = secret
            self._save(values)
        return key

    def get(self, reference: str) -> Optional[str]:
        with self._lock:
            return self._load().get(reference)

    def delete(self, reference: str) -> None:
        with self._lock:
            values = self._load()
            if reference in values:
                del values[reference]
                self._save(values)

    def clear(self) -> None:
        with self._lock:
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass

    def _load(self) -> dict[str, str]:
        try:
            with self.path.open("r", encoding="utf-8") as handle:
                raw = handle.read(MAX_SECRET_STORE_BYTES + 1)
            if len(raw.encode("utf-8")) > MAX_SECRET_STORE_BYTES:
                raise StorageVersionError("Secret store exceeds its size limit")
            value = json.loads(raw)
        except FileNotFoundError:
            return {}
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise StorageVersionError("Secret store is unreadable") from error
        if not isinstance(value, dict) or value.get("schemaVersion") != 1:
            raise StorageVersionError("Secret store version is unsupported")
        values = value.get("values")
        if (
            not isinstance(values, dict)
            or len(values) > MAX_SECRET_ENTRIES
            or not all(
                isinstance(key, str)
                and 1 <= len(key) <= 200
                and isinstance(secret, str)
                and 1 <= len(secret) <= 16_384
                for key, secret in values.items()
            )
        ):
            raise StorageVersionError("Secret store content is invalid")
        return dict(values)

    def _save(self, values: dict[str, str]) -> None:
        atomic_json_write(self.path, {"schemaVersion": 1, "values": values})

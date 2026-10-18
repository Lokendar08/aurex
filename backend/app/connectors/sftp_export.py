"""SFTP drop-folder connector for approved scheduled exports (CSV / Excel).

This is the activation path recommended for POS/ERP vendors that publish no API (see
``docs/INTEGRATIONS.md``): the retailer authorizes an export, the vendor or the retailer's IT writes files
to an SFTP folder, and AUREX polls that folder on the integration's schedule.

Security
- The server host key is pinned. ``host_key_fingerprint`` (``SHA256:...`` exactly as printed by
  ``ssh-keygen -lf``) is required and the session is refused on any mismatch: no trust-on-first-use.
- Authentication uses a private key (preferred) or a password; both are stored encrypted as integration
  secrets and never returned by the API.
- The host must resolve to a public address unless private-network connectors are enabled by the operator.
- Read-only: files are listed and downloaded. Nothing is written, renamed or deleted on the server.
- Files larger than ``AUREX_MAX_UPLOAD_MB`` are skipped and reported in the sync job.

Configuration (``Integration.config``)
- ``host``, ``port`` (default 22), ``username``, ``host_key_fingerprint``, ``remote_dir``
- ``files``: ordered rules ``[{"pattern": "sales_*.csv", "entity": "sales", "column_mapping": {...},
  "delimiter": ",", "sheet_name": "Sheet1"}]``. Glob patterns are matched against file names in
  ``remote_dir``; the first matching rule decides a file's record type.
- ``date_format``: strftime format for non-ISO dates in every file (ambiguous dates are never guessed).

Incremental imports: each entity's cursor records the name, size and modification time of every processed
file, so unchanged files are not downloaded again. A re-exported (changed) file is processed again and its
rows are upserted by source record id, so overlapping exports never create duplicates.
"""

from __future__ import annotations

import base64
import fnmatch
import hashlib
import io
import re
import socket
import stat
import tempfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, ClassVar, Protocol

from app.connectors.base import (
    BaseConnector,
    Batch,
    ConfigField,
    ConnectorConfigurationError,
    ConnectorError,
    ProviderSpec,
    TestResult,
    TransientConnectorError,
    validate_outbound_host,
)
from app.connectors.file_import import apply_mapping, read_table
from app.core.config import get_settings
from app.pipeline.entities import DIMENSION_ORDER, ENTITIES, FACT_ORDER

MAX_TRACKED_FILES = 2000
SUPPORTED_SUFFIXES = (".csv", ".txt", ".xlsx", ".xlsm")


class RemoteFile(Protocol):
    filename: str
    st_size: int | None
    st_mtime: int | float | None
    st_mode: int | None


class SftpSession(Protocol):
    def listdir_attr(self, path: str = ".") -> list[RemoteFile]: ...
    def getfo(self, remotepath: str, fl: Any) -> Any: ...
    def close(self) -> None: ...


@dataclass(frozen=True)
class FileRule:
    pattern: str
    entity: str
    column_mapping: dict[str, str] | None = None
    delimiter: str | None = None
    sheet_name: str | None = None


def fingerprint_of(key_blob: bytes) -> str:
    """OpenSSH SHA256 fingerprint of a public host key blob (``ssh-keygen -lf`` format)."""
    return "SHA256:" + base64.b64encode(hashlib.sha256(key_blob).digest()).decode().rstrip("=")


def _normalize_fingerprint(value: Any) -> str:
    text = str(value or "").strip()
    if not text.startswith("SHA256:") or len(text) < 20:
        raise ConnectorConfigurationError("host_key_fingerprint must be the server's SHA256:... host key fingerprint")
    return text


class _ParamikoSession:
    def __init__(self, transport: Any, client: Any) -> None:
        self._transport, self._client = transport, client

    def listdir_attr(self, path: str = ".") -> list[RemoteFile]:
        return self._client.listdir_attr(path)

    def getfo(self, remotepath: str, fl: Any) -> Any:
        return self._client.getfo(remotepath, fl)

    def close(self) -> None:
        try:
            self._client.close()
        finally:
            self._transport.close()


_PEM = re.compile(r"(-----BEGIN [A-Z0-9 ]+-----)(.*?)(-----END [A-Z0-9 ]+-----)", re.S)


def normalize_private_key(text: str) -> str:
    """Restore the line structure of a pasted private key.

    Single-line form fields (and some secret stores) strip the newlines of a PEM/OpenSSH key, which the key
    parser needs. The body is base64, so whitespace can be removed and the body re-wrapped safely. Keys with
    PEM headers (``Proc-Type``/``DEK-Info``, legacy encrypted PEM) are returned unchanged.
    """
    text = (text or "").strip().replace("\r\n", "\n")
    match = _PEM.search(text)
    if not match or ":" in match.group(2):
        return text + "\n" if text else text
    body = re.sub(r"\s+", "", match.group(2))
    lines = [body[i:i + 70] for i in range(0, len(body), 70)]
    return "\n".join([match.group(1), *lines, match.group(3)]) + "\n"


def _load_private_key(text: str, passphrase: str | None) -> Any:
    import paramiko

    text = normalize_private_key(text)
    last: Exception | None = None
    for cls in (getattr(paramiko, n) for n in ("Ed25519Key", "ECDSAKey", "RSAKey") if hasattr(paramiko, n)):
        try:
            return cls.from_private_key(io.StringIO(text), password=passphrase or None)
        except (paramiko.SSHException, ValueError) as exc:
            last = exc
    raise ConnectorConfigurationError(f"Private key could not be loaded ({type(last).__name__ if last else 'unknown'})")


class SftpExportConnector(BaseConnector):
    spec = ProviderSpec(
        key="sftp_export",
        name="SFTP export folder",
        categories=("pos", "erp", "inventory", "accounting", "workforce"),
        methods=("approved_export", "sftp"),
        summary="Poll an SFTP folder for approved, scheduled CSV/Excel exports: the recommended path for POS/ERP "
                "vendors without a public API. Host key pinned, read-only, incremental by file.",
        availability="available",
        auth_type="ssh_key_or_password",
        supported_entities=tuple(DIMENSION_ORDER + FACT_ORDER),
        config_fields=(
            ConfigField("host", "SFTP host", required=True),
            ConfigField("port", "Port (default 22)", "integer"),
            ConfigField("username", "Username", required=True),
            ConfigField("host_key_fingerprint", "Server host key fingerprint (SHA256:…)", required=True,
                        help="Obtain it from the server operator out of band (ssh-keygen -lf <host key>.pub). "
                             "Connections are refused if the server presents a different key."),
            ConfigField("remote_dir", "Remote directory", required=True),
            ConfigField("files", "File rules: pattern → record type (+ optional mapping)", "json", True,
                        help='e.g. [{"pattern": "sales_*.csv", "entity": "sales"}]'),
            ConfigField("private_key", "Private key (OpenSSH / PEM)", "password", secret=True),
            ConfigField("private_key_passphrase", "Private key passphrase", "password", secret=True),
            ConfigField("password", "Password (if no key)", "password", secret=True),
        ),
        activation_requirements=(
            "Written authorization from the retailer for the export (data-sharing agreement).",
            "The vendor or retailer IT schedules the export to an SFTP folder AUREX can reach.",
            "SFTP account (key-based preferred) with read access to that folder only; AUREX egress IPs allow-listed.",
            "The server's SHA256 host key fingerprint, supplied out of band.",
            "File layout per record type (column names, date format), mapped in the file rules.",
        ),
    )

    # Tests inject a factory returning an in-memory session; production uses paramiko.
    session_factory: ClassVar[Callable[[SftpExportConnector], SftpSession] | None] = None

    # -- configuration -----------------------------------------------------------------------
    def rules(self) -> list[FileRule]:
        raw = self.config.get("files")
        if not isinstance(raw, list) or not raw:
            raise ConnectorConfigurationError("Configure at least one file rule (pattern → record type)")
        rules = []
        for item in raw:
            if not isinstance(item, dict) or not item.get("pattern") or not item.get("entity"):
                raise ConnectorConfigurationError("Each file rule needs a 'pattern' and an 'entity'")
            if item["entity"] not in ENTITIES:
                raise ConnectorConfigurationError(f"Unknown record type in file rules: {item['entity']}")
            if "/" in str(item["pattern"]) or "\\" in str(item["pattern"]):
                raise ConnectorConfigurationError("File patterns match names inside remote_dir; no path separators")
            rules.append(FileRule(pattern=str(item["pattern"]), entity=str(item["entity"]),
                                  column_mapping=item.get("column_mapping") or None,
                                  delimiter=item.get("delimiter") or None, sheet_name=item.get("sheet_name") or None))
        return rules

    def entities_for_sync(self) -> list[str]:
        try:
            rules = self.rules()
        except ConnectorConfigurationError:
            return []
        return list(dict.fromkeys(r.entity for r in rules))

    def _remote_dir(self) -> str:
        remote = str(self.config.get("remote_dir") or "").strip()
        if not remote:
            raise ConnectorConfigurationError("remote_dir is required")
        return remote

    # -- connection --------------------------------------------------------------------------
    def _open(self) -> SftpSession:
        factory = type(self).session_factory
        if factory is not None:
            return factory(self)
        import paramiko

        host = str(self.config.get("host") or "").strip()
        username = str(self.config.get("username") or "").strip()
        if not host or not username:
            raise ConnectorConfigurationError("Missing host or username")
        expected = _normalize_fingerprint(self.config.get("host_key_fingerprint"))
        if not (self.secrets.get("private_key") or self.secrets.get("password")):
            raise ConnectorConfigurationError("A private key or password is required")
        validate_outbound_host(host, require_https=False)
        port = int(self.config.get("port") or 22)
        timeout = float(self.config.get("timeout_seconds", 20))
        try:
            sock = socket.create_connection((host, port), timeout=timeout)
        except OSError as exc:
            raise TransientConnectorError(f"Could not reach {host}:{port} ({type(exc).__name__})") from exc
        transport = paramiko.Transport(sock)
        try:
            transport.start_client(timeout=timeout)
            presented = fingerprint_of(transport.get_remote_server_key().asbytes())
            if presented != expected:
                raise ConnectorConfigurationError(
                    f"Host key mismatch: the server presented {presented}; refusing to connect")
            if self.secrets.get("private_key"):
                transport.auth_publickey(username, _load_private_key(self.secrets["private_key"],
                                                                     self.secrets.get("private_key_passphrase")))
            else:
                transport.auth_password(username, self.secrets["password"])
            if not transport.is_authenticated():
                raise ConnectorConfigurationError("Authentication failed")
            return _ParamikoSession(transport, paramiko.SFTPClient.from_transport(transport))
        except paramiko.AuthenticationException as exc:
            transport.close()
            raise ConnectorConfigurationError("Authentication failed") from exc
        except paramiko.SSHException as exc:
            transport.close()
            raise TransientConnectorError(f"SSH negotiation failed ({type(exc).__name__})") from exc
        except BaseException:
            transport.close()
            raise

    def _listing(self, session: SftpSession) -> list[RemoteFile]:
        try:
            entries = session.listdir_attr(self._remote_dir())
        except OSError as exc:
            raise ConnectorConfigurationError(f"Cannot list {self._remote_dir()} ({type(exc).__name__})") from exc
        files = [e for e in entries if not (e.st_mode is not None and stat.S_ISDIR(e.st_mode))]
        return sorted(files, key=lambda e: (e.st_mtime or 0, e.filename))

    def _rule_for(self, name: str, rules: list[FileRule]) -> FileRule | None:
        if not name.lower().endswith(SUPPORTED_SUFFIXES):
            return None
        return next((r for r in rules if fnmatch.fnmatchcase(name, r.pattern)), None)

    # -- contract ----------------------------------------------------------------------------
    def test_connection(self) -> TestResult:
        missing = self.missing_settings()
        if missing:
            return TestResult(False, "awaiting_credentials", f"Missing configuration: {', '.join(missing)}")
        if not (self.secrets.get("private_key") or self.secrets.get("password")):
            return TestResult(False, "awaiting_credentials", "Provide a private key or a password")
        try:
            rules = self.rules()
            session = self._open()
            try:
                listing = self._listing(session)
            finally:
                session.close()
        except ConnectorConfigurationError as exc:
            return TestResult(False, "error", str(exc))
        except ConnectorError as exc:
            return TestResult(False, "error", str(exc))
        matching = [f for f in listing if self._rule_for(f.filename, rules)]
        return TestResult(
            True, "connected",
            f"Host key verified and authenticated; {len(matching)} matching file(s) in {self._remote_dir()}",
            checks=[{"name": "host_key_pinned", "ok": True}, {"name": "authenticated", "ok": True},
                    {"name": "list_remote_dir", "ok": True, "files": len(listing), "matching": len(matching)}])

    def fetch(self, entity: str, cursor: dict[str, Any] | None) -> Iterator[Batch]:
        rules = self.rules()
        processed: dict[str, str] = dict((cursor or {}).get("files") or {})
        max_bytes = get_settings().max_upload_mb * 1024 * 1024
        session = self._open()
        try:
            for remote in self._listing(session):
                rule = self._rule_for(remote.filename, rules)
                if rule is None or rule.entity != entity:
                    continue
                marker = f"{remote.st_size}:{int(remote.st_mtime or 0)}"
                if processed.get(remote.filename) == marker:
                    continue
                if remote.st_size is not None and remote.st_size > max_bytes:
                    raise ConnectorError(f"{remote.filename} exceeds {get_settings().max_upload_mb} MB; "
                                         "split the export or raise AUREX_MAX_UPLOAD_MB")
                yield from self._read_remote(session, remote, rule, processed, marker)
        finally:
            session.close()

    def _read_remote(self, session: SftpSession, remote: RemoteFile, rule: FileRule, processed: dict[str, str],
                     marker: str) -> Iterator[Batch]:
        path = str(PurePosixPath(self._remote_dir()) / remote.filename)
        suffix = Path(remote.filename).suffix.lower()
        with tempfile.TemporaryDirectory(prefix="aurex-sftp-") as tmp:
            local = Path(tmp) / f"download{'.csv' if suffix == '.txt' else suffix}"
            with local.open("wb") as handle:
                session.getfo(path, handle)
            digest = hashlib.sha256(local.read_bytes()).hexdigest()
            chunks = [c for c in read_table(local, delimiter=rule.delimiter, sheet_name=rule.sheet_name) if len(c)]
        # An empty export yields nothing (and is simply listed again next time).
        for index, chunk in enumerate(chunks):
            last = index == len(chunks) - 1
            after = None
            if last:
                processed[remote.filename] = marker
                if len(processed) > MAX_TRACKED_FILES:
                    for name in list(processed)[: len(processed) - MAX_TRACKED_FILES]:
                        processed.pop(name)
                after = {"files": dict(processed), "last_file": remote.filename, "last_sha256": digest}
            yield Batch(entity=rule.entity, frame=apply_mapping(chunk, rule.column_mapping, rule.entity),
                        cursor_after=after, note=f"{remote.filename} (sha256 {digest[:12]}…)")

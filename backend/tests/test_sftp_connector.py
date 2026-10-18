"""SFTP export connector against a real in-process SSH/SFTP server (paramiko): host-key pinning,
authentication, connection status honesty, incremental file processing and duplicate prevention."""

from __future__ import annotations

import os
import socket
import threading
import time
from collections.abc import Iterator
from pathlib import Path

import paramiko
import pytest
from sqlalchemy import func, select

from app.connectors.sftp_export import fingerprint_of
from app.db.session import session_scope
from app.models import StoreTraffic

USERNAME, PASSWORD = "aurex-export", "correct-horse-battery"


class _Server(paramiko.ServerInterface):
    def __init__(self, root: Path) -> None:
        self.root = root

    def check_auth_password(self, username: str, password: str) -> int:
        ok = (username, password) == (USERNAME, PASSWORD)
        return paramiko.AUTH_SUCCESSFUL if ok else paramiko.AUTH_FAILED

    def get_allowed_auths(self, username: str) -> str:
        return "password"

    def check_channel_request(self, kind: str, chanid: int) -> int:
        return paramiko.OPEN_SUCCEEDED if kind == "session" else paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED


class _Handle(paramiko.SFTPHandle):
    def stat(self):  # type: ignore[no-untyped-def]
        return paramiko.SFTPAttributes.from_stat(os.fstat(self.readfile.fileno()))


class _ReadOnlySFTP(paramiko.SFTPServerInterface):
    def __init__(self, server: _Server, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        super().__init__(server, *args, **kwargs)
        self.root = server.root

    def _real(self, path: str) -> Path:
        candidate = (self.root / path.lstrip("/")).resolve()
        if self.root.resolve() not in (candidate, *candidate.parents):
            raise PermissionError(path)
        return candidate

    def list_folder(self, path):  # type: ignore[no-untyped-def]
        out = []
        for entry in sorted(self._real(path).iterdir()):
            attr = paramiko.SFTPAttributes.from_stat(entry.stat())
            attr.filename = entry.name
            out.append(attr)
        return out

    def stat(self, path):  # type: ignore[no-untyped-def]
        return paramiko.SFTPAttributes.from_stat(self._real(path).stat())

    lstat = stat

    def open(self, path, flags, attr):  # type: ignore[no-untyped-def]
        if flags & (os.O_WRONLY | os.O_RDWR):
            return paramiko.SFTP_PERMISSION_DENIED
        handle = _Handle(flags)
        handle.filename = str(self._real(path))
        handle.readfile = open(handle.filename, "rb")  # noqa: SIM115 - closed by SFTPHandle.close
        return handle


@pytest.fixture()
def sftp_server(tmp_path: Path) -> Iterator[dict]:
    root = tmp_path / "srv"
    (root / "exports").mkdir(parents=True)
    host_key = paramiko.ECDSAKey.generate()
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(5)
    transports: list[paramiko.Transport] = []

    def serve() -> None:
        while True:
            try:
                conn, _ = listener.accept()
            except OSError:
                return
            transport = paramiko.Transport(conn)
            transport.add_server_key(host_key)
            transport.set_subsystem_handler("sftp", paramiko.SFTPServer, _ReadOnlySFTP)
            transport.start_server(server=_Server(root))
            transports.append(transport)

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield {"port": listener.getsockname()[1], "dir": root / "exports",
               "fingerprint": fingerprint_of(host_key.asbytes())}
    finally:
        listener.close()
        for transport in transports:
            transport.close()


def _integration(owner, server: dict, *, fingerprint: str | None = None, password: str = PASSWORD) -> dict:  # type: ignore[no-untyped-def]
    company_id = owner.get("/companies").json()["companies"][0]["id"]
    owner.post("/stores", json={"company_id": company_id, "code": "ST1", "name": "Store One"})
    response = owner.post("/integrations", json={
        "provider_key": "sftp_export", "display_name": f"Vendor export {time.time_ns()}",
        "config": {"host": "127.0.0.1", "port": server["port"], "username": USERNAME,
                   "host_key_fingerprint": fingerprint or server["fingerprint"], "remote_dir": "/exports",
                   "files": [{"pattern": "traffic_*.csv", "entity": "traffic"}]},
        "credentials": {"password": password}})
    assert response.status_code == 201, response.text
    return response.json()


# The stub server's transport thread sees the client drop the connection after rejecting the host key.
@pytest.mark.filterwarnings("ignore::pytest.PytestUnhandledThreadExceptionWarning")
def test_sftp_refuses_unpinned_host_key_and_never_reports_connected(new_org, sftp_server) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    wrong = "SHA256:" + "A" * 43
    created = _integration(owner, sftp_server, fingerprint=wrong)
    assert created["status"] != "connected"
    tested = owner.post(f"/integrations/{created['id']}/test").json()
    assert tested["result"]["ok"] is False and "Host key mismatch" in tested["result"]["message"]
    assert owner.get(f"/integrations/{created['id']}").json()["status"] == "error"
    assert owner.post(f"/integrations/{created['id']}/sync").status_code == 409


def test_sftp_wrong_password_is_an_error(new_org, sftp_server) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    created = _integration(owner, sftp_server, password="not-the-password")
    tested = owner.post(f"/integrations/{created['id']}/test").json()
    assert tested["result"]["ok"] is False and "Authentication failed" in tested["result"]["message"]


def test_sftp_incremental_files_without_duplicates(new_org, sftp_server) -> None:  # type: ignore[no-untyped-def]
    owner = new_org()
    export = sftp_server["dir"] / "traffic_2026-09.csv"
    export.write_text("store_code,business_date,transaction_count\nST1,2026-09-01,120\nST1,2026-09-02,95\n",
                      encoding="utf-8")
    (sftp_server["dir"] / "readme.txt").write_text("not an export", encoding="utf-8")  # matches no rule
    created = _integration(owner, sftp_server)
    tested = owner.post(f"/integrations/{created['id']}/test").json()
    assert tested["result"]["status"] == "connected", tested
    assert "1 matching file" in tested["result"]["message"]

    first = owner.get(f"/sync-jobs/{owner.post(f'/integrations/{created['id']}/sync').json()['id']}").json()
    assert first["status"] == "succeeded" and first["records"]["inserted"] == 2

    # Unchanged file: not downloaded again
    second = owner.get(f"/sync-jobs/{owner.post(f'/integrations/{created['id']}/sync').json()['id']}").json()
    assert second["status"] == "succeeded" and second["records"]["received"] == 0

    # Re-exported file (one corrected value, one new day): upserted by natural key, never duplicated
    export.write_text("store_code,business_date,transaction_count\nST1,2026-09-01,120\nST1,2026-09-02,97\n"
                      "ST1,2026-09-03,101\n", encoding="utf-8")
    later = time.time() + 30
    os.utime(export, (later, later))
    third = owner.get(f"/sync-jobs/{owner.post(f'/integrations/{created['id']}/sync').json()['id']}").json()
    assert third["records"]["inserted"] == 1 and third["records"]["updated"] == 1
    assert third["records"]["unchanged"] == 1
    with session_scope() as db:
        rows = db.scalar(select(func.count()).select_from(StoreTraffic)
                         .where(StoreTraffic.integration_id == created["id"]))
    assert rows == 3


def test_private_key_pasted_without_line_breaks_still_loads() -> None:
    import io

    from app.connectors.sftp_export import _load_private_key

    key = paramiko.ECDSAKey.generate()
    buffer = io.StringIO()
    key.write_private_key(buffer)
    flattened = buffer.getvalue().replace("\n", "")  # what a single-line form field submits
    loaded = _load_private_key(flattened, None)
    assert loaded.asbytes() == key.asbytes()

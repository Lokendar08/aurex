"""Local development PostgreSQL manager (Windows/macOS/Linux).

Uses the portable PostgreSQL 17 binaries installed under ``.devtools/pg`` (npm package
``@embedded-postgres/<platform>``) or any ``initdb``/``pg_ctl`` found on PATH. Production and Docker
use the official ``postgres:17`` image instead; this script is for local development and tests only.

Usage:  python scripts/devdb.py init|start|stop|status|create-dbs|reset-test
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / ".devtools" / "pgdata"
LOG_FILE = ROOT / ".devtools" / "postgres.log"
PORT = int(os.environ.get("AUREX_DEV_PG_PORT", "5433"))
USER = "aurex"
PASSWORD = "aurex"  # development only; production credentials come from the environment
DATABASES = ["aurex", "aurex_test"]


def _bin_dir() -> Path | None:
    system = platform.system().lower()
    pkg = {"windows": "windows-x64", "darwin": "darwin-arm64" if platform.machine() == "arm64" else "darwin-x64"}.get(
        system, "linux-x64"
    )
    candidate = ROOT / ".devtools" / "pg" / "node_modules" / "@embedded-postgres" / pkg / "native" / "bin"
    if candidate.exists():
        return candidate
    found = shutil.which("pg_ctl")
    return Path(found).parent if found else None


def _exe(name: str) -> str:
    bin_dir = _bin_dir()
    if bin_dir is None:
        sys.exit("PostgreSQL binaries not found. Run: cd .devtools/pg && npm install")
    suffix = ".exe" if platform.system() == "Windows" else ""
    return str(bin_dir / f"{name}{suffix}")


def init() -> None:
    if (DATA_DIR / "PG_VERSION").exists():
        print(f"Cluster already initialised at {DATA_DIR}")
        return
    DATA_DIR.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".pw") as handle:
        handle.write(PASSWORD)
        pwfile = handle.name
    try:
        subprocess.run(
            [_exe("initdb"), "-D", str(DATA_DIR), "-U", USER, "-A", "scram-sha-256", f"--pwfile={pwfile}",
             "-E", "UTF8", "--no-locale"],
            check=True,
        )
    finally:
        os.unlink(pwfile)
    print("Initialised cluster")


def start() -> None:
    init()
    if status(quiet=True):
        print(f"PostgreSQL already running on port {PORT}")
        return
    # Detach fully: the server must not inherit this process's stdio handles, otherwise callers that
    # wait for EOF on stdout (CI shells, IDE terminals) hang until PostgreSQL exits.
    flags = 0
    if platform.system() == "Windows":
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS  # type: ignore[attr-defined]
    subprocess.run(
        [_exe("pg_ctl"), "-D", str(DATA_DIR), "-l", str(LOG_FILE), "-o", f"-p {PORT} -c listen_addresses=127.0.0.1",
         "-w", "-t", "60", "start"],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )
    print(f"PostgreSQL started on 127.0.0.1:{PORT}")


def stop() -> None:
    subprocess.run([_exe("pg_ctl"), "-D", str(DATA_DIR), "-m", "fast", "stop"], check=False)


def status(quiet: bool = False) -> bool:
    result = subprocess.run([_exe("pg_ctl"), "-D", str(DATA_DIR), "status"], capture_output=True, text=True)
    running = result.returncode == 0
    if not quiet:
        print(result.stdout.strip() or result.stderr.strip())
    return running


def _connect(dbname: str = "postgres"):
    import psycopg

    return psycopg.connect(host="127.0.0.1", port=PORT, user=USER, password=PASSWORD, dbname=dbname, autocommit=True)


def create_dbs() -> None:
    with _connect() as conn:
        existing = {row[0] for row in conn.execute("SELECT datname FROM pg_database")}
        for name in DATABASES:
            if name not in existing:
                conn.execute(f'CREATE DATABASE "{name}"')
                print(f"Created database {name}")
            else:
                print(f"Database {name} exists")
    for name in DATABASES:
        with _connect(name) as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
            conn.execute("CREATE EXTENSION IF NOT EXISTS citext")


def reset_test() -> None:
    with _connect() as conn:
        conn.execute("DROP DATABASE IF EXISTS aurex_test WITH (FORCE)")
        conn.execute('CREATE DATABASE "aurex_test"')
    with _connect("aurex_test") as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        conn.execute("CREATE EXTENSION IF NOT EXISTS citext")
    print("Reset aurex_test")


COMMANDS = {"init": init, "start": start, "stop": stop, "status": status, "create-dbs": create_dbs,
            "reset-test": reset_test}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    COMMANDS[sys.argv[1]]()

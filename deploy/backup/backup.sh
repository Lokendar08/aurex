#!/bin/sh
# Periodic backups for AUREX (runs in the `backup` compose service, postgres:17-alpine image).
#  - PostgreSQL: pg_dump custom format (restore with restore.sh / pg_restore), with a SHA-256 checksum
#  - File storage (uploaded files, generated reports): tar.gz of /data/storage (mounted read-only)
# Retention: files older than BACKUP_RETENTION_DAYS are deleted. Copy /backups off the host as well
# (object storage, another region): a backup on the same disk does not survive the loss of that disk.
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p /backups

while true; do
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  dump="/backups/aurex-db-${ts}.dump"
  if pg_dump --format=custom --no-owner --file="${dump}.partial"; then
    mv "${dump}.partial" "${dump}"
    (cd /backups && sha256sum "$(basename "${dump}")" > "$(basename "${dump}").sha256")
    echo "$(date -u +%FT%TZ) database backup ok: ${dump}"
  else
    rm -f "${dump}.partial"
    echo "$(date -u +%FT%TZ) database backup FAILED" >&2
  fi

  files="/backups/aurex-files-${ts}.tar.gz"
  if [ -d /data/storage ] && tar -czf "${files}.partial" -C /data storage 2>/dev/null; then
    mv "${files}.partial" "${files}"
    echo "$(date -u +%FT%TZ) file storage backup ok: ${files}"
  else
    rm -f "${files}.partial"
  fi

  find /backups -maxdepth 1 -name 'aurex-*' -mtime "+${RETENTION}" -delete
  sleep "${INTERVAL}"
done

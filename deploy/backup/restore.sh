#!/bin/sh
# Restore an AUREX database backup produced by backup.sh.
#
#   docker compose stop api worker beat web
#   docker compose run --rm --entrypoint /bin/sh backup /backup/restore.sh /backups/aurex-db-<timestamp>.dump
#   docker compose up -d          # `migrate` brings the schema to the current version before the API starts
#
# Restore file storage (uploads/reports) the same way if needed:
#   docker compose run --rm --entrypoint /bin/sh -v aurex_storage:/restore backup \
#     -c 'tar -xzf /backups/aurex-files-<timestamp>.tar.gz -C /restore --strip-components=1'
set -eu

dump="${1:?usage: restore.sh /backups/aurex-db-<timestamp>.dump}"
if [ -f "${dump}.sha256" ]; then
  (cd "$(dirname "${dump}")" && sha256sum -c "$(basename "${dump}").sha256")
fi
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="${PGDATABASE}" "${dump}"
echo "restored ${dump} into ${PGDATABASE}"

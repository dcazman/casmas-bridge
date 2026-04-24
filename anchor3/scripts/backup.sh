#!/bin/bash
# Encrypt anchor3 DB and commit to git
# Add to OMV cron: 0 3 * * * /srv/mergerfs/warehouse/casmas-bridge/anchor3/scripts/backup.sh
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass env:ENCRYPTION_KEY \
#     -in anchor3/backup.sql.enc | sqlite3 /srv/mergerfs/warehouse/anchor3/data/notes3.db

set -euo pipefail

REPO=/srv/mergerfs/warehouse/casmas-bridge
DB=/srv/mergerfs/warehouse/anchor3/data/notes3.db
OUT=$REPO/anchor3/backup.sql.enc

ENCRYPTION_KEY=$(docker exec anchor3 printenv ENCRYPTION_KEY)
export ENCRYPTION_KEY

docker exec anchor3 sqlite3 /data/notes3.db .dump \
  | openssl enc -aes-256-cbc -pbkdf2 -pass env:ENCRYPTION_KEY -out "$OUT"

cd "$REPO"
git add anchor3/backup.sql.enc
if ! git diff --staged --quiet; then
  git commit -m "backup: $(date -u +%Y-%m-%dT%H:%M)"
  git push
fi

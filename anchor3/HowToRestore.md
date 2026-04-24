# Anchor 3 — DB Restore Guide

The nightly backup runs at 3am and writes `anchor3/backup.sql.enc` to this repo.
It is the raw SQLite file (`notes3.db`) encrypted with AES-256-CBC using the app's `ENCRYPTION_KEY`.

---

## What you need

- The `ENCRYPTION_KEY` value from the running container (or from wherever you stored it)
- SSH access to OMV at `192.168.50.23`
- The backup file: `anchor3/backup.sql.enc` in this repo

---

## Step 1 — Get your ENCRYPTION_KEY

If the container is still running:

```bash
docker exec anchor3 printenv ENCRYPTION_KEY
```

Copy the output — you'll need it in Step 3.

If the container is gone, retrieve it from wherever you originally set it (OMV environment, docker-compose override, secrets manager, etc.).

---

## Step 2 — Stop the container

Always stop Anchor 3 before overwriting the DB to avoid corruption.

```bash
docker stop anchor3
```

---

## Step 3 — Decrypt and restore

```bash
export ENCRYPTION_KEY=<paste key here>

openssl enc -d -aes-256-cbc -pbkdf2 \
  -pass env:ENCRYPTION_KEY \
  -in /srv/mergerfs/warehouse/casmas-bridge/anchor3/backup.sql.enc \
  -out /srv/mergerfs/warehouse/anchor3/data/notes3.db
```

This overwrites the live DB with the backup. The data directory is at `/srv/mergerfs/warehouse/anchor3/data/`.

---

## Step 4 — Restart the container

```bash
cd /srv/mergerfs/warehouse/casmas-bridge/anchor3
docker compose up -d
```

---

## Step 5 — Verify

Open Anchor 3 in the browser at `http://192.168.50.23:1234` and confirm your notes are there.

---

## Backup details

| Item | Value |
|------|-------|
| Backup file | `anchor3/backup.sql.enc` (in casmas-bridge repo) |
| Schedule | Daily at 3:00 AM UTC (OMV cron) |
| Script | `anchor3/scripts/backup.sh` |
| Encryption | AES-256-CBC, PBKDF2, key = `ENCRYPTION_KEY` env var |
| Committed by | OMV root, pushed to `dcazman/casmas-bridge` on GitHub |

---

## If the worst happens (container AND OMV gone)

1. Clone the repo on any machine that has `openssl` installed
2. Set `ENCRYPTION_KEY` from your records
3. Run the Step 3 decrypt command pointing `-out` at wherever you want the DB
4. Rebuild the stack from `anchor3/docker-compose.yml` with the DB mounted at `/data`

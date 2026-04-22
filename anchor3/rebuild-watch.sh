#!/bin/bash
TRIGGER=/srv/mergerfs/warehouse/anchor3/data/rebuild-trigger
COMPOSE_DIR=/srv/mergerfs/warehouse/anchor3
LOG=/srv/mergerfs/warehouse/anchor3/data/rebuild.log

if [ -f "$TRIGGER" ]; then
  rm -f "$TRIGGER"
  echo "[$(date)] Rebuild triggered" >> "$LOG"
  cd "$COMPOSE_DIR"
  docker-compose up --build -d >> "$LOG" 2>&1
  echo "[$(date)] Rebuild complete" >> "$LOG"
fi

# casmas-bridge — Repo Structure
Last updated: April 6, 2026

## Directory Layout

```
casmas-bridge/
  anchor/           ← Anchor 2.0 source (SOURCE OF TRUTH)
    server.js       ← entry point only
    start.sh        ← "Starting Anchor 2.0..."
    Dockerfile      ← copies lib/, routes/, assets/
    package.json    ← v3.0.0
    lib/            ← crypto.js, db.js, email.js, helpers.js, usage.js
    routes/         ← notes.js, sync.js, chat.js, bridge.js, mcp.js, ui.js
    assets/         ← anchor-icon.png, anchor-logo.png

  anchor-mcp/       ← anchor-mcp source (SOURCE OF TRUTH)
    mcp-server.js
    package.json
    Dockerfile

  md/               ← session handoff files
    work-claude-handoff.md   ← Work Claude reads this at session start
    ollama-system-prompt.md  ← Ollama local AI system prompt
    session-latest.md        ← most recent session summary (if exists)

  archive/          ← old backups
    v2.1-server.js  ← single-file restore point before modular refactor
    v2.1-readme.md

## Production Locations (OMV server)

  /srv/mergerfs/warehouse/anchor/       ← production anchor (Docker builds here)
  /srv/mergerfs/warehouse/anchor-mcp/   ← production anchor-mcp (Docker builds here)
  /srv/mergerfs/warehouse/casmas-bridge/ ← this repo (git clone)

## Update Workflow

For anchor source changes:
  1. Edit in casmas-bridge/anchor/ via write_file MCP tool
  2. git_commit_push
  3. cp file from casmas-bridge to /srv/mergerfs/warehouse/anchor/
  4. docker cp to container OR docker restart anchor

Full rebuild only needed when Dockerfile or package.json changes:
  cd /srv/mergerfs/warehouse/anchor
  docker compose down && docker compose build --no-cache && docker compose up -d

## Important Notes

- anchor and anchor-mcp do NOT use Docker Hub — local builds only, no Watchtower
- anchor runs outside OMV GUI via plain docker compose
- anchor-mcp runs outside OMV GUI via plain docker compose
- Bridge volume: casmas-bridge repo is mounted at /bridge inside anchor container
- Data: /srv/mergerfs/warehouse/anchor/data/notes.db (encrypted SQLite)
- Config: /srv/mergerfs/warehouse/anchor/.env
```

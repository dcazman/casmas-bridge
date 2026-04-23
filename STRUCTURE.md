# casmas-bridge — Repo Structure
Last updated: April 22, 2026

## Directory Layout

```
casmas-bridge/
  anchor3/         ← Anchor 3 source (LIVE — Preact/Vite + Express)
    server.js       ← Express entry point
    Dockerfile      ← Node 20 Alpine, Vite build included
    docker-compose.yml
    package.json
    client/         ← Preact/Vite frontend
      src/
        main.jsx    ← Preact entry, scroll restoration
        App.jsx     ← Root component, state management
        helpers.js  ← TYPE_GROUPS, COLORS, isLocal(), fmtDate()
        styles.css
        components/
          Header, AddNote, Board, Lane, Card, Modal,
          AskAnchor, Commands, SyncQueue, Weather, PrivateThoughts
    lib/            ← crypto.js, db.js, email.js, helpers.js, remind.js, usage.js, weather.js, inbound.js, private.js
    routes/         ← notes.js, sync.js, chat.js, groom.js

  anchor/           ← Anchor 2 source (DECOMMISSIONED — do not edit or deploy)
    server.js
    Dockerfile
    package.json
    lib/            ← crypto.js, db.js, email.js, helpers.js, usage.js
    routes/         ← notes.js, sync.js, chat.js, bridge.js, mcp.js, ui.js

  anchor-mcp/       ← anchor-mcp source (SOURCE OF TRUTH)
    mcp-server.js
    package.json
    Dockerfile

  md/               ← session handoff files
    work-claude-handoff.md   ← Work Claude reads this at session start
    ollama-system-prompt.md  ← Ollama local AI system prompt
    session-latest.md        ← most recent session summary (if exists)

  archive/          ← old backups
```

## Production Locations (OMV server — 192.168.50.23)

```
/srv/mergerfs/warehouse/anchor3/         ← Anchor 3 production (LIVE)
  data/notes3.db                         ← SQLite (encrypted)
  attachments/
  .env                                   ← secrets (never commit)

/srv/mergerfs/warehouse/anchor/          ← Anchor 2 production (DECOMMISSIONED — offline)

/srv/mergerfs/warehouse/anchor-mcp/      ← anchor-mcp production (live)
/srv/mergerfs/warehouse/casmas-bridge/   ← this repo (git clone on NAS)
```

## Anchor 3 Update Workflow

No auto-sync bridge — every change requires manual deploy.

**Frontend or backend JS changes:**
1. Edit in `casmas-bridge/anchor3/` via MCP write tools
2. `git_commit_push`
3. Copy updated file(s) to `/srv/mergerfs/warehouse/anchor3/`
4. `docker rm -f anchor3 && docker compose up -d --build`

**Dockerfile or package.json:**  
Same as above — always a full rebuild.

## Anchor 2 — DECOMMISSIONED

**Do not edit or deploy.** Container stopped and removed April 2026. The `anchor/` directory is a historical archive only.

## Important Notes

- anchor3 and anchor-mcp do NOT use Docker Hub — local builds only, no Watchtower
- Anchor 3 Cloudflare tunnel: `anchor.thecasmas.com` → port 1234 (container anchor3)
- Live docker-compose files on OMV contain hardcoded secrets — never sync to repo

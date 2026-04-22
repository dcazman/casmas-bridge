# Casmas Bridge — Work Claude Handoff
**Last updated:** April 22, 2026
**Written by:** Personal Claude (synced from Anchor)

---

## How to Connect

Work Claude connects via the **standard GitHub MCP connector** — NOT the Casmas custom MCP. Employer blocks custom connectors.

**Repo:** `github.com/dcazman/casmas-bridge` (private)

Add in Claude.ai → Settings → Connectors → GitHub. Then read this file and `md/session-latest.md` if it exists.

---

## Dan — Who He Is

- **Employer:** Sonos | **Title:** Senior Messaging Engineer | **Manager:** Paul Henry | **Since:** Sept 20, 2021
- **Daily driver:** M4 Mac mini, 16GB unified memory, Apple M4 chip (10-core)
- **Home:** Lincolnton, NC | Partner Kathie | Two boys: Ethan (turning 7 Oct 20) and Zach (turning 3 Aug 22)
- **Home server:** OMV NAS at 192.168.50.23

---

## Current Infrastructure (April 2026)

### OMV Server (192.168.50.23)
| Service | URL | Notes |
|---|---|---|
| **Anchor 3** | anchor.thecasmas.com | Personal AI memory app — LIVE |
| anchor-mcp | mcp.thecasmas.com | MCP gateway |
| GMR | gmr.thecasmas.com | DNS mail lookup tool |
| Mealie, Dozzle, Seerr | local only | Home services |
| Cloudflared, Watchtower | — | Tunnel + auto-updates |

### M4 Mac mini (192.168.50.50)
| Service | Notes |
|---|---|
| Plex | Media server |
| Sonarr / Radarr / Profilarr | Media management |
| Ollama | Installed but **DECOMMISSIONED** — stopped + disabled via launchctl. Not uninstalled. |
| FileFlows | Media transcoding, nights only |

---

## Anchor 3 — Current State (LIVE)

- **Stack:** Preact/Vite frontend + Node/Express backend + SQLite (better-sqlite3), AES-256-GCM encrypted
- **Container:** `anchor3` on OMV, port 1234 (external) → 7779 (internal)
- **Cloudflare tunnel:** `anchor.thecasmas.com` → port 1234
- **Source:** `anchor3/` in this repo
- **Live path on OMV:** `/srv/mergerfs/warehouse/anchor3/`
- **Data:** `/srv/mergerfs/warehouse/anchor3/data/notes3.db`
- **Config:** `/srv/mergerfs/warehouse/anchor3/.env` (secrets — never in repo)
- **AI:** Anthropic API only (Rooster/Ollama decommissioned). Ask button = Haiku. Ask Claude ($) = Opus.
- **USE_OLLAMA=false** in .env

### Anchor 3 Features
- Lane/card board UI — notes grouped by type into collapsible lanes
- Private Thoughts lane — password-protected, separate session token, label filter support
- Label/tag support on all cards including Private Thoughts
- Reminders system with snooze
- Weather panel (Tempest station)
- Ask Anchor chat (Anthropic API)
- Inbound email (anchor@thecasmas.com → IMAP polling every 30min)
- File attachments
- Drag-to-reorder cards and lanes

### Anchor 3 API Routes
All under `/api/` prefix: `/api/notes`, `/api/note`, `/api/reclassify`, `/api/status`, `/api/chat`, `/api/sync`, `/api/private/*`

### Anchor 3 Update Workflow
No auto-sync — every change requires manual deploy.

**Frontend (JSX/CSS) changes:**
1. Edit in `anchor3/client/src/` via MCP write tools
2. `git_commit_push`
3. `rebuild_service anchor3` (triggers full Docker rebuild with Vite)

**Backend JS only (routes/, lib/):**
1. Edit via MCP write tools
2. `git_commit_push`
3. `rebuild_service anchor3`

**Dockerfile or package.json:**
Same as above — always a full rebuild.

---

## Anchor 2 — DECOMMISSIONED

`anchor/` directory exists in repo as historical reference only. **Do not edit. Do not deploy.**
The live app is Anchor 3 only.

---

## anchor-mcp Tools

`add_note`, `get_notes`, `search_notes`, `get_open_loops`, `get_summary`, `get_pi`, `reclassify_note`, `delete_note`, `write_file`, `read_file`, `git_commit_push`, `rebuild_service`

**Work scope filter:** Work token only returns work-scoped notes. Personal data never surfaces.

---

## Restore from Scratch (if OMV goes down)

Everything needed to rebuild anchor3 is in this repo **except**:
1. `.env` file (secrets) — stored in Anchor PI notes (type: `pi`)
2. `notes3.db` — the live database. Back up regularly from `/srv/mergerfs/warehouse/anchor3/data/notes3.db`

**Steps to restore on any Docker host:**
```bash
git clone https://github.com/dcazman/casmas-bridge
cd casmas-bridge/anchor3
# create .env with secrets (pull from PI notes or memory)
mkdir -p data attachments
# restore notes3.db into data/ if available
docker compose up -d --build
```
Point Cloudflare tunnel to new host port 1234.

---

## Decisions Made (permanent record)

- **Anchor 3 is the only live app** — Anchor 2 decommissioned April 2026
- **Ollama/Rooster decommissioned** — not providing value; Anthropic API used for all AI
- **Anchor not on Docker Hub** — local/private build only, no Watchtower for anchor3 or anchor-mcp
- **anchor-mcp runs outside OMV GUI** — plain docker compose
- **No background GitHub polling** — only Claude or manual triggers a bridge sync
- **Work Claude uses GitHub MCP** — employer blocks custom connectors

---

## Sonos Work Context

Dan's employer is Sonos. He's a Senior Messaging Engineer. Manager is Paul Henry.

Work Claude should check `md/session-latest.md` for recent work context if it exists.

---

## Personal Data Boundary

**Never** include in casmas-bridge: home details, kids info, health, finance, personal relationships, Anchor DB contents, or anything from the personal scope of Anchor notes. Work context only in this repo.

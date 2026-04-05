# Casmas Bridge — Work Claude Handoff
**Last updated:** April 6, 2026
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
| Anchor 2.0 | anchor.thecasmas.com | Personal AI memory app |
| anchor-mcp | mcp.thecasmas.com:8000 | MCP gateway, 11 tools |
| GMR | gmr.thecasmas.com | DNS mail lookup tool |
| Mealie, Dozzle, Seerr | local only | Home services |
| Cloudflared, Watchtower | — | Tunnel + auto-updates |

### M4 Mac mini (192.168.50.50)
| Service | Notes |
|---|---|
| Plex | Media server |
| Sonarr / Radarr / Profilarr | Media management |
| **Ollama** | **LIVE** — llama3.2:3b at 192.168.50.50:11434, Metal GPU, persistent via LaunchAgent |
| FileFlows | Media transcoding, nights only |

### Anchor 2.0 — Current State
- Stack: Node/Express + SQLite (better-sqlite3), AES-256-GCM encrypted
- Modular codebase: `routes/` (notes, sync, chat, bridge, mcp, ui) + `lib/` (db, crypto, usage, email, helpers)
- **Ollama connected** — Ask button = local llama3.2:3b (free). Ask Claude ($) = Anthropic Opus (paid)
- Data: `/srv/mergerfs/warehouse/anchor/data/notes.db`
- Config: `/srv/mergerfs/warehouse/anchor/.env`
- New logo: anchor on book with seaweed (Anchor 2.0 branding)
- Runs outside OMV GUI via plain docker compose

### casmas-bridge Repo
- Server path: `/srv/mergerfs/warehouse/casmas-bridge/`
- Mounted into anchor-mcp at `/repo/casmas-bridge`
- Personal Claude writes here via MCP tools (write_file, git_commit_push)
- Work Claude reads via GitHub MCP

---

## What Personal Claude Manages (not Work Claude's concern)

All infrastructure: anchor, anchor-mcp, OMV, Docker, Cloudflare tunnels, casmas-bridge repo, Ollama. Work Claude stays in its lane — Sonos work, Jira, Slack, GitLab, GCP only.

---

## anchor-mcp Tools (11 total)

`add_note`, `get_notes`, `search_notes`, `get_open_loops`, `get_summary`, `get_pi`, `reclassify_note`, `delete_note`, `write_file`, `read_file`, `git_commit_push`, `rebuild_service`

**Work scope filter:** Work token only returns `work`, `work-task`, `work-decision`, `work-idea`, `meeting`, `calendar`, `email` — personal data never surfaces.

---

## Open Work Tasks (as of April 6, 2026)

### Anchor — Next Build Session
- Remove Claude.ai weekly usage widget from header (CLAUDE_USAGE_PCT approach too manual)
- DST timestamp fix: replace SQLite `datetime('now')` with `new Date().toLocaleString('sv-SE', {timeZone: 'America/New_York'})` in db.js inserts
- Wire Ollama system prompt MD (`md/ollama-system-prompt.md`) to load at runtime in routes/sync.js and routes/chat.js instead of hardcoded string
- Date grouping headers in notes list (Today / Yesterday / This Week)
- Weekly Anchor DB groom pass (recurring)

### Infrastructure / Future
- Casmas Core hardware spec — NVIDIA mini PC $500-700 for dedicated local LLM (current Ollama on M4 Mac is interim)
- Skylight → Anchor sync service (parked, idea note logged)
- Hey Anchor Pi listener (Pi 5 hardware broken, parked)
- Obsidian export target (future)
- Multer upgrade to 2.x (security, non-breaking, low priority)

---

## Decisions Made (permanent record)

- **Ollama on Mac** — nothing moves to OMV. FileFlows runs nights only to free headroom. M4 handles Plex, arrs, Ollama daytime fine.
- **Anchor not on Docker Hub** — local/private build only, no Watchtower for anchor or anchor-mcp
- **anchor-mcp runs outside OMV GUI** — plain docker compose, env vars baked into compose file on disk
- **No background GitHub polling** — only Anchor or Claude triggers a bridge sync (intent-driven)
- **Work Claude uses GitHub MCP** — employer blocks custom connectors, GitHub MCP is policy-safe

---

## Sonos Work Context

Dan's employer is Sonos. He's a Senior Messaging Engineer. Manager is Paul Henry.

Recent work activity (April 3, 2026):
- Jeff Williams: ExternalSecret namespace targeting (argocd vs drive-copy). File moved, namespace Jeff's domain. PR rebased, logs visible.
- Sharif Kadri (Director of Revenue Systems): AI/Kit conversation. Dan keeping eye on inspiration for Kit project.
- Paul Henry: loose conversation noted.

Work Claude should check `md/session-latest.md` for any more recent work context if it exists.

---

## Personal Data Boundary

**Never** include in casmas-bridge: home details, kids info, health, finance, personal relationships, Anchor DB contents, or anything from the personal scope of Anchor notes. Work context only in this repo.

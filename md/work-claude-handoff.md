# Casmas Bridge — Work Claude Handoff
**Last updated:** April 5, 2026
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
| anchor-mcp | mcp.thecasmas.com:8000 | MCP gateway, 12 tools |
| GMR | gmr.thecasmas.com | DNS mail lookup tool |
| Mealie, Dozzle, Seerr | local only | Home services |
| Cloudflared, Watchtower | — | Tunnel + auto-updates |

### M4 Mac mini (192.168.50.50)
| Service | Notes |
|---|---|
| Plex | Media server |
| Sonarr / Radarr / Profilarr | Media management |
| **Ollama** | **LIVE** — llama3.2:3b (chat) + mistral (sync/classification) at 192.168.50.50:11434, Metal GPU, persistent via LaunchAgent (has been crashing — under investigation) |
| FileFlows | Media transcoding, nights only |

### Anchor 2.0 — Current State
- Stack: Node/Express + SQLite (better-sqlite3), AES-256-GCM encrypted
- Modular codebase: `routes/` (notes, sync, chat, bridge, mcp, ui) + `lib/` (db, crypto, usage, email, helpers)
- **Ollama connected** — Ask button = local llama3.2:3b (free). Ask Claude ($) = Anthropic API (paid), always visible
- Engine label in header shows 🦙 Ollama or 🤖 Anthropic depending on active engine
- TZ=America/New_York set in docker-compose (DST fixed)
- Ollama system prompt loads from `/bridge/md/ollama-system-prompt.md` at runtime
- Chat history panel (collapsible, localStorage, 30 entries)
- SMTP email working (mail.privateemail.com → dcasmas@gmail.com)
- Alert button live in Sync Queue
- Data: `/srv/mergerfs/warehouse/anchor/data/notes.db`
- Config: `/srv/mergerfs/warehouse/anchor/.env`
- Runs outside OMV GUI via plain docker compose

### Classification System
- Guide lives in Anchor DB as a `pi` note, pulled on every sync
- Categories added April 5: `anchor` (cat a) and `anchor-task` (cat at)
- Anchor/system notes are **personal scope** — Work Claude never sees them

### casmas-bridge Repo
- Server path: `/srv/mergerfs/warehouse/casmas-bridge/`
- Mounted into anchor-mcp at `/repo/casmas-bridge`
- Personal Claude writes here via MCP tools (write_file, git_commit_push)
- Work Claude reads via GitHub MCP

---

## What Personal Claude Manages (not Work Claude's concern)

All infrastructure: anchor, anchor-mcp, OMV, Docker, Cloudflare tunnels, casmas-bridge repo, Ollama. Work Claude stays in its lane — Sonos work, Jira, Slack, GitLab, GCP only.

---

## anchor-mcp Tools (12 total)

`add_note`, `get_notes`, `search_notes`, `get_open_loops`, `get_summary`, `get_pi`, `reclassify_note`, `delete_note`, `write_file`, `read_file`, `git_commit_push`, `rebuild_service`

**Known issue:** `reclassify_note` returning "Failed: No input" — needs investigation.

**Work scope filter:** Work token only returns `work`, `work-task`, `work-decision`, `work-idea`, `meeting`, `calendar`, `email` — personal data never surfaces.

---

## Open Work Tasks (as of April 5, 2026)

### Tomorrow (April 6) — Priority Build Session
- [ ] **Proactive reminders** — when a `calendar` note contains a date/time, Anchor creates a phone notification automatically. Core gap: Anchor knows but doesn't tell Dan.
- [ ] **Daily digest** — morning summary: today's calendar notes, open loops, 3-day lookahead. Like a weather widget for your life. Could be push notification, email, or dedicated home screen view.

### Anchor — Immediate
- [ ] Sync sanitized `anchor/docker-compose.yml` to casmas-bridge (live file has hardcoded SMTP password — use `${VAR}` placeholders in repo version)
- [ ] Sync sanitized `anchor-mcp/docker-compose.yml` to casmas-bridge (MCP_TOKEN hardcoded in live file)
- [ ] Deploy rebuild_service fix to anchor-mcp: `docker compose -f /srv/mergerfs/warehouse/anchor-mcp/docker-compose.yml up -d --build`
- [ ] Set up weekly groom cron: `0 9 * * 0 curl -s -X POST http://192.168.50.23:7778/groom`
- [ ] Groom should fix as well as report — currently report-only
- [ ] Investigate Ollama crash pattern on M4
- [ ] casmas-bridge cleanup — delete `_chat_buttons_patch.txt` and `_pull_bridge_patch.js`
- [ ] Remove tokens from sync area in Anchor UI
- [ ] Fix `reclassify_note` tool — returning "Failed: No input"

### Anchor — Soon
- [ ] Date grouping headers in notes list (Today / Yesterday / This Week)
- [ ] Split note UI action — select a note, split into two categories in one step
- [ ] Token cost display near Ask Claude ($) button (deferred)

### Infrastructure / Future
- Casmas Core — RTX 3090 24GB in used SFF tower (~$550-650 total) for dedicated local LLM. Goal: run 32B-70B models and eliminate Anthropic API costs.
- Skylight → Anchor sync service (parked)
- Hey Anchor Pi listener (Pi 5 hardware broken, parked)
- Obsidian export target (future)
- Multer upgrade to 2.x (low priority)
- Proactive email alerts from Anchor (future)

---

## Decisions Made (permanent record)

- **Ollama on Mac** — nothing moves to OMV. FileFlows runs nights only to free headroom. M4 handles Plex, arrs, Ollama daytime fine.
- **Anchor not on Docker Hub** — local/private build only, no Watchtower for anchor or anchor-mcp
- **anchor-mcp runs outside OMV GUI** — plain docker compose, env vars baked into compose file on disk
- **No background GitHub polling** — only Anchor or Claude triggers a bridge sync (intent-driven)
- **Work Claude uses GitHub MCP** — employer blocks custom connectors, GitHub MCP is policy-safe
- **USE_OLLAMA=true hardcoded** in anchor docker-compose

---

## Sonos Work Context

Dan's employer is Sonos. He's a Senior Messaging Engineer. Manager is Paul Henry.

Recent work activity:
- April 3, 2026: Jeff Williams — ExternalSecret namespace targeting (argocd vs drive-copy). File moved, namespace Jeff's domain. PR rebased, logs visible.
- April 3, 2026: Sharif Kadri (Director of Revenue Systems) — AI/Kit conversation. Dan keeping eye on inspiration for Kit project.
- April 3, 2026: Paul Henry — loose conversation noted.

### Upcoming Schedule
- **Monday April 6** — 9:30 AM, 2 hours taken
- **Thursday April 9** — 4 hours off starting 11 AM

Work Claude should check `md/session-latest.md` for any more recent work context if it exists.

---

## Personal Data Boundary

**Never** include in casmas-bridge: home details, kids info, health, finance, personal relationships, Anchor DB contents, or anything from the personal scope of Anchor notes. Work context only in this repo.

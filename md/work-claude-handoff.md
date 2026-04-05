# Casmas Bridge — Work Claude Handoff
**Last updated:** Saturday April 5, 2026
**Written by:** Personal Claude

---

## What This Repo Is
Private shared file layer between Personal Claude and Work Claude. Personal Claude writes context here. Work Claude reads it to get up to speed without Dan having to re-explain everything.

---

## How to Connect (Work Claude)

Connect via the Casmas MCP server — NOT directly to GitHub.

**MCP URL:** `https://mcp.thecasmas.com/mcp?token=fff6327e5fec20f2553ae6deb6e5ae7a`

Add as a custom connector in Claude.ai → Settings → Connectors → Add custom connector. Name: `casmas-mcp`

**Note:** Confirm this is allowed under your employer's policy before connecting.

---

## MCP Tools Available to Work Claude

| Tool | What It Does |
|------|-------------|
| `get_notes` | Fetch notes from Anchor (work-scoped only) |
| `search_notes` | Search Anchor notes by keyword |
| `get_open_loops` | Get all unresolved actions |
| `get_summary` | Get recent activity digest |
| `get_pi` | Get permanent facts about Dan |
| `add_note` | Write a note to Anchor |
| `read_file` | Read any file from this repo |
| `write_file` | Write files to this repo |
| `git_commit_push` | Commit and push changes to GitHub |
| `rebuild_service` | Restart Docker containers on OMV server |

**Work scope filter:** Work Claude only sees note types: `work`, `work-task`, `work-decision`, `work-idea`, `meeting`, `calendar`, `email`. Personal data never surfaces.

---

## Recommended Session Start Flow

```
1. get_summary(days=7)          — recent activity digest
2. get_notes(type=work-task)    — open work tasks
3. read_file(path=md/session-latest.md)  — latest personal Claude handoff if exists
```

---

## Infrastructure Reference

| Item | Value |
|------|-------|
| OMV server | 192.168.50.23 |
| Anchor UI | anchor.thecasmas.com:7778 |
| MCP gateway | mcp.thecasmas.com:8000 |
| casmas-bridge repo | github.com/dcazman/casmas-bridge |
| Repo on server | /srv/mergerfs/warehouse/casmas-bridge/ |
| Dan's employer | Sonos |
| Dan's title | Senior Messaging Engineer |
| Dan's manager | Paul Henry |

---

## What Was Built April 4-5, 2026 (Session 5)

- Extended anchor-mcp with `write_file`, `read_file`, `git_commit_push`, `rebuild_service`
- SSH deploy key added to casmas-bridge repo (`/root/.ssh/deploy_key` on server)
- anchor-mcp moved out of OMV Compose GUI — now managed via plain docker compose
- Claude can now make code changes and deploy end to end without Dan touching anything
- Exception: anchor-mcp itself can't restart via MCP (kills connection) — manual `docker restart anchor-mcp` needed

---

## Open Tasks (as of April 5, 2026)

### Immediate
- Mac baseline snapshot (CPU/RAM/thermals) → unblocks Ollama install
- Fix DST timestamp bug in anchor/server.js
- Add DELETE /notes/:id endpoint + delete_note MCP tool
- Hard delete note 15 (old Classification Guide v1.0)
- Hard delete notes 27 and 28 (Sonos employment dupes)

### Anchor Features
- Weekly DB groom pass (dedup, stale loops, reclassify)
- Token usage widget in Anchor UI
- Date grouping headers in notes list
- Anchor notification/alert system

### Infrastructure
- Mac baseline → Ollama install decision
- Casmas Core hardware spec (NVIDIA mini PC $500-700)

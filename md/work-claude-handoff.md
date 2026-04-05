# Casmas Bridge — Work Claude Handoff
**Last updated:** Saturday April 5, 2026
**Written by:** Personal Claude

---

## IMPORTANT — How Work Claude Connects

**Work Claude CANNOT use the Casmas MCP server.** The employer blocks custom MCP connectors.

Work Claude connects via the **standard GitHub MCP connector** instead. This is policy-safe — it's a standard Anthropic connector, not a custom one.

**Repo:** `github.com/dcazman/casmas-bridge` (private)

Add GitHub MCP in Claude.ai → Settings → Connectors → GitHub. Then browse or read files from this repo.

---

## Session Start Flow

```
1. Read md/work-claude-handoff.md   — this file, full context
2. Read md/session-latest.md        — most recent Personal Claude session summary (if exists)
```

---

## What casmas-bridge is

Private GitHub repo. This is the shared file layer between Personal Claude and Work Claude.

- Personal Claude writes session summaries and context files here
- Work Claude reads them via GitHub MCP to get up to speed
- Work Claude can write files back (task updates, session notes, responses)

Personal data (home, kids, health, finance, Anchor DB) never goes here. Work context only.

---

## Key Facts About Dan

| Item | Value |
|------|-------|
| Employer | Sonos |
| Title | Senior Messaging Engineer |
| Manager | Paul Henry |
| Start date | September 20, 2021 |
| Daily driver | M4 Mac mini, 16GB |
| Home server | OMV at 192.168.50.23 |

---

## What Personal Claude Manages (not Work Claude's concern)

- anchor-mcp MCP server at mcp.thecasmas.com
- Anchor notes app at anchor.thecasmas.com
- All Docker services on OMV server
- casmas-bridge repo (Personal Claude writes here, Work Claude reads)

---

## What Was Built April 4-5, 2026

- Personal Claude can now write files, commit, and push to casmas-bridge end to end via MCP tools
- anchor-mcp extended with: write_file, read_file, git_commit_push, rebuild_service
- SSH deploy key on server handles all git auth
- anchor-mcp moved out of OMV Compose GUI — runs via plain docker compose

---

## Open Tasks Carry Forward

### Immediate
- Mac baseline done (M4 Mac mini, 16GB) — install Ollama next session
- Fix DST timestamp bug in anchor/server.js
- Add DELETE /notes/:id endpoint + delete_note MCP tool
- Hard delete notes 15, 27, 28 (dupes/stale)

### Anchor Features
- Token usage widget in Anchor UI
- Date grouping headers in notes list
- Anchor notification/alert system
- Weekly DB groom pass

### Infrastructure
- Ollama install on M4 Mac mini (brew install ollama, pull llama3.2 or mistral)
- Casmas Core hardware spec (NVIDIA mini PC $500-700)

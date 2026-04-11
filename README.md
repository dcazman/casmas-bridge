# casmas-bridge

Git-based bridge between Claude and the Casmas home server stack. Acts as the source-of-truth for Anchor source code and auto-generated context files.

## What lives here

```
anchor/          Anchor source code (auto-deployed to NAS on push)
  lib/
    db.js        SQLite + encryption helpers
    remind.js    Reminder scheduler, command processor, 7AM digest email
    session.js   Session MD generator, git push/pull helpers
    helpers.js   ALL_TYPES, CAT shortcuts, colors, text utils
    ...
  routes/
    ui.js        Full web UI (HTML/CSS/JS, all in one)
    chat.js      Ask Anchor — Rooster (Ollama) or Anthropic API
    notes.js     Add/edit/delete notes
    sync.js      AI batch classification
    ...
  server.js      Express entry point, /reclassify, /usage
anchor-mcp/      MCP server exposing Anchor tools to Claude
md/
  session-latest.md   Auto-generated session context (updated by Anchor)
```

## Services

| Service | Path on NAS | Public URL |
|---------|-------------|------------|
| anchor | /srv/mergerfs/warehouse/anchor/ | anchor.thecasmas.com |
| anchor-mcp | /srv/mergerfs/warehouse/anchor-mcp/ | mcp.thecasmas.com |

## Deploy flow

JS-only changes (routes, lib): push to git → Anchor auto-applies every 3hr, or click ⇄ Sync Bridge in UI.

Dockerfile/package.json changes: require full rebuild via 🔨 Rebuild button or manual `docker compose build`.

## Anchor feature summary

### Note types (cat markup)
| Shortcut | Type |
|----------|------|
| `cat w` | work |
| `cat wt` | work-task |
| `cat wd` | work-decision |
| `cat p` | personal |
| `cat pt` | personal-task |
| `cat ho` | home |
| `cat ht` | home-task |
| `cat k` | kids |
| `cat h` | health |
| `cat f` | finance |
| `cat i` | idea |
| `cat pi` | pi (permanent facts) |
| `cat ol` | open-loop (appears in daily email) |
| `cat bd` | brain-dump |
| `cat ls` | list (renders as checkboxes) |
| `cat s` | summary |
| `cat rem` | remind |

### Reminders
- Trigger: start note with `remind`, `r`, or `todo`
- Format: `remind thing, date` or `remind thing date`
- No sync needed — saved instantly with a number (#N)
- Commands (Add Note, no sync needed):
  - `done N` — delete
  - `snooze N` — push 1 week
  - `snooze N friday 3pm` — push to time
  - `change N to new text thursday` — update content + time
  - Multiple: `done 9, snooze 10 friday`

### Open loops
- `cat ol` — permanently tracked, shown in 7AM digest email under 🔓 Open Loops
- To close: delete or reclassify the note

### AI engine
- Default: Anthropic API (Haiku for chat, Opus for Ask Claude)
- Local: Rooster (Ollama at OLLAMA_URL) when USE_OLLAMA=true
- Header shows 🐓 Rooster (local) or 🤖 Anthropic API

### Email
- 7AM daily digest: due today, coming up, open loops, AI-flagged loops, pending count
- 15-min cron: individual reminder fires when due
- Subject: `☀️ Anchor — N due today · Day, Mon DD`
- Footer: `done N · snooze N · snooze N friday 3pm · change N to new text`

## MCP tokens
- Personal Claude: `https://mcp.thecasmas.com/mcp?token=a88b87dc73e4da3555c69cb775612791`
- Work Claude: `https://mcp.thecasmas.com/mcp?token=fff6327e5fec20f2553ae6deb6e5ae7a` (work-scoped notes only)

# Anchor 3

Personal second-brain and note system. Preact/Vite frontend, Express backend, SQLite storage. Live at `anchor.thecasmas.com`.

## Stack

- **Frontend:** Vite + Preact, port 7779 (mapped to 1234 in Docker)
- **Backend:** Express, SQLite via better-sqlite3
- **AI:** Anthropic API (Haiku for sync, Opus for Ask Anchor) — Ollama decommissioned
- **Deploy:** Docker on OMV (192.168.50.23)

## Paths

| Location | Path |
|----------|------|
| Git source | `casmas-bridge/anchor3/` |
| OMV source | `/srv/mergerfs/warehouse/casmas-bridge/anchor3/` |
| OMV live | `/srv/mergerfs/warehouse/anchor3/` |
| Data | `/srv/mergerfs/warehouse/anchor3/data/notes3.db` |
| Attachments | `/srv/mergerfs/warehouse/anchor3/attachments/` |

## Deploy

No auto-sync — all changes require manual rebuild.

**CRITICAL — always edit files in TWO places:**
1. Git source: `/srv/mergerfs/warehouse/casmas-bridge/anchor3/` (via MCP write/str_replace tools)
2. Live source: `/srv/mergerfs/warehouse/anchor3/` (copy after editing, or edit directly)

The `rebuild_service anchor3` MCP tool handles both: it syncs from casmas-bridge and rebuilds.

**The `anchor/` directory in casmas-bridge is DECOMMISSIONED. Never edit it. All work goes in `anchor3/`.**

Rebuild command (if doing manually):
```bash
cd /srv/mergerfs/warehouse/anchor3 && docker compose up -d --build
```

## CAT shortcuts

| Shortcut | Type |
|----------|------|
| `wt` | work-task |
| `wd` | work-decision |
| `wi` | work-idea |
| `wp` | work-project |
| `wm` | work-meeting |
| `wpw` | work-password |
| `pst` / `pta` | personal-task |
| `pd` | personal-decision |
| `pid` | personal-idea |
| `pp` | personal-project |
| `pm` | personal-meeting |
| `rec` / `rcp` | personal-recipe |
| `ht` | health-task |
| `hid` | health-idea |
| `hpr` | health-project |
| `ft` | finance-task |
| `fid` | finance-idea |
| `fpr` | finance-project |
| `kw` | Kathie-Wife |
| `zs` | Zach-Son |
| `es` | Ethan-Son |
| `afl` | Andy-FatherInLaw |
| `ma` | Maureen-Aunt |
| `ka` | Kathy-Aunt |
| `ms` | Micky-Stepmother |
| `lb` | Lee-Brother |
| `csl` | Charity-SisterInLaw |
| `kd` | Kevin-Dog |
| `mc` | Mat-Cat |
| `pcc` | Phil-Cat |
| `acc` | Ace-Cat |
| `liz` | Herschel-Lizard |
| `hen` | hens |
| `hhr` | hey-hey-Rooster |
| `pi` | pi (permanent facts) |
| `ls` / `li` | list |
| `re` | remind |
| `r` | random |
| `ol` | open-loop |
| `cal` | calendar |
| `anc` | anchor |
| `emp` | employment |
| `ch` | claude-handoff |
| `pt` | private-thoughts |

Multi-type: `cat wt,wp` creates two notes. List mode: `cat wt ls` auto-checkboxes every line.

## Note Formatting

- **`# Title`** — first line starting with `#` renders as a bold heading on the card face. Useful for naming list cards (e.g. `# Grocery Run` above your checkboxes).

## Views

Toggle between **Board** and **List** using the `⊞ Board / ≡ List` buttons in the controls bar.

| View | Description |
|------|-------------|
| Board | Lanes per type, horizontal scroll rows of cards (default) |
| List | Compact 2-column grid, all notes grouped by type — no lane structure |

In list view each row shows: `#num`, title line, subtitle, remind indicator, tags, relative date. Hover to reveal edit/delete buttons. Private Thoughts appear as an inline section (floating PT panel is hidden while list view is active).

## Private Thoughts

Hidden by default on every page load. Toggle via Add Note (no note is saved):

| Input | Action |
|-------|--------|
| `s` or `show` | Show Private Thoughts section |
| `h` or `hide` | Hide Private Thoughts section |

## Reminders

Format: `re call dentist, monday 9am`

Commands (no sync needed, post directly):
- `done N` — delete
- `snooze N` — push 1 week
- `snooze N friday 3pm` — push to specific time
- `change N to new text` — rewrite body (append date to also reschedule)
- `close N` — resolve open loop #N

## Environment

```
ENCRYPTION_KEY=          # required, 32-char
ANTHROPIC_API_KEY=       # required
USE_OLLAMA=false
SMTP_HOST / SMTP_USER / SMTP_PASS / FROM_EMAIL / ALERT_EMAIL / ALERT_EMAIL2
IMAP_HOST / IMAP_USER / IMAP_PASS / ANCHOR_INBOUND=anchor@thecasmas.com
TEMPEST_TOKEN=           # optional weather widget
```

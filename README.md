# casmas-bridge

Git-based bridge between Claude and the Casmas home server stack. Acts as the source-of-truth for Anchor source code and auto-generated context files.

## What lives here

```
anchor/          ⛔ DECOMMISSIONED — do not edit, do not use
anchor3/         Anchor 3 source (LIVE — Preact/Vite frontend, Express API)
anchor-mcp/      MCP server exposing Anchor tools to Claude
md/
  session-latest.md   Auto-generated session context (updated by Anchor)
```

## ⚠️ CRITICAL FOR ALL CLAUDE INSTANCES

**`anchor/` is dead. It does not run. It is not deployed. Ignore it entirely.**

All Anchor work goes in `anchor3/`. The live service is at `anchor.thecasmas.com`, port 1234 on the LAN (maps to internal 7779). Use the `rebuild_service anchor3` MCP tool to deploy changes.

## Services

| Service | Path on NAS | Public URL | Status |
|---------|-------------|------------|--------|
| anchor3 | /srv/mergerfs/warehouse/anchor3/ | anchor.thecasmas.com | **LIVE** |
| anchor | /srv/mergerfs/warehouse/anchor/ | (none — port 7778 only) | **DECOMMISSIONED** |
| anchor-mcp | /srv/mergerfs/warehouse/anchor-mcp/ | mcp.thecasmas.com | Live |

## Deploy flow — Anchor 3

Anchor 3 has no auto-sync bridge. All changes require manual deploy.

**JS-only changes** (routes/, lib/, client/src/):
1. Edit files locally at `C:\casmas-bridge\anchor3\`
2. Apply to OMV via `mcp__casmas-mcp__str_replace` or `mcp__casmas-mcp__write_file`
3. Commit and push via `mcp__casmas-mcp__git_commit_push`
4. For frontend changes: also `cp` the updated file to `/srv/mergerfs/warehouse/anchor3/` then rebuild
5. Run: `docker rm -f anchor3 && docker compose up -d --build`

**Dockerfile or package.json changes**:
- Same as above, always requires a full Docker rebuild

**Source paths:**
- Git source: `/srv/mergerfs/warehouse/casmas-bridge/anchor3/`
- Live files: `/srv/mergerfs/warehouse/anchor3/`
- Data: `/srv/mergerfs/warehouse/anchor3/data/notes3.db`
- Attachments: `/srv/mergerfs/warehouse/anchor3/attachments/`

## Anchor 3 feature summary

### Note types (CAT shortcuts)

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
| `ls` / `li` | list (renders as checkboxes) |
| `re` | remind |
| `r` | random |
| `ol` | open-loop |
| `cal` | calendar |
| `anc` | anchor |
| `emp` | employment |
| `ch` | claude-handoff |
| `pt` | private-thoughts |

### Reminders

- Format: start note with `re` or `remind`, then: `call dentist, monday 9am`
- Commands (post directly to Add Note, no sync needed):
  - `done N` — delete
  - `snooze N` — push 1 week
  - `snooze N friday 3pm` — push to time
  - `change N to new text` — rewrite body (append date to also reschedule)

### Open loops

- `cat ol` — tracked, shown in 7AM digest email under 🔓 Open Loops
- To close: type `close N` in Add Note, or delete/reclassify

### AI engine

- **Anthropic API** — Haiku for classification/sync, Opus for Ask Anchor
- Ollama decommissioned — `USE_OLLAMA=false` in `.env`
- Header shows 🤖 Anthropic API

### Email

- 7AM daily digest: due today, coming up, open loops, pending count
- 5-min cron: individual reminder fires ~30 min before due time
- Inbound: anchor@thecasmas.com → IMAP ingestion (markSeen:true prevents re-ingestion)

### Database backup

- Daily at 2AM ET — `/data/backups/notes3-YYYY-MM-DD.db`
- Keeps last 7 snapshots, auto-prunes older ones
- Backups live on the same OMV volume as the live db (`/srv/mergerfs/warehouse/anchor3/data/backups/`)

### iOS shortcut

POST to `anchor.thecasmas.com/notes`, JSON body `{ "raw": "..." }`, Cloudflare headers required.

## MCP tokens (anchor-mcp)

- Personal Claude: `https://mcp.thecasmas.com/mcp?token=a88b87dc73e4da3555c69cb775612791`
- Work Claude: `https://mcp.thecasmas.com/mcp?token=fff6327e5fec20f2553ae6deb6e5ae7a` (work-scoped only)

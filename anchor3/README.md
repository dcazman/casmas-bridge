# Anchor 3

Personal second-brain and note system. Preact/Vite frontend, Express backend, SQLite storage. Live at `anchor.thecasmas.com`.

## Stack

- **Frontend:** Vite + Preact, port 7779 (mapped to 1234 in Docker)
- **Backend:** Express, SQLite via better-sqlite3
- **AI:** Ollama (mistral default) or Anthropic API fallback
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

No auto-sync — all changes require manual rebuild:

```bash
docker rm -f anchor3 && docker compose up -d --build
```

Frontend changes need the updated file copied to the live path before rebuild.

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
| `kd` | Kevin-Dog |
| `mc` | Mat-Cat |
| `pi` | pi (permanent facts) |
| `ls` / `li` | list |
| `re` | remind |
| `r` | random |
| `ol` | open-loop |
| `cal` | calendar |
| `ch` | claude-handoff |
| `pt` | private-thoughts |

Multi-type: `cat wt,wp` creates two notes. List mode: `cat wt ls` auto-checkboxes every line.

## Reminders

Format: `re call dentist, monday 9am`

Commands (no sync needed, post directly):
- `done N` — delete
- `snooze N` — push 1 week
- `snooze N friday 3pm` — push to specific time

## Environment

```
ENCRYPTION_KEY=          # required, 32-char
ANTHROPIC_API_KEY=       # optional (Ollama default)
USE_OLLAMA=true
OLLAMA_URL=http://192.168.50.50:11434
SMTP_HOST / SMTP_USER / SMTP_PASS / FROM_EMAIL / ALERT_EMAIL
IMAP_HOST / IMAP_USER / IMAP_PASS / ANCHOR_INBOUND=anchor@thecasmas.com
TEMPEST_TOKEN=           # optional weather widget
```

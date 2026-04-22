# casmas-bridge — Claude Code Instructions

See `README.md` for feature reference and `STRUCTURE.md` for directory layout.

## Anchor 3 — primary live app (anchor3/)

Production files live on OMV (`192.168.50.23`). Local edits at `C:\casmas-bridge\anchor3\` do nothing without pushing.

**JS-only changes** (routes/, lib/, client/src/):
1. Edit files locally
2. Use `mcp__casmas-mcp__str_replace` or `mcp__casmas-mcp__write_file` to apply to the OMV copy
3. Use `mcp__casmas-mcp__git_commit_push` to commit and push
4. Frontend changes additionally require: copy to live path + full Docker rebuild (see below)

**Full rebuild** (Dockerfile, package.json, or any frontend change):
1. Push via MCP tools
2. On OMV: `docker rm -f anchor3 && docker compose up -d --build`
   - Source: `/srv/mergerfs/warehouse/casmas-bridge/anchor3/`
   - Live path: `/srv/mergerfs/warehouse/anchor3/`

## Anchor 2 — legacy (anchor/)

**Pending decommission.** Only edit if explicitly asked.

JS-only changes: push to git → auto-applied every 3hr, or ⇄ Sync Bridge in UI.

Dockerfile/package.json changes: rebuild via 🔨 Rebuild button or:
```
cd /srv/mergerfs/warehouse/anchor
docker compose down && docker compose build --no-cache && docker compose up -d
```

## What NOT to commit

Live docker-compose files on OMV contain hardcoded secrets (SMTP password, MCP_TOKEN). Sanitized versions with `${VAR}` placeholders belong in the repo — never sync the live files.

## Session context

Read `md/work-claude-handoff.md` at the start of a session. Check `md/session-latest.md` if it exists for more recent context.

## AI engine

Anchor uses **Ollama** (mistral, 192.168.50.50:11434) by default for classification and chat. Suggest the Anthropic API only when heavy synthesis is needed.

## Source of truth

`anchor3/`, `anchor/`, and `anchor-mcp/` in this repo are the canonical source. OMV copies are deployed from here.

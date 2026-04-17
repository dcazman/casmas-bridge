# casmas-bridge — Claude Code Instructions

See `README.md` for feature reference and `STRUCTURE.md` for directory layout.

## Deploying changes

Production files live on the OMV server (`192.168.50.23`), not in this Windows checkout. Local edits at `C:\casmas-bridge` do nothing without pushing.

**JS-only changes** (routes/, lib/):
1. Edit files locally
2. Use `mcp__casmas-mcp__str_replace` or `mcp__casmas-mcp__write_file` to apply to the OMV copy
3. Use `mcp__casmas-mcp__git_commit_push` to commit and push
4. Changes are auto-applied every 3hr, or trigger manually via ⇄ Sync Bridge in the Anchor UI

**Dockerfile or package.json changes** (full rebuild required):
1. Edit locally + push via MCP tools above
2. Use `mcp__casmas-mcp__rebuild_service` to rebuild the Docker container

## What NOT to commit

The live docker-compose files on OMV contain hardcoded secrets (SMTP password, MCP_TOKEN). Sanitized versions with `${VAR}` placeholders belong in the repo — never sync the live files.

## Session context

Read `md/work-claude-handoff.md` at the start of a session. Check `md/session-latest.md` if it exists for more recent context.

## AI engine

Anchor uses **Ollama** (mistral, 192.168.50.50:11434) by default for classification and chat. Suggest the Anthropic API only when heavy synthesis is needed.

## Source of truth

`anchor/` and `anchor-mcp/` in this repo are the canonical source. The OMV copies are deployed from here.

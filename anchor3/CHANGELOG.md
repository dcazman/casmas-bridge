# Anchor 3 — Changelog

---

## 2026-04-24

### Hidden PT Lane + s/show/h/hide commands
- `private-thoughts` lane is now hidden from the board by default
- Type `s` or `show` in Add Note to reveal PT lane for the session
- Type `h` or `hide` to collapse it again; refresh also clears it
- PT notes are excluded from all Claude AI context by default unless explicitly unlocked

### #title on list cards
- First line of any note starting with `#` renders as a bold header
- No checkbox on the title line — items below it render normally
- Edit and remove the `#` to convert it back to a regular list item
- Example: `ls` → `#Soda` → `Coke` → `Sprite`

### Card text wraps to 2 lines
- Collapsed card text now wraps up to 2 lines instead of truncating with ellipsis
- Short titles stay single line; long titles wrap naturally

### Decommission anchor/ — CRITICAL
- `anchor/` directory in casmas-bridge is dead and not running
- All Claude instances must edit `anchor3/` only
- README.md and anchor3/README.md updated with prominent warnings
- Deploy via `rebuild_service anchor3` MCP tool, or manually:
  `cd /srv/mergerfs/warehouse/anchor3 && docker compose up -d --build`
- Live source: `/srv/mergerfs/warehouse/anchor3/`
- Git source: `/srv/mergerfs/warehouse/casmas-bridge/anchor3/`

---

## Architecture notes for Claude

- anchor3 is a **Preact/Vite frontend** — UI lives in `client/src/` components
- Backend is Express, all routes under `/api/`
- No server-rendered HTML — do not edit `anchor/routes/ui.js` (that file is from the dead codebase)
- Key files:
  - `client/src/App.jsx` — root component, state management
  - `client/src/components/Board.jsx` — lane rendering, note filtering
  - `client/src/components/Card.jsx` — individual card display and interaction
  - `client/src/components/AddNote.jsx` — note input, command interception
  - `client/src/components/PrivateThoughts.jsx` — PT panel, password gate
  - `client/src/styles.css` — all styles
  - `routes/notes.js` — POST/GET/PUT/DELETE for notes
  - `server.js` — Express app, all API routes registered here

# Anchor 3 — Changelog

---

## 2026-04-24 (session 2)

### List view toggle
- New `⊞ Board / ≡ List` toggle in the controls bar
- List view shows all notes grouped by type in a compact 2-column grid
- Each row: `#num`, bold title line, subtitle line, remind indicator, tags (max 2), relative date, hover edit/delete
- Overdue reminders highlighted in red; row has red left border
- Private Thoughts appear as an inline section in list view (floating PT panel hidden while list is active); requires PT to be unlocked in board view first — fetches via the private token in sessionStorage
- Responsive: drops to 1-column below 700px
- New component: `client/src/components/ListView.jsx`
- New CSS namespace: `lv-*`, `view-toggle`, `view-toggle-btn` in `styles.css`

### Edit button → direct edit mode
- Clicking the pencil `✏` button on a card now opens the modal directly in edit mode
- No longer requires a second click on the Edit button inside the modal
- Signal threaded: Card `onClick('edit')` → Lane → App `setModal({ note, edit: true })` → `Modal openInEdit` prop

### DB backup encryption
- `anchor3/scripts/backup.sh` now reads `ENCRYPTION_KEY` from the running container (`docker exec anchor3 printenv ENCRYPTION_KEY`) and encrypts the raw SQLite file with AES-256-CBC via openssl
- No host dependencies beyond `docker`, `openssl`, and `git` — sqlite3 not required anywhere
- Output: `anchor3/backup.sql.enc` committed to GitHub nightly via OMV crontab
- Restore: `openssl enc -d -aes-256-cbc -pbkdf2 -pass env:ENCRYPTION_KEY -in anchor3/backup.sql.enc -out /srv/mergerfs/warehouse/anchor3/data/notes3.db`

### HowToRestore.md
- New file: `anchor3/HowToRestore.md`
- Step-by-step restore procedure: get key from running container, stop container, decrypt, restart, verify
- Includes worst-case scenario table (container gone, key gone, both gone)

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
  - `client/src/components/ListView.jsx` — compact list view, grouped by type
  - `client/src/styles.css` — all styles
  - `routes/notes.js` — POST/GET/PUT/DELETE for notes
  - `server.js` — Express app, all API routes registered here

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
const PORT = 7778;
const DB_PATH = '/data/notes.db';

const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_OPUS  = 'claude-opus-4-5';

const SYNC_NOTE_THRESHOLD  = 20;
const SYNC_TOKEN_THRESHOLD = 10000;
const SYNC_AGE_HOURS       = 24;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Encryption ─────────────────────────────────────────────────
const ENC_KEY_RAW = process.env.ENCRYPTION_KEY;
if (!ENC_KEY_RAW) { console.error('FATAL: ENCRYPTION_KEY not set'); process.exit(1); }
const ENC_KEY = crypto.scryptSync(ENC_KEY_RAW, 'anchor-salt', 32);

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc.toString('hex');
}

function decrypt(text) {
  if (!text) return text;
  try {
    const parts = text.split(':');
    if (parts.length !== 3) return text;
    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex')) + decipher.final('utf8');
  } catch { return text; }
}

// ── Database ───────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'pending',
    raw_input TEXT,
    formatted TEXT,
    tags TEXT,
    open_loops TEXT
  );
  CREATE TABLE IF NOT EXISTS secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
try { db.exec(`ALTER TABLE notes ADD COLUMN status TEXT DEFAULT 'pending'`); } catch {}

// ── API key bootstrap ──────────────────────────────────────────
(function bootstrapApiKey() {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  const existing = db.prepare('SELECT value FROM secrets WHERE key=?').get('anthropic_api_key');
  if (fromEnv) {
    db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run('anthropic_api_key', encrypt(fromEnv));
    console.log('API key encrypted and stored. You can now remove ANTHROPIC_API_KEY from compose.');
  } else if (!existing) {
    console.error('FATAL: No ANTHROPIC_API_KEY in env or DB. Add it to compose for first run.');
    process.exit(1);
  }
})();

function getApiKey() {
  const row = db.prepare('SELECT value FROM secrets WHERE key=?').get('anthropic_api_key');
  if (!row) throw new Error('API key not found');
  return decrypt(row.value);
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── HTML stripper ──────────────────────────────────────────────
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ').trim();
}

// ── URL fetch ──────────────────────────────────────────────────
async function fetchUrl(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Anchor/2.0 (personal note ingester)' } });
  if (!res.ok) throw new Error('Failed to fetch ' + url + ': ' + res.status);
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  return '[URL: ' + url + ']\n' + (ct.includes('text/html') ? stripHtml(text) : text);
}

// ── File text extraction ───────────────────────────────────────
async function extractText(file) {
  const mime = file.mimetype;
  const name = file.originalname.toLowerCase();
  if (mime === 'text/plain' || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
    return file.buffer.toString('utf8');
  }
  if (mime === 'text/html' || name.endsWith('.html') || name.endsWith('.htm')) {
    return stripHtml(file.buffer.toString('utf8'));
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    const data = await pdfParse(file.buffer);
    return data.text;
  }
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value;
  }
  throw new Error('Unsupported file type: ' + file.originalname);
}

// ── Sync helpers ───────────────────────────────────────────────
function getLastSyncTime() {
  const row = db.prepare("SELECT value FROM secrets WHERE key='last_sync'").get();
  return row ? new Date(decrypt(row.value)) : null;
}

function setLastSyncTime() {
  db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('last_sync',?)").run(encrypt(new Date().toISOString()));
}

function getPendingStats() {
  const pending = db.prepare("SELECT id, raw_input FROM notes WHERE status='pending'").all();
  const totalChars = pending.reduce((sum, n) => sum + (decrypt(n.raw_input) || '').length, 0);
  return { count: pending.length, estimatedTokens: Math.ceil(totalChars / 4) };
}

function shouldAutoSync() {
  const { count, estimatedTokens } = getPendingStats();
  if (count >= SYNC_NOTE_THRESHOLD) return true;
  if (estimatedTokens >= SYNC_TOKEN_THRESHOLD) return true;
  const lastSync = getLastSyncTime();
  if (!lastSync) return count > 0;
  const hoursSince = (Date.now() - lastSync.getTime()) / 3600000;
  if (hoursSince >= SYNC_AGE_HOURS && count > 0) return true;
  return false;
}

// ── Smart chat context ─────────────────────────────────────────
function buildChatContext(question) {
  const allNotes = db.prepare("SELECT * FROM notes WHERE status='processed' ORDER BY created_at DESC LIMIT 200").all().map(decryptNote);
  const words = question.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const scored = allNotes.map(n => {
    const text = ((n.formatted || '') + ' ' + (n.tags || '') + ' ' + n.type).toLowerCase();
    const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
    return { ...n, score };
  });
  const relevant = scored.filter(n => n.score > 0).sort((a,b) => b.score - a.score).slice(0, 20);
  const recent   = allNotes.slice(0, 10);
  const merged   = [...new Map([...recent, ...relevant].map(n => [n.id, n])).values()];
  return merged.map(n =>
    '[' + n.created_at + '] (' + n.type + ') ' + n.formatted +
    (n.tags ? ' | tags:' + n.tags : '') +
    (n.open_loops ? ' | open:' + n.open_loops : '')
  ).join('\n');
}

const ALL_TYPES = [
  // Work scope
  'work','work-task','work-decision','work-idea','meeting',
  // Personal scope
  'personal','personal-task','personal-decision',
  'home','home-task','home-decision',
  'kids','kids-task',
  'health','health-task',
  'finance','finance-task',
  'social','calendar','email',
  // Universal
  'pi','idea','random','brain-dump'
];

const WORK_SCOPE_TYPES = ['work','work-task','work-decision','work-idea','meeting','calendar','email'];


// ── Cat shorthand parser ───────────────────────────────────────
const CAT_SHORTHAND = {
  // Work
  'w':'work','wt':'work-task','wd':'work-decision','wi':'work-idea','m':'meeting',
  // Personal
  'p':'personal','pt':'personal-task','pd':'personal-decision',
  // Home
  'ho':'home','ht':'home-task','hod':'home-decision',
  // Kids
  'k':'kids','kt':'kids-task',
  // Health
  'h':'health','hat':'health-task',
  // Finance
  'f':'finance','ft':'finance-task',
  // Universal
  's':'social','c':'calendar','e':'email',
  'i':'idea','pi':'pi','r':'random','bd':'brain-dump'
};

function parseCatDump(raw) {
  // Match lines like "cat p", "cat work", "cat health" etc
  const catLineRe = /^cat\s+(\S+)/i;
  const lines = raw.split('\n');
  const sections = [];
  let current = null;

  for (const line of lines) {
    const match = line.match(catLineRe);
    if (match) {
      if (current && current.lines.length) sections.push(current);
      const key = match[1].toLowerCase();
      const type = CAT_SHORTHAND[key] || (ALL_TYPES.includes(key) ? key : null);
      current = { type: type || 'brain-dump', lines: [] };
    } else {
      if (current) {
        if (line.trim()) current.lines.push(line);
      }
    }
  }
  if (current && current.lines.length) sections.push(current);
  return sections;
}

const TYPE_COLORS = {
  'pending':          '#475569',
  'brain-dump':       '#60a5fa',
  // Work
  'work':             '#38bdf8',
  'work-task':        '#0ea5e9',
  'work-decision':    '#0284c7',
  'work-idea':        '#7dd3fc',
  'meeting':          '#fb923c',
  // Personal
  'personal':         '#e879f9',
  'personal-task':    '#d946ef',
  'personal-decision':'#a21caf',
  // Home
  'home':             '#fdba74',
  'home-task':        '#f97316',
  'home-decision':    '#ea580c',
  // Kids
  'kids':             '#fde68a',
  'kids-task':        '#fbbf24',
  // Health
  'health':           '#f87171',
  'health-task':      '#ef4444',
  // Finance
  'finance':          '#4ade80',
  'finance-task':     '#16a34a',
  // Universal
  'social':           '#86efac',
  'calendar':         '#c084fc',
  'email':            '#67e8f9',
  'idea':             '#a78bfa',
  'pi':               '#fcd34d',
  'random':           '#94a3b8'
};

function typeColor(type) { return TYPE_COLORS[type] || '#60a5fa'; }

function decryptNote(n) {
  return {
    ...n,
    raw_input:  decrypt(n.raw_input),
    formatted:  decrypt(n.formatted),
    tags:       decrypt(n.tags),
    open_loops: decrypt(n.open_loops)
  };
}

function renderNote(n) {
  n = decryptNote(n);
  const color = typeColor(n.type);
  const isPending = n.status === 'pending';
  const isReview = n.status === 'review';
  const typeOpts = ALL_TYPES.map(t => '<option value="' + t + '"' + (t === n.type ? ' selected' : '') + '>' + t + '</option>').join('');
  return `
  <div class="note${isPending ? ' note-pending' : isReview ? ' note-review' : ''}">
    <div class="note-meta">
      <span class="note-type" style="color:${color};border-color:${color}20;background:${color}15">${escapeHtml(n.type)}</span>
      ${isPending ? '<span class="pending-badge">⏳ unsynced</span>' : isReview ? '<span class="review-badge">👁 needs review</span>' : ''}
      <span class="note-date">${new Date(n.created_at).toLocaleString()}</span>
    </div>
    <div class="formatted">${escapeHtml(n.formatted || n.raw_input)}</div>
    ${n.tags && !isPending ? '<div class="note-tags">' + escapeHtml(n.tags).split(',').map(t => '<span class="tag">' + t.trim() + '</span>').join('') + '</div>' : ''}
    ${n.open_loops ? '<div class="note-loops">🔁 ' + escapeHtml(n.open_loops) + '</div>' : ''}
    <div class="note-reclassify">
      <select class="rc-select" onchange="reclassify(${n.id}, this.value)">
        <option value="">↩ reclassify...</option>
        ${typeOpts}
      </select>
      <span class="rc-status" id="rcs-${n.id}"></span>
    </div>
  </div>`;
}


// ── PWA routes ─────────────────────────────────────────────────
const ICON_BUF = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAADNElEQVR4nO3bzUkGQRRE0YnEtTGYjCZnkm4+ERRE8b+d6u46A3f/oOss5zgGfVc3txfpzEZt19i1TUYvPWf8qs/wpd9ASB8sjc74VZ/xqz4AVJ3xqz7jV30AqDoAVJ3xqz4AVB0Aqg4AVQeAqjN+VQeAqgNA1QGg6gBQdQCoOgBUHQCqDgBVB4CqA0DVAaDqlgNwd/9wrblLb2Q7AOkH1b4YpgaQfjztD2FaAOkHUwcCAATAbKUfSj0IABAAs5V+JAFg/KpAAIAAmKn04wgAAAQAAAIAAAEAgAAAQAAAIAAAEAAACAAABAAAAgAAAQCAAABAAAAgAAAQAAAIAAAEAAACAAABAEB76Y0BIAAAEAAACID8EQB0ld4YAAIAAAEAgADIHwFAV+mNASAAABAAAAiA/BGDAVz07wEAQHUAAFAdAABUB8MEADR56Y0BIAAAEAAACID8EQB0ld4YAAIAAAEAgADIHwFAV+mNASAAABAAAAiA/BEAdJXeGAACAAABAIAAyB8BQFfpjQEgAAAQAAAIgPwRgwGkfxhvCAAAqgMAgOoAAKA6ACYGoMlLbwwAAQCAAABAAOSPAKCr9MYAEAAACAAABED+CAC6Sm8MAAEAgAAAQADkjwCgq/TGABAAAAgAAARA/ggAukpvDAABAIAAAEAA5I8YDCD9w/gyP6cDAMDqxccMAAAAAAAAAADMAkCTl94YAAIAAAEAgADIHwFAV+mNASAAABAAAAiA/BEAdJXeGAACAAABAIAAyB8BQFfpjQEgAAAQAAAIgPwRAHSV3hgAAgAAAQCAAMgfAUBX6Y0BIAAAEAAACID8EQB0ld4YAAIAAAEAgADIHwFAV+mNASAAABAAEwKAYO/S2wJAAAAgACYGAMGepTcFgABYBQAEe5Xe0pIAQFi/9Ha2AADDWqU3sjUAaWQAqDoAVB0Aqg4AVQeAqgNA1QGg6gBQdQCoOgBUHQCq7nj60kdIqQBQdQCoOgBUHQCq7nj50odIZ3e8/tLHSGcHgKo73n7pg6Szejd+CNTSh+MHQA19CgAC7dyX44dAu/bt8UOg3frx+EHQDv1p+BBo5YaNHwat0k+3/AhS9zTFq3XEhQAAAABJRU5ErkJggg==', 'base64');

app.get('/apple-touch-icon.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(ICON_BUF);
});

app.get('/icon-192.png', (req, res) => {
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(ICON_BUF);
});

app.get('/manifest.json', (req, res) => {
  res.json({
    name: "Anchor",
    short_name: "Anchor",
    description: "Casmas family memory — focused on Dan",
    start_url: "/",
    display: "standalone",
    background_color: "#0d1117",
    theme_color: "#1e3a5f",
    icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
  });
});

// ── GET / ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const { q, type, tag, sort } = req.query;
  let query = 'SELECT * FROM notes WHERE 1=1';
  const params = [];
  if (q) { query += ' AND (formatted LIKE ? OR raw_input LIKE ? OR tags LIKE ?)'; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
  if (type) { query += ' AND type = ?'; params.push(type); }
  if (tag) { query += ' AND tags LIKE ?'; params.push('%'+tag+'%'); }
  const sortOrders = {
    'newest':     'ORDER BY created_at DESC',
    'oldest':     'ORDER BY created_at ASC',
    'type':       'ORDER BY type ASC, created_at DESC',
    'unsynced':   "ORDER BY (status='pending') DESC, created_at DESC",
    'open-loops': "ORDER BY (open_loops IS NOT NULL AND open_loops != '') DESC, created_at DESC",
    'type-date':  'ORDER BY type ASC, created_at DESC'
  };
  query += ' ' + (sortOrders[sort] || sortOrders['newest']) + ' LIMIT 30';
  const notes = db.prepare(query).all(...params);

  const { count: pendingCount, estimatedTokens: pendingTokens } = getPendingStats();
  const lastSync = getLastSyncTime();
  const lastSyncStr = lastSync ? lastSync.toLocaleString() : 'Never';
  const autoSyncFlag = shouldAutoSync();

  const now = new Date();
  const yearAgo  = new Date(now); yearAgo.setFullYear(now.getFullYear()-1);
  const sixAgo   = new Date(now); sixAgo.setMonth(now.getMonth()-6);
  const monthAgo = new Date(now); monthAgo.setMonth(now.getMonth()-1);
  const getOTD   = d => db.prepare(`SELECT * FROM notes WHERE date(created_at)=? LIMIT 3`).all(d.toISOString().split('T')[0]);
  const yearNotes=getOTD(yearAgo), sixNotes=getOTD(sixAgo), monthNotes=getOTD(monthAgo);
  const hasOTD = yearNotes.length||sixNotes.length||monthNotes.length;

  const TYPE_GROUPS = [
    { label: 'Work', types: ['work','work-task','work-decision','work-idea','meeting'] },
    { label: 'Personal', types: ['personal','personal-task','personal-decision'] },
    { label: 'Home', types: ['home','home-task','home-decision'] },
    { label: 'Kids', types: ['kids','kids-task'] },
    { label: 'Health', types: ['health','health-task'] },
    { label: 'Finance', types: ['finance','finance-task'] },
    { label: 'Universal', types: ['social','calendar','email','idea','pi','random','brain-dump'] },
  ];
  const typeOptions = TYPE_GROUPS.map(g =>
    '<optgroup label="' + g.label + '">' +
    g.types.map(t => '<option value="' + t + '" ' + (type===t?'selected':'') + '>' + t + '</option>').join('') +
    '</optgroup>'
  ).join('\n            ');

  const sortSelected = (val) => sort===val||(!sort&&val==='newest') ? 'selected' : '';

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Anchor</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1e3a5f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Anchor">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='18' fill='%231e3a5f'/><rect x='22' y='20' width='56' height='60' rx='6' fill='%2360a5fa' opacity='.25'/><rect x='22' y='20' width='56' height='60' rx='6' fill='none' stroke='%2360a5fa' stroke-width='4'/><line x1='32' y1='38' x2='68' y2='38' stroke='%2360a5fa' stroke-width='3' stroke-linecap='round'/><line x1='32' y1='50' x2='68' y2='50' stroke='%2360a5fa' stroke-width='3' stroke-linecap='round'/><line x1='32' y1='62' x2='52' y2='62' stroke='%2360a5fa' stroke-width='3' stroke-linecap='round'/></svg>">
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:system-ui,sans-serif; background:#0d1117; color:#e2e8f0; font-size:16px; line-height:1.6; }
    .header { background:linear-gradient(135deg,#1e3a5f 0%,#1a1f35 100%); border-bottom:1px solid #2d4a7a; padding:20px 32px; display:flex; align-items:center; gap:16px; }
    .header-icon { width:48px; height:48px; flex-shrink:0; }
    .header-text { flex:1; }
    .header-text h1 { font-size:1.8rem; font-weight:700; color:#93c5fd; letter-spacing:-0.5px; }
    .header-text p { font-size:0.85rem; color:#64748b; margin-top:2px; }
    .header-time { font-size:0.85rem; color:#e2e8f0; text-align:right; }
    .btn-logout { font-size:0.78rem; color:#475569; text-decoration:none; padding:5px 10px; border:1px solid #1e2d45; border-radius:6px; transition:all .15s; }
    .btn-logout:hover { color:#f87171; border-color:#f87171; }
    .btn-logout { font-size:0.78rem; color:#475569; text-decoration:none; padding:5px 10px; border:1px solid #1e2d45; border-radius:6px; transition:all .15s; }
    .btn-logout:hover { color:#f87171; border-color:#f87171; }
    .main { padding:24px 32px; max-width:1400px; margin:0 auto; display:grid; grid-template-columns:1fr 1fr; gap:24px; }
    @media(max-width:900px){.main{grid-template-columns:1fr;}}
    .panel { background:#161b27; border:1px solid #1e2d45; border-radius:12px; padding:20px; }
    .panel h2 { font-size:1rem; font-weight:600; color:#93c5fd; margin-bottom:14px; display:flex; align-items:center; gap:8px; }
    .panel h2 .dot { width:8px; height:8px; border-radius:50%; background:#3b82f6; flex-shrink:0; }
    .sync-bar { display:flex; align-items:center; gap:12px; padding:10px 14px; background:#0d1117; border:1px solid #1e2d45; border-radius:8px; margin-bottom:14px; flex-wrap:wrap; }
    .sync-count { font-size:0.85rem; color:#94a3b8; }
    .sync-count strong { color:#f59e0b; }
    .sync-auto { font-size:0.75rem; color:#f59e0b; background:#292208; padding:2px 8px; border-radius:20px; border:1px solid #f59e0b40; }
    .sync-last { font-size:0.75rem; color:#475569; margin-left:auto; }
    .btn-sync { background:#f59e0b; color:#0d1117; font-weight:700; font-size:0.85rem; padding:6px 16px; border:none; border-radius:6px; cursor:pointer; transition:all .15s; }
    .btn-sync:hover { background:#fbbf24; }
    .btn-sync:disabled { opacity:.4; cursor:not-allowed; }
    textarea { width:100%; height:130px; background:#0d1117; color:#e2e8f0; border:1px solid #2d4a7a; border-radius:8px; padding:12px; font-size:1rem; resize:vertical; font-family:inherit; transition:border .2s; }
    textarea:focus { outline:none; border-color:#60a5fa; }
    input[type=text] { background:#0d1117; color:#e2e8f0; border:1px solid #2d4a7a; border-radius:8px; padding:8px 12px; font-size:0.95rem; font-family:inherit; transition:border .2s; }
    input[type=text]:focus { outline:none; border-color:#60a5fa; }
    select { background:#0d1117; color:#e2e8f0; border:1px solid #2d4a7a; border-radius:8px; padding:8px 12px; font-size:0.95rem; }
    .btn { padding:9px 20px; border:none; border-radius:8px; font-size:0.95rem; font-weight:600; cursor:pointer; transition:all .15s; }
    .btn-primary { background:#2563eb; color:#fff; }
    .btn-primary:hover { background:#3b82f6; }
    .btn-mic { background:#1e2d45; color:#93c5fd; border:1px solid #2d4a7a; display:flex; align-items:center; gap:6px; font-size:0.9rem; }
    .btn-mic:hover { background:#243447; }
    .btn-mic.listening { background:#7c3aed; color:#fff; border-color:#7c3aed; animation:pulse 1.2s infinite; }
    .btn-secondary { background:#1e2d45; color:#93c5fd; border:1px solid #2d4a7a; }
    .btn-secondary:hover { background:#243447; }
    .btn-opus { background:#1e1a35; color:#a78bfa; border:1px solid #a78bfa40; font-size:0.82rem; padding:6px 14px; border-radius:8px; cursor:pointer; transition:all .15s; font-weight:600; }
    .btn-opus:hover { background:#2d2550; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.7} }
    .btn-row { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; align-items:center; }
    .file-row { display:flex; align-items:center; gap:8px; margin-top:10px; flex-wrap:wrap; }
    .file-label { display:inline-flex; align-items:center; gap:6px; background:#1e2d45; color:#93c5fd; border:1px dashed #2d4a7a; border-radius:8px; padding:7px 14px; font-size:0.88rem; cursor:pointer; transition:all .15s; }
    .file-label:hover { background:#243447; border-color:#60a5fa; }
    .file-name { font-size:0.82rem; color:#4ade80; }
    .btn-clear-file { background:none; border:none; color:#475569; cursor:pointer; font-size:0.9rem; padding:2px 6px; }
    .btn-clear-file:hover { color:#f87171; }
    .status { font-size:0.85rem; color:#4ade80; margin-top:6px; min-height:20px; }
    .loading { font-size:0.85rem; color:#60a5fa; display:none; }
    .search-row { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
    .search-row input { flex:1; min-width:140px; }
    .notes-list { max-height:560px; overflow-y:auto; padding-right:4px; }
    .notes-list::-webkit-scrollbar { width:4px; }
    .notes-list::-webkit-scrollbar-track { background:#0d1117; }
    .notes-list::-webkit-scrollbar-thumb { background:#2d4a7a; border-radius:4px; }
    .note { background:#0d1117; border:1px solid #1e2d45; border-radius:10px; padding:16px; margin-bottom:12px; transition:border .15s; }
    .note:hover { border-color:#2d4a7a; }
    .note-pending { border-color:#f59e0b30; background:#1a1500; }
    .note-review { border-color:#f4723080; background:#1a0f00; }
    .review-badge { font-size:0.7rem; color:#f97316; background:#1f1100; padding:2px 7px; border-radius:20px; border:1px solid #f9731630; }
    .note-meta { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
    .note-type { font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.5px; padding:3px 8px; border-radius:20px; border:1px solid; }
    .pending-badge { font-size:0.7rem; color:#f59e0b; background:#292208; padding:2px 7px; border-radius:20px; border:1px solid #f59e0b30; }
    .note-date { font-size:0.78rem; color:#475569; }
    .formatted { white-space:pre-wrap; font-size:0.95rem; line-height:1.7; color:#cbd5e1; }
    .note-tags { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
    .tag { font-size:0.75rem; background:#1e3a5f; color:#93c5fd; padding:2px 8px; border-radius:20px; }
    .note-loops { margin-top:8px; font-size:0.88rem; color:#fbbf24; background:#292208; padding:8px 12px; border-radius:6px; border-left:3px solid #fbbf24; }
    .note-reclassify { margin-top:8px; display:flex; align-items:center; gap:8px; }
    .rc-select { background:#0d1117; color:#475569; border:1px solid #1e2d45; border-radius:6px; padding:3px 8px; font-size:0.78rem; cursor:pointer; }
    .rc-select:hover { border-color:#2d4a7a; color:#94a3b8; }
    .rc-status { font-size:0.75rem; color:#4ade80; }
    .chat-messages { max-height:380px; overflow-y:auto; margin-bottom:14px; display:flex; flex-direction:column; gap:10px; }
    .msg { padding:10px 14px; border-radius:10px; font-size:0.92rem; line-height:1.6; max-width:92%; }
    .msg.user { background:#1e3a5f; color:#bfdbfe; align-self:flex-end; }
    .msg.ai { background:#1a2232; color:#e2e8f0; align-self:flex-start; border-left:3px solid #3b82f6; }
    .msg.ai.opus { border-left-color:#a78bfa; }
    .chat-input-row { display:flex; gap:8px; }
    .chat-input-row input { flex:1; }
    .chat-model-row { display:flex; align-items:center; gap:8px; margin-top:8px; }
    .model-label { font-size:0.75rem; color:#475569; }
    .otd-label { font-size:0.75rem; color:#475569; text-transform:uppercase; letter-spacing:.5px; margin-bottom:8px; margin-top:14px; }
    .empty { color:#334155; font-size:0.9rem; padding:20px; text-align:center; }
    .panel h2 { cursor:pointer; user-select:none; }
    .panel h2:hover { color:#bfdbfe; }
    .panel h2 .chevron { margin-left:auto; font-size:0.75rem; color:#475569; transition:transform .2s; }
    .panel h2 .chevron.open { transform:rotate(180deg); }
    .panel-body { }
    .panel-body.collapsed { display:none; }
  </style>
</head>
<body>
  <div class="header">
    <svg class="header-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#1e3a5f"/>
      <rect x="10" y="8" width="28" height="34" rx="4" fill="#0d1117" stroke="#2d4a7a" stroke-width="1.5"/>
      <rect x="10" y="8" width="6" height="34" rx="4" fill="#1e2d45"/>
      <line x1="20" y1="17" x2="33" y2="17" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="23" x2="33" y2="23" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="29" x2="28" y2="29" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" opacity=".6"/>
      <circle cx="13" cy="16" r="1.5" fill="#3b82f6"/>
      <circle cx="13" cy="22" r="1.5" fill="#3b82f6"/>
      <circle cx="13" cy="28" r="1.5" fill="#3b82f6"/>
    </svg>
    <div class="header-text">
      <h1>Anchor</h1>
      <p>Casmas family memory — focused on Dan</p>
    </div>
    <div class="header-time" id="headerTime"></div>
${req.headers["cf-access-authenticated-user-email"] ? '<a href="/cdn-cgi/access/logout" class="btn-logout">Sign out</a>' : ""}
  </div>

  <div class="main">
    <div style="display:flex;flex-direction:column;gap:20px;">

      <div class="panel">
        <h2><span class="dot"></span>Add Note</h2>
        <textarea id="input" placeholder="Brain dump here. Don't think about format. Just type. Or paste a URL to ingest it."></textarea>
        <div class="file-row">
          <label class="file-label">
            📎 Attach file
            <input type="file" id="fileInput" accept=".txt,.md,.csv,.pdf,.docx,.html,.htm" onchange="fileSelected(this)" style="display:none">
          </label>
          <span class="file-name" id="fileName"></span>
          <button class="btn-clear-file" id="clearFile" onclick="clearFileInput()" style="display:none">✕</button>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="submitNote()">Add Note</button>
          <button class="btn btn-mic" id="micBtn" onclick="toggleMic()">🎤 Mic</button>
        </div>
        <div class="status" id="noteStatus"></div>
      </div>

      <div class="panel">
        <h2 onclick="togglePanel('syncBody','syncChev')"><span class="dot" style="background:#f59e0b"></span>Sync Queue<span class="chevron" id="syncChev">▼</span></h2>
        <div class="panel-body collapsed" id="syncBody"><div class="sync-bar">
          <span class="sync-count"><strong id="pendingCount">${pendingCount}</strong> notes pending (~${pendingTokens} tokens)</span>
          ${autoSyncFlag ? '<span class="sync-auto">⚡ auto-sync recommended</span>' : ''}
          <span class="sync-last">Last sync: ${lastSyncStr}</span>
          <button class="btn btn-sync" id="syncBtn" onclick="runSync()" ${pendingCount===0?'disabled':''}>Sync Now</button>
        </div>
        <div class="status" id="syncStatus"></div>
        <div class="loading" id="syncLoading">⏳ Classifying with Haiku...</div>
        </div></div>

      <div class="panel">
        <h2 onclick="togglePanel('notesBody','notesChev')"><span class="dot" style="background:#34d399"></span>Notes<span class="chevron" id="notesChev">▼</span></h2>
        <div class="panel-body collapsed" id="notesBody"><div class="search-row">
          <input type="text" id="searchQ" placeholder="Search your notes..." value="${escapeHtml(q||'')}">
          <select id="searchType">
            <option value="">All types</option>
            ${typeOptions}
          </select>
          <select id="sortOrder">
            <option value="newest" ${sortSelected('newest')}>Newest first</option>
            <option value="oldest" ${sortSelected('oldest')}>Oldest first</option>
            <option value="type" ${sortSelected('type')}>By category</option>
            <option value="unsynced" ${sortSelected('unsynced')}>Unsynced first</option>
            <option value="open-loops" ${sortSelected('open-loops')}>Open loops first</option>
            <option value="type-date" ${sortSelected('type-date')}>Category + date</option>
          </select>
          <button class="btn btn-secondary" onclick="applySearch()">Search</button>
        </div>
        <div class="notes-list">
          ${notes.length ? notes.map(renderNote).join('') : '<div class="empty">No notes yet — add your first brain dump above.</div>'}
        </div>
        </div></div>
    </div>

    <div style="display:flex;flex-direction:column;gap:20px;">
      <div class="panel">
        <h2 onclick="togglePanel('chatBody','chatChev')"><span class="dot" style="background:#a78bfa"></span>Ask Anchor<span class="chevron" id="chatChev">▼</span></h2>
        <div class="panel-body collapsed" id="chatBody"><div class="chat-messages" id="chatMessages">
          <div class="msg ai">Ask me anything about your notes — open loops, decisions, patterns, what you've been putting off.</div>
        </div>
        <div class="chat-input-row">
          <input type="text" id="chatInput" placeholder="What are my open loops this week?">
          <button class="btn btn-primary" onclick="sendChat('haiku')">Ask</button>
        </div>
        <div class="chat-model-row">
          <span class="model-label">Need deeper analysis?</span>
          <button class="btn btn-opus" onclick="sendChat('opus')">⚡ Ask Opus</button>
        </div>
        <div class="loading" id="chatLoading" style="margin-top:8px;">⏳ Reading your notes...</div>
        </div></div>

      ${hasOTD ? `
      <div class="panel">
        <h2><span class="dot" style="background:#fb923c"></span>🕰 On This Day</h2>
        ${yearNotes.length ? '<div class="otd-label">1 year ago</div>' + yearNotes.map(renderNote).join('') : ''}
        ${sixNotes.length ? '<div class="otd-label">6 months ago</div>' + sixNotes.map(renderNote).join('') : ''}
        ${monthNotes.length ? '<div class="otd-label">1 month ago</div>' + monthNotes.map(renderNote).join('') : ''}
      </div>` : ''}
    </div>
  </div>

  <script>
    function updateClock() {
      document.getElementById('headerTime').textContent = new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});
    }
    updateClock(); setInterval(updateClock, 30000);

    function fileSelected(input) {
      const name = input.files[0] ? input.files[0].name : '';
      document.getElementById('fileName').textContent = name;
      document.getElementById('clearFile').style.display = name ? 'inline' : 'none';
    }
    function clearFileInput() {
      document.getElementById('fileInput').value = '';
      document.getElementById('fileName').textContent = '';
      document.getElementById('clearFile').style.display = 'none';
    }

    async function submitNote() {
      const input = document.getElementById('input').value.trim();
      const fileInput = document.getElementById('fileInput');
      const file = fileInput.files[0];
      if (!input && !file) return;
      document.getElementById('noteStatus').textContent = file ? '⏳ Reading file...' : '';
      try {
        const fd = new FormData();
        if (input) fd.append('raw', input);
        if (file) fd.append('file', file);
        const res = await fetch('/note', { method:'POST', body: fd });
        const data = await res.json();
        if (data.ok) {
          document.getElementById('input').value = '';
          clearFileInput();
          const msg = data.split > 1 ? '✓ Split into ' + data.split + ' notes' : '✓ Saved — sync when ready';
          // (split/flagged handled on sync result)
          document.getElementById('noteStatus').textContent = msg;
          document.getElementById('pendingCount').textContent = data.pendingCount;
          if (data.pendingCount > 0) document.getElementById('syncBtn').disabled = false;
          setTimeout(() => { document.getElementById('noteStatus').textContent = ''; }, 2000);
          setTimeout(() => location.reload(), 600);
        } else {
          document.getElementById('noteStatus').textContent = '✗ ' + (data.error || 'Failed');
        }
      } catch(e) { document.getElementById('noteStatus').textContent = '✗ Failed'; }
    }

    async function runSync() {
      const btn = document.getElementById('syncBtn');
      btn.disabled = true;
      document.getElementById('syncLoading').style.display = 'block';
      document.getElementById('syncStatus').textContent = '';
      try {
        const res = await fetch('/sync', {method:'POST'});
        const data = await res.json();
        if (data.ok) {
          let syncMsg = '✓ Synced ' + data.processed + ' notes';
          if (data.splits > 0) syncMsg += ', split ' + data.splits;
          if (data.flagged > 0) syncMsg += ', ' + data.flagged + ' flagged for review';
          if (data.proposed && data.proposed.length > 0) syncMsg += ', ' + data.proposed.length + ' new category proposed';
          document.getElementById('syncStatus').textContent = syncMsg;
          setTimeout(() => location.reload(), 1000);
        } else {
          document.getElementById('syncStatus').textContent = '✗ ' + (data.error || 'Sync failed');
          btn.disabled = false;
        }
      } catch(e) { document.getElementById('syncStatus').textContent = '✗ Sync failed'; btn.disabled = false; }
      document.getElementById('syncLoading').style.display = 'none';
    }

    let recognition = null;
    function toggleMic() {
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) { alert('Use Chrome for voice input.'); return; }
      const btn = document.getElementById('micBtn');
      if (recognition) { recognition.stop(); recognition = null; btn.classList.remove('listening'); btn.textContent = '🎤 Mic'; return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR(); recognition.continuous = true; recognition.interimResults = false; recognition.lang = 'en-US';
      recognition.onresult = e => { const t = Array.from(e.results).map(r => r[0].transcript).join(' '); const inp = document.getElementById('input'); inp.value += (inp.value ? ' ' : '') + t; };
      recognition.onend = () => { btn.classList.remove('listening'); btn.innerHTML = '🎤 Mic'; recognition = null; };
      recognition.start(); btn.classList.add('listening'); btn.innerHTML = '🔴 Listening...';
    }

    function applySearch() {
      const q = document.getElementById('searchQ').value;
      const type = document.getElementById('searchType').value;
      const sort = document.getElementById('sortOrder').value;
      const p = new URLSearchParams();
      if (q) p.set('q', q); if (type) p.set('type', type); if (sort) p.set('sort', sort);
      window.location.href = '/?' + p.toString();
    }
    document.getElementById('searchQ').addEventListener('keydown', e => { if (e.key === 'Enter') applySearch(); });

    async function sendChat(model) {
      const input = document.getElementById('chatInput').value.trim();
      if (!input) return;
      const msgs = document.getElementById('chatMessages');
      msgs.innerHTML += '<div class="msg user">' + input + '</div>';
      document.getElementById('chatInput').value = '';
      document.getElementById('chatLoading').style.display = 'block';
      msgs.scrollTop = msgs.scrollHeight;
      try {
        const res = await fetch('/chat', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({question:input, model, clientTime:new Date().toString()})});
        const data = await res.json();
        const cls = model === 'opus' ? 'msg ai opus' : 'msg ai';
        const label = model === 'opus' ? ' <span style="font-size:0.7rem;color:#a78bfa;margin-left:6px;">⚡ Opus</span>' : '';
        msgs.innerHTML += '<div class="' + cls + '">' + data.answer + label + '</div>';
      } catch(e) { msgs.innerHTML += '<div class="msg ai">Error — could not reach Claude.</div>'; }
      document.getElementById('chatLoading').style.display = 'none';
      msgs.scrollTop = msgs.scrollHeight;
    }
    document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat('haiku'); });

    function isLocal() {
      const h = window.location.hostname;
      return h === 'localhost' || h.startsWith('192.168.') || h.startsWith('10.') || h.startsWith('172.');
    }

    function togglePanel(bodyId, chevId) {
      const body = document.getElementById(bodyId);
      const chev = document.getElementById(chevId);
      const isCollapsed = body.classList.contains('collapsed');
      body.classList.toggle('collapsed', !isCollapsed);
      chev.classList.toggle('open', isCollapsed);
    }

    if (isLocal()) {
      ['syncBody','notesBody','chatBody'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('collapsed');
      });
      ['syncChev','notesChev','chatChev'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('open');
      });
    }

    async function reclassify(id, type) {
      if (!type) return;
      const status = document.getElementById('rcs-' + id);
      status.textContent = '...';
      try {
        const res = await fetch('/reclassify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, type})});
        const data = await res.json();
        if (data.ok) { status.textContent = '✓'; setTimeout(() => location.reload(), 600); }
        else { status.textContent = '✗'; }
      } catch(e) { status.textContent = '✗'; }
    }
  </script>
</body>
</html>`);
});

// ── POST /note ─────────────────────────────────────────────────
app.post('/note', upload.single('file'), async (req, res) => {
  try {
    let raw = (req.body.raw || '').trim();
    if (req.file) {
      const extracted = await extractText(req.file);
      const fileNote = '[File: ' + req.file.originalname + ']\n' + extracted.trim();
      raw = raw ? raw + '\n\n' + fileNote : fileNote;
    }
    const urlMatch = raw.match(/^(https?:\/\/\S+)$/);
    if (urlMatch) {
      raw = await fetchUrl(urlMatch[1]);
    }
    if (!raw) return res.json({ ok:false, error:'No input' });

    // Check for cat markup — split into multiple pre-classified notes
    const catSections = parseCatDump(raw);
    if (catSections.length > 0) {
      const insert = db.prepare(`INSERT INTO notes (type,status,raw_input,formatted) VALUES (?,?,?,?)`);
      db.transaction((sections) => {
        for (const s of sections) {
          const text = s.lines.join('\n').trim();
          insert.run(s.type, 'processed', encrypt(text), encrypt(text));
        }
      })(catSections);
      const { count } = getPendingStats();
      return res.json({ ok:true, pendingCount: count, split: catSections.length });
    }

    // No cat markup — save as pending for Haiku to classify
    db.prepare(`INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)`)
      .run(encrypt(raw), encrypt(raw));
    const { count } = getPendingStats();
    res.json({ ok:true, pendingCount: count });
  } catch(e) {
    console.error('Note error:', e);
    res.json({ ok:false, error: e.message });
  }
});

// ── POST /sync — split + flag engine ──────────────────────────
app.post('/sync', async (req, res) => {
  const pending = db.prepare("SELECT id, raw_input FROM notes WHERE status='pending'").all();
  if (!pending.length) return res.json({ ok:true, processed:0 });
  const decrypted = pending.map(n => ({ id: n.id, text: decrypt(n.raw_input) }));

  // Pull classification guide from DB
  const guideRow = db.prepare("SELECT formatted FROM notes WHERE type='pi' AND formatted LIKE '%Classification Guide%' ORDER BY created_at DESC LIMIT 1").get();
  const guide = guideRow ? decrypt(guideRow.formatted) : '';

  const SYSTEM = `You are Anchor, a personal AI organizer for Dan Casmas.

${guide ? 'CLASSIFICATION GUIDE:\n' + guide : ''}

Your job: classify and structure each note. If a note contains multiple distinct topics, SPLIT it into separate notes.

For each input note return one OR MORE result objects. Each object must have:
- source_id: the original note id (integer, unchanged)
- type: one of the valid categories from the guide above
- formatted: clean plain text for this specific topic only
- tags: 3-5 comma-separated keywords
- open_loops: unresolved actions or empty string
- uncertain: true if you are not confident in the classification, false otherwise
- proposed_type: if no existing category fits well, suggest a new one here (otherwise null)

Return ONLY a valid JSON array of result objects. No markdown, no backticks, no explanation.`;

  try {
    const apiKey = getApiKey();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: MODEL_HAIKU, max_tokens: 8192,
        system: SYSTEM,
        messages: [{ role:'user', content: 'Process these notes:\n' + JSON.stringify(decrypted) }]
      })
    });
    const data = await response.json();
    const rawText = data.content[0].text.replace(/```json|```/g,'').trim();
    const results = JSON.parse(rawText);

    const insert = db.prepare('INSERT INTO notes (type,status,raw_input,formatted,tags,open_loops) VALUES (?,?,?,?,?,?)');
    const update = db.prepare("UPDATE notes SET status='processed' WHERE id=?");
    const flag   = db.prepare("UPDATE notes SET status='review', type='brain-dump' WHERE id=?");

    const proposed = [];

    db.transaction((items) => {
      const seen = new Set();
      for (const item of items) {
        // Track proposed new categories
        if (item.proposed_type) {
          proposed.push({ source_id: item.source_id, proposed_type: item.proposed_type, formatted: item.formatted });
        }
        // Flag uncertain notes for review
        if (item.uncertain) {
          if (!seen.has(item.source_id)) { flag.run(item.source_id); seen.add(item.source_id); }
          continue;
        }
        // First result for this source_id updates the original note
        if (!seen.has(item.source_id)) {
          db.prepare("UPDATE notes SET type=?,status='processed',formatted=?,tags=?,open_loops=? WHERE id=?")
            .run(item.type, encrypt(item.formatted), encrypt(item.tags||''), encrypt(item.open_loops||''), item.source_id);
          seen.add(item.source_id);
        } else {
          // Additional splits become new notes
          insert.run(item.type, 'processed', encrypt(item.formatted), encrypt(item.formatted), encrypt(item.tags||''), encrypt(item.open_loops||''));
        }
      }
    })(results);

    setLastSyncTime();

    const processed = results.filter(r => !r.uncertain).length;
    const flagged   = results.filter(r => r.uncertain).length;
    const splits    = results.length - pending.length;

    res.json({ ok:true, processed, flagged, splits: Math.max(0, splits), proposed });
  } catch(e) {
    console.error('Sync error:', e);
    res.json({ ok:false, error: e.message });
  }
});

// ── POST /chat ─────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { question, model, clientTime } = req.body;
  if (!question) return res.json({ answer:'No question provided.' });
  try {
    const apiKey = getApiKey();
    const notesText = buildChatContext(question);
    const selectedModel = model === 'opus' ? MODEL_OPUS : MODEL_HAIKU;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({
        model: selectedModel, max_tokens: 1000,
        messages: [{ role:'user', content: 'You are Anchor, Dan\'s personal AI assistant. Answer directly. Flag anything vague or unresolved. Be honest if something needs attention.\n\nCurrent time: ' + (clientTime || new Date().toLocaleString()) + '\n\nNOTES:\n' + notesText + '\n\nQUESTION: ' + question }]
      })
    });
    const data = await response.json();
    res.json({ answer: data.content[0].text });
  } catch(e) {
    console.error(e);
    res.json({ answer:'Error reaching Claude.' });
  }
});

// ── POST /reclassify ───────────────────────────────────────────
app.post('/reclassify', (req, res) => {
  const { id, type } = req.body;
  if (!id || !ALL_TYPES.includes(type)) return res.json({ ok:false, error:'Invalid' });
  db.prepare('UPDATE notes SET type=? WHERE id=?').run(type, id);
  res.json({ ok:true });
});


// ── MCP internal routes (called by anchor-mcp only) ───────────
function isMcpRequest(req) {
  return req.headers['x-mcp-caller'] !== undefined;
}

function filterForCaller(notes, caller) {
  if (caller === 'work') return notes.filter(n => WORK_SCOPE_TYPES.includes(n.type));
  return notes;
}

app.post('/mcp/notes', (req, res) => {
  if (!isMcpRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  const { type, limit = 20, sort = 'newest', caller } = req.body;
  const sortOrders = {
    'newest': 'ORDER BY created_at DESC',
    'oldest': 'ORDER BY created_at ASC',
    'open-loops': "ORDER BY (open_loops IS NOT NULL AND open_loops != '') DESC, created_at DESC"
  };
  let query = "SELECT * FROM notes WHERE status='processed'";
  const params = [];
  if (type) { query += ' AND type = ?'; params.push(type); }
  query += ' ' + (sortOrders[sort] || sortOrders['newest']) + ' LIMIT ?';
  params.push(limit);
  const notes = db.prepare(query).all(...params).map(decryptNote);
  const filtered = filterForCaller(notes, caller);
  res.json({ notes: filtered, count: filtered.length, caller });
});

app.post('/mcp/search', (req, res) => {
  if (!isMcpRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  const { query, caller } = req.body;
  if (!query) return res.json({ notes: [], count: 0 });
  const notes = db.prepare(
    "SELECT * FROM notes WHERE status='processed' AND (formatted LIKE ? OR tags LIKE ? OR raw_input LIKE ?) ORDER BY created_at DESC LIMIT 30"
  ).all('%'+query+'%','%'+query+'%','%'+query+'%').map(decryptNote);
  const filtered = filterForCaller(notes, caller);
  res.json({ notes: filtered, count: filtered.length, query, caller });
});

app.post('/mcp/open-loops', (req, res) => {
  if (!isMcpRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  const { caller } = req.body;
  const notes = db.prepare(
    "SELECT * FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops != '' ORDER BY created_at DESC"
  ).all().map(decryptNote);
  const filtered = filterForCaller(notes, caller);
  res.json({ notes: filtered, count: filtered.length, caller });
});

app.post('/mcp/summary', (req, res) => {
  if (!isMcpRequest(req)) return res.status(403).json({ error: 'Forbidden' });
  const { days = 7, caller } = req.body;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const notes = db.prepare(
    "SELECT * FROM notes WHERE status='processed' AND created_at >= ? ORDER BY created_at DESC"
  ).all(since.toISOString()).map(decryptNote);
  const filtered = filterForCaller(notes, caller);
  const byType = {};
  for (const n of filtered) {
    byType[n.type] = (byType[n.type] || 0) + 1;
  }
  res.json({ notes: filtered, count: filtered.length, byType, days, caller });
});

app.listen(PORT, () => console.log(`anchor running on port ${PORT}`));

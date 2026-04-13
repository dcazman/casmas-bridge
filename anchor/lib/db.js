'use strict';
const Database = require('better-sqlite3');
const { encrypt, decrypt } = require('./crypto');

const DB_PATH = '/data/notes.db';
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'pending',
    raw_input TEXT, formatted TEXT, tags TEXT, open_loops TEXT
  );
  CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
    model TEXT, operation TEXT
  );
`);

// Safe migrations — each is a no-op if column already exists
[
  `ALTER TABLE notes ADD COLUMN status TEXT DEFAULT 'pending'`,
  `ALTER TABLE notes ADD COLUMN remind_at DATETIME DEFAULT NULL`,
  `ALTER TABLE notes ADD COLUMN remind_sent INTEGER DEFAULT 0`,
  `ALTER TABLE notes ADD COLUMN remind_num INTEGER DEFAULT NULL`,
  `ALTER TABLE notes ADD COLUMN loop_num INTEGER DEFAULT NULL`,
].forEach(sql => { try { db.exec(sql); } catch {} });

// ── Backfill loop_num for pre-feature open-loop notes ─────────
(function backfillLoopNums() {
  try {
    const unnumbered = db.prepare(
      "SELECT id FROM notes WHERE type='open-loop' AND loop_num IS NULL ORDER BY created_at ASC"
    ).all();
    if (!unnumbered.length) return;
    const row = db.prepare("SELECT value FROM secrets WHERE key='loop_counter'").get();
    let counter = row ? parseInt(row.value) : 0;
    for (const note of unnumbered) {
      counter++;
      db.prepare('UPDATE notes SET loop_num=? WHERE id=?').run(counter, note.id);
    }
    db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('loop_counter',?)").run(String(counter));
    console.log(`[db] backfilled loop_num for ${unnumbered.length} open-loop note(s)`);
  } catch (e) { console.error('[db] loop_num backfill error:', e.message); }
})();

// ── API key bootstrap ──────────────────────────────────────────
(function bootstrap() {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  const existing = db.prepare('SELECT value FROM secrets WHERE key=?').get('anthropic_api_key');
  if (fromEnv) {
    db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run('anthropic_api_key', encrypt(fromEnv));
    console.log('API key stored.');
  } else if (!existing) { console.error('FATAL: No ANTHROPIC_API_KEY'); process.exit(1); }
})();

function getApiKey() {
  const r = db.prepare('SELECT value FROM secrets WHERE key=?').get('anthropic_api_key');
  if (!r) throw new Error('API key not found');
  return decrypt(r.value);
}

// ── Note helpers ───────────────────────────────────────────────
function decryptNote(n) {
  return { ...n, raw_input: decrypt(n.raw_input), formatted: decrypt(n.formatted), tags: decrypt(n.tags), open_loops: decrypt(n.open_loops) };
}

function getPending() {
  const p = db.prepare("SELECT id,raw_input FROM notes WHERE status='pending'").all();
  const chars = p.reduce((s,n) => s + (decrypt(n.raw_input)||'').length, 0);
  return { count: p.length, estimatedTokens: Math.ceil(chars/4) };
}

function getLastSync() {
  const r = db.prepare("SELECT value FROM secrets WHERE key='last_sync'").get();
  return r ? new Date(decrypt(r.value)) : null;
}

function setLastSync() {
  db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('last_sync',?)").run(encrypt(new Date().toISOString()));
}

function shouldSync() {
  const { count, estimatedTokens } = getPending();
  if (count >= 20 || estimatedTokens >= 10000) return true;
  const last = getLastSync(); if (!last) return count > 0;
  return (Date.now() - last.getTime()) / 3600000 >= 24 && count > 0;
}

function chatContext(question) {
  const all = db.prepare("SELECT * FROM notes WHERE status='processed' ORDER BY created_at DESC LIMIT 200").all().map(decryptNote);
  const words = question.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const scored = all.map(n => ({ ...n, score: words.reduce((s,w) => s + ((n.formatted||'').toLowerCase().includes(w) ? 1 : 0), 0) }));
  const rel = scored.filter(n => n.score > 0).sort((a,b) => b.score - a.score).slice(0, 20);
  const merged = [...new Map([...all.slice(0,10), ...rel].map(n => [n.id, n])).values()];
  return merged.map(n => '['+n.created_at+'] ('+n.type+') '+n.formatted+(n.tags?' |tags:'+n.tags:'')+(n.open_loops?' |open:'+n.open_loops:'')).join('\n');
}

module.exports = { db, getApiKey, decryptNote, getPending, getLastSync, setLastSync, shouldSync, chatContext };

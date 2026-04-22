'use strict';
const express = require('express');
const path    = require('path');
const { exec } = require('child_process');
const app  = express();
const PORT = 7779;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/files', express.static('/attachments'));

const notesRouter = require('./routes/notes');
const syncRouter  = require('./routes/sync');
const chatRouter  = require('./routes/chat');
const groomRouter = require('./routes/groom');

app.use('/api/notes', notesRouter);
app.use('/api/note',  notesRouter);
app.use('/api/sync',  syncRouter);
app.use('/api/chat',  chatRouter);
app.use('/api/groom', groomRouter);

app.get('/api/status', (req, res) => {
  const { getPending, getLastSync, shouldSync } = require('./lib/db');
  const { count } = getPending();
  const ls = getLastSync();
  const useOllama = process.env.USE_OLLAMA === 'true';
  res.json({ ok: true, pending: count, lastSync: ls, autoSync: shouldSync(), engine: useOllama ? 'rooster' : 'claude' });
});

app.post('/api/reclassify', (req, res) => {
  const { id, type } = req.body;
  const { ALL_TYPES } = require('./lib/helpers');
  const { db, decryptNote } = require('./lib/db');
  const { encrypt } = require('./lib/crypto');
  if (!id || !type) return res.json({ ok: false, error: 'Missing id or type' });
  if (!ALL_TYPES.includes(type)) return res.json({ ok: false, error: 'Unknown type: ' + type });
  try {
    if (type === 'remind') {
      const { parseReminderDate, parseRemindLine, nextRemindNum } = require('./lib/remind');
      const note = decryptNote(db.prepare('SELECT * FROM notes WHERE id=?').get(id));
      const content = note ? (note.formatted || note.raw_input || '') : '';
      const firstLine = content.split('\n')[0].trim();
      const { dateStr } = parseRemindLine(firstLine);
      const remindAt = parseReminderDate(dateStr).toISOString();
      const num = nextRemindNum();
      db.prepare("UPDATE notes SET type=?, status='processed', remind_at=?, remind_num=? WHERE id=?").run(type, remindAt, num, id);
    } else {
      db.prepare("UPDATE notes SET type=?, status='processed' WHERE id=?").run(type, id);
    }
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/remind-cmd', (req, res) => {
  const { cmd, num, when } = req.body;
  if (!cmd || num == null) return res.json({ ok: false, error: 'Missing cmd or num' });
  try {
    const { processCommands, parseReminderDate } = require('./lib/remind');
    // snooze-to with a 'when' goes direct — bypasses processCommands which splits on commas
    // and would break inputs like "Friday, 2pm"
    if (cmd === 'snooze' && when) {
      const { db } = require('./lib/db');
      const note = db.prepare('SELECT * FROM notes WHERE remind_num=?').get(num);
      if (!note) return res.json({ ok: false, error: 'not found' });
      const newDate = parseReminderDate(when).toISOString();
      db.prepare('UPDATE notes SET remind_at=?, remind_sent=0 WHERE id=?').run(newDate, note.id);
      return res.json({ ok: true, results: [{ cmd: 'snooze', num, ok: true, newDate }] });
    }
    let text;
    if (cmd === 'done')   text = `done ${num}`;
    if (cmd === 'snooze') text = `snooze ${num}`;
    if (!text) return res.json({ ok: false, error: 'Unknown cmd' });
    const results = processCommands(text);
    res.json({ ok: true, results });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/alert', async (req, res) => {
  try {
    const { buildDigestEmail } = require('./lib/remind');
    const { sendEmail } = require('./lib/email');
    const { subject, body } = await buildDigestEmail();
    const r = await sendEmail(subject, body);
    res.json(r);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/rebuild', (req, res) => {
  try {
    require('fs').writeFileSync('/data/rebuild-trigger', Date.now().toString());
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ── Private Thoughts ─────────────────────────────────────────────────────────
const pt = require('./lib/private');

app.get('/api/private/status', (req, res) => {
  const token = req.headers['x-pt-token'];
  const session = pt.validate(token);
  res.json({ ok: true, hasPassword: pt.hasPassword(), unlocked: !!session, aiEnabled: session?.aiEnabled || false });
});

app.post('/api/private/setup', (req, res) => {
  try {
    const { password, currentPassword } = req.body;
    const token = pt.setup(password, currentPassword);
    res.json({ ok: true, token });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/private/unlock', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.json({ ok: false, error: 'Password required' });
    const token = pt.unlock(password);
    res.json({ ok: true, token });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/private/lock', (req, res) => {
  pt.lock(req.headers['x-pt-token']);
  res.json({ ok: true });
});

app.post('/api/private/ai-toggle', (req, res) => {
  try {
    const aiEnabled = pt.toggleAI(req.headers['x-pt-token']);
    res.json({ ok: true, aiEnabled });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/api/private/notes', (req, res) => {
  const session = pt.validate(req.headers['x-pt-token']);
  if (!session) return res.status(401).json({ ok: false, error: 'Locked' });
  const { db, decryptNote } = require('./lib/db');
  const notes = db.prepare("SELECT * FROM notes WHERE type='private-thoughts' ORDER BY created_at DESC LIMIT 200").all().map(decryptNote);
  res.json({ ok: true, notes });
});

app.post('/api/private/notes', (req, res) => {
  const session = pt.validate(req.headers['x-pt-token']);
  if (!session) return res.status(401).json({ ok: false, error: 'Locked' });
  const { raw } = req.body;
  if (!raw || !raw.trim()) return res.json({ ok: false, error: 'Empty note' });
  const { db } = require('./lib/db');
  const { encrypt } = require('./lib/crypto');
  db.prepare("INSERT INTO notes (raw_input, formatted, status, type) VALUES (?,?,?,?)").run(
    encrypt(raw), encrypt(raw), 'processed', 'private-thoughts'
  );
  res.json({ ok: true });
});

app.put('/api/private/notes/:id', (req, res) => {
  const session = pt.validate(req.headers['x-pt-token']);
  if (!session) return res.status(401).json({ ok: false, error: 'Locked' });
  const { text } = req.body;
  if (!text || !text.trim()) return res.json({ ok: false, error: 'Empty' });
  const { db } = require('./lib/db');
  const { encrypt } = require('./lib/crypto');
  const note = db.prepare("SELECT type FROM notes WHERE id=?").get(req.params.id);
  if (!note || note.type !== 'private-thoughts') return res.json({ ok: false, error: 'Not found' });
  db.prepare("UPDATE notes SET raw_input=?, formatted=? WHERE id=?").run(encrypt(text), encrypt(text), req.params.id);
  res.json({ ok: true });
});

app.delete('/api/private/notes/:id', (req, res) => {
  const session = pt.validate(req.headers['x-pt-token']);
  if (!session) return res.status(401).json({ ok: false, error: 'Locked' });
  const { db } = require('./lib/db');
  const note = db.prepare("SELECT type FROM notes WHERE id=?").get(req.params.id);
  if (!note || note.type !== 'private-thoughts') return res.json({ ok: false, error: 'Not found' });
  db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/weather', async (req, res) => {
  try {
    const { getTempestToken, getTempestRaw } = require('./lib/weather');
    const token = getTempestToken();
    if (!token) return res.json({ ok: false, error: 'no_token' });
    const d = await getTempestRaw(token);
    res.json({ ok: true, ...d });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

app.get('/manifest.json', (req, res) => {
  res.json({ name: 'Anchor 3', short_name: 'Anchor3', description: "Dan's memory, context, and second brain", start_url: '/', display: 'standalone', background_color: '#0d1117', theme_color: '#1e3a5f' });
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false, error: 'Not found' });
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const { startScheduler } = require('./lib/remind');
app.listen(PORT, () => {
  console.log('anchor3 running on port ' + PORT);
  startScheduler();
});

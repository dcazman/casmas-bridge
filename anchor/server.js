'use strict';
const express = require('express');
const app = express();
const PORT = 7778;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ─────────────────────────────────────────────────────
const uiRouter     = require('./routes/ui');
const notesRouter  = require('./routes/notes');
const syncRouter   = require('./routes/sync');
const chatRouter   = require('./routes/chat');
const { router: bridgeRouter } = require('./routes/bridge');
const mcpRouter    = require('./routes/mcp');
const groomRouter  = require('./routes/groom');
const { getUsageStats } = require('./lib/usage');
const { startScheduler, buildDigestEmail } = require('./lib/remind');
const { sendEmail, emailEnabled } = require('./lib/email');
const { getTempestToken, setTempestToken, getTempestBlock } = require('./lib/weather');

app.use('/',      uiRouter);
app.use('/note',  notesRouter);
app.use('/notes', notesRouter);
app.use('/sync',  syncRouter);
app.use('/chat',  chatRouter);
app.use('/pull-bridge', bridgeRouter);
app.use('/groom',       groomRouter);
app.use('/mcp',         mcpRouter);

// POST /alert — on-demand digest email (buildDigestEmail is async due to weather)
app.post('/alert', async (req, res) => {
  try {
    const { subject, body } = await buildDigestEmail();
    const r = await sendEmail(subject, body);
    res.json(r);
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// GET /settings/tempest — check if token is configured
app.get('/settings/tempest', (req, res) => {
  const token = getTempestToken();
  res.json({ ok: true, configured: !!token });
});

// POST /settings/tempest — store token + optional test fetch
app.post('/settings/tempest', async (req, res) => {
  const { token } = req.body;
  if (!token || !token.trim()) return res.json({ ok: false, error: 'token required' });
  try {
    setTempestToken(token.trim());
    // Test the token immediately
    const block = await getTempestBlock();
    res.json({ ok: true, test: block || 'Token saved but no observation returned' });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// DELETE /settings/tempest — remove token
app.delete('/settings/tempest', (req, res) => {
  try {
    const { db } = require('./lib/db');
    db.prepare("DELETE FROM secrets WHERE key='tempest_token'").run();
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// POST /reclassify
app.post('/reclassify', (req, res) => {
  const { id, type } = req.body;
  const { ALL_TYPES } = require('./lib/helpers');
  const { db, decryptNote } = require('./lib/db');
  if (!id || !type) return res.json({ ok: false, error: 'Missing id or type' });
  if (!ALL_TYPES.includes(type)) return res.json({ ok: false, error: 'Unknown type: ' + type });
  try {
    if (type === 'remind') {
      const { parseReminderDate, parseRemindLine, nextRemindNum } = require('./lib/remind');
      const { encrypt } = require('./lib/crypto');
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
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

app.get('/usage', (req, res) => res.json(getUsageStats()));

app.listen(PORT, () => {
  console.log('anchor 3.0 running on port ' + PORT);
  startScheduler();
});

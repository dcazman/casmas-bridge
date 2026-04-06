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
const { startScheduler } = require('./lib/remind');

app.use('/',      uiRouter);
app.use('/note',  notesRouter);
app.use('/notes', notesRouter);
app.use('/sync',  syncRouter);
app.use('/chat',  chatRouter);
app.use('/pull-bridge', bridgeRouter);
app.use('/alert',       bridgeRouter);
app.use('/groom',       groomRouter);
app.use('/mcp',         mcpRouter);

// POST /reclassify — used by anchor-mcp reclassify_note tool and UI reclassify button
// Also clears review status so the 👁 badge goes away after manual review
app.post('/reclassify', (req, res) => {
  const { id, type } = req.body;
  const { ALL_TYPES } = require('./lib/helpers');
  const { db } = require('./lib/db');
  if (!id || !type) return res.json({ ok: false, error: 'Missing id or type' });
  if (!ALL_TYPES.includes(type)) return res.json({ ok: false, error: 'Unknown type: ' + type });
  try {
    db.prepare("UPDATE notes SET type=?, status='processed' WHERE id=?").run(type, id);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

app.get('/usage', (req, res) => res.json(getUsageStats()));

app.listen(PORT, () => {
  console.log('anchor 3.0 running on port ' + PORT);
  startScheduler();
});

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

app.use('/',            uiRouter);
app.use('/note',        notesRouter);
app.use('/notes',       notesRouter);
app.use('/reclassify',  notesRouter);
app.use('/sync',        syncRouter);
app.use('/chat',        chatRouter);
app.use('/pull-bridge', bridgeRouter);
app.use('/alert',       bridgeRouter);
app.use('/groom',       groomRouter);
app.use('/mcp',         mcpRouter);

app.get('/usage', (req, res) => res.json(getUsageStats()));

app.listen(PORT, () => console.log('anchor 3.0 running on port ' + PORT));

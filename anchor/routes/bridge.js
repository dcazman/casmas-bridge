'use strict';
const express = require('express');
const router  = express.Router();
const fs   = require('fs');
const path = require('path');
const { db } = require('../lib/db');
const { encrypt } = require('../lib/crypto');
const { sendEmail, emailEnabled } = require('../lib/email');
const { getPending } = require('../lib/db');
const { getUsageStats } = require('../lib/usage');

const BRIDGE_PATH = '/bridge';

// POST /pull-bridge
router.post('/', async (req, res) => {
  try {
    const mdDir = path.join(BRIDGE_PATH, 'md');
    if (!fs.existsSync(mdDir)) return res.json({ ok: true, ingested: 0, skipped: 0, note: 'md/ not found' });
    const files = fs.readdirSync(mdDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
    let ingested = 0, skipped = 0;
    for (const file of files) {
      const key = 'bridge:file:' + file;
      if (db.prepare('SELECT key FROM secrets WHERE key=?').get(key)) { skipped++; continue; }
      const content = fs.readFileSync(path.join(mdDir, file), 'utf8').trim();
      if (!content) { skipped++; continue; }
      const raw = '[Bridge: '+file+']\n'+content;
      db.prepare("INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)").run(encrypt(raw), encrypt(raw));
      db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run(key, '1');
      ingested++;
    }
    res.json({ ok: true, ingested, skipped });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// POST /alert
router.post('/alert', async (req, res) => {
  const { count: pc } = getPending();
  const loops = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!=''").get();
  const u = getUsageStats();
  const r = await sendEmail(
    'Anchor Alert — '+pc+' pending, '+loops.c+' open loops',
    'Pending: '+pc+'\nOpen loops: '+loops.c+'\nAPI spend: $'+u.cost+' / $'+u.limit+'\n\nVisit anchor.thecasmas.com'
  );
  res.json(r);
});

module.exports = { router, emailEnabled };

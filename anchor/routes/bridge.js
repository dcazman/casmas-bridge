'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { db }  = require('../lib/db');
const { encrypt } = require('../lib/crypto');
const { sendEmail, emailEnabled } = require('../lib/email');
const { getPending } = require('../lib/db');
const { getUsageStats } = require('../lib/usage');
const { pullBridge, pushSessionMd } = require('../lib/session');

const BRIDGE_PATH = '/bridge';

// POST /pull-bridge
// Two-way sync: pull latest from git, ingest new md files, push fresh session-latest.md
router.post('/', async (req, res) => {
  try {
    const result = { ok: true, ingested: 0, skipped: 0, session: null, anchorFilesChanged: [] };

    // ── 1. Pull latest from casmas-bridge ─────────────────────────────────────
    const pull = pullBridge();
    if (!pull.ok) {
      return res.json({ ok: false, error: 'git pull failed: ' + pull.error });
    }

    // ── 2. Notify if anchor source files changed ───────────────────────────────
    if (pull.anchorFiles && pull.anchorFiles.length) {
      result.anchorFilesChanged = pull.anchorFiles;
      console.log('[bridge] anchor source files changed:', pull.anchorFiles.join(', '));
      // Email notification — Dan applies the restart when ready
      const fileList = pull.anchorFiles.map(f => '  • ' + f).join('\n');
      await sendEmail(
        '⚓ Anchor — Source Files Updated',
        `New code was pulled into casmas-bridge.\n\nChanged files:\n${fileList}\n\nTo apply, run on OMV:\n  cd /srv/mergerfs/warehouse/anchor\n  docker compose restart anchor\n\nOr full rebuild if Dockerfile/package.json changed:\n  docker compose down && docker compose build --no-cache && docker compose up -d`
      ).catch(e => console.error('[bridge] email failed:', e.message));
    }

    // ── 3. Ingest new md/ files from bridge ────────────────────────────────────
    const mdDir = path.join(BRIDGE_PATH, 'md');
    if (fs.existsSync(mdDir)) {
      const files = fs.readdirSync(mdDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
      for (const file of files) {
        if (file === 'session-latest.md') continue; // never ingest our own output
        const key = 'bridge:file:' + file;
        if (db.prepare('SELECT key FROM secrets WHERE key=?').get(key)) { result.skipped++; continue; }
        const content = fs.readFileSync(path.join(mdDir, file), 'utf8').trim();
        if (!content) { result.skipped++; continue; }
        const raw = '[Bridge: ' + file + ']\n' + content;
        db.prepare("INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)").run(encrypt(raw), encrypt(raw));
        db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run(key, '1');
        result.ingested++;
      }
    }

    // ── 4. Push fresh session-latest.md ───────────────────────────────────────
    const session = pushSessionMd();
    result.session = session;

    res.json(result);
  } catch (e) {
    console.error('[bridge] error:', e);
    res.json({ ok: false, error: e.message });
  }
});

// POST /alert — ad-hoc status email
router.post('/alert', async (req, res) => {
  const { count: pc } = getPending();
  const loops = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!=''").get();
  const u = getUsageStats();
  const r = await sendEmail(
    'Anchor Alert — ' + pc + ' pending, ' + loops.c + ' open loops',
    'Pending: ' + pc + '\nOpen loops: ' + loops.c + '\nAPI spend: $' + u.cost + ' / $' + u.limit + '\n\nVisit anchor.thecasmas.com'
  );
  res.json(r);
});

module.exports = { router, emailEnabled };

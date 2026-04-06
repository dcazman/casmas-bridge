'use strict';
const express    = require('express');
const router     = express.Router();
const fs         = require('fs');
const path       = require('path');
const { execSync } = require('child_process');
const { db }     = require('../lib/db');
const { encrypt } = require('../lib/crypto');
const { sendEmail, emailEnabled } = require('../lib/email');
const { getPending } = require('../lib/db');
const { getUsageStats } = require('../lib/usage');
const { pullBridge, pushSessionMd } = require('../lib/session');

const BRIDGE_PATH  = '/bridge';
const ANCHOR_SRC   = BRIDGE_PATH + '/anchor';          // casmas-bridge/anchor/
const ANCHOR_LIVE  = '/srv/mergerfs/warehouse/anchor'; // running service

// Files that require a full docker rebuild (not just restart)
const REBUILD_TRIGGERS = ['Dockerfile', 'package.json', 'package-lock.json'];

// Copy changed anchor source files into the live service directory and restart
function applyAnchorUpdate(changedFiles) {
  const log = [];
  let needsRebuild = false;

  for (const relPath of changedFiles) {
    // relPath is like "anchor/routes/sync.js" — strip the "anchor/" prefix
    const filePart = relPath.replace(/^anchor\//, '');
    const src  = path.join(ANCHOR_SRC, filePart);
    const dest = path.join(ANCHOR_LIVE, filePart);

    if (!fs.existsSync(src)) { log.push('skip (not found): ' + relPath); continue; }

    // Ensure destination directory exists
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    log.push('copied: ' + relPath);

    if (REBUILD_TRIGGERS.some(t => filePart.endsWith(t))) needsRebuild = true;
  }

  try {
    if (needsRebuild) {
      log.push('rebuild triggered (Dockerfile or package.json changed)');
      execSync(
        'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml down && ' +
        'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml build --no-cache && ' +
        'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml up -d',
        { timeout: 120000 }
      );
      log.push('full rebuild + restart done');
    } else {
      execSync('docker restart anchor', { timeout: 30000 });
      log.push('docker restart anchor done');
    }
  } catch (e) {
    log.push('restart failed: ' + e.message);
  }

  return { needsRebuild, log };
}

// POST /pull-bridge
// Two-way sync: pull latest from git, auto-apply anchor source changes, ingest new md files, push session-latest.md
router.post('/', async (req, res) => {
  try {
    const result = { ok: true, ingested: 0, skipped: 0, session: null, anchorFilesChanged: [], applyLog: [] };

    // ── 1. Pull latest from casmas-bridge ─────────────────────────────────────
    const pull = pullBridge();
    if (!pull.ok) {
      return res.json({ ok: false, error: 'git pull failed: ' + pull.error });
    }

    // ── 2. Auto-apply anchor source changes ───────────────────────────────────
    if (pull.anchorFiles && pull.anchorFiles.length) {
      result.anchorFilesChanged = pull.anchorFiles;
      console.log('[bridge] anchor source files changed:', pull.anchorFiles.join(', '));

      const apply = applyAnchorUpdate(pull.anchorFiles);
      result.applyLog = apply.log;
      console.log('[bridge] apply result:', apply.log.join('; '));

      // NOTE: if docker restart was called, this response may still complete
      // because the restart is async from Node's perspective for a moment.
      // Email for awareness.
      const fileList = pull.anchorFiles.map(f => '  • ' + f).join('\n');
      const applyDetail = apply.log.map(l => '  ' + l).join('\n');
      await sendEmail(
        '⚓ Anchor — Source Updated & Applied',
        `Changed files pulled and applied automatically.\n\nFiles:\n${fileList}\n\nApply log:\n${applyDetail}`
      ).catch(e => console.error('[bridge] email failed:', e.message));
    }

    // ── 3. Ingest new md/ files from bridge ────────────────────────────────────
    const mdDir = path.join(BRIDGE_PATH, 'md');
    if (fs.existsSync(mdDir)) {
      const files = fs.readdirSync(mdDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
      for (const file of files) {
        if (file === 'session-latest.md') continue;
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

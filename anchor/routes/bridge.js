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
const ANCHOR_SRC   = BRIDGE_PATH + '/anchor';
const ANCHOR_LIVE  = '/srv/mergerfs/warehouse/anchor';

const REBUILD_TRIGGERS = ['Dockerfile', 'package.json', 'package-lock.json'];

// Walk a directory recursively, returning relative paths
function walkDir(dir, base) {
  base = base || dir;
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walkDir(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

// Copy anchor source files into the live service directory and restart
// changedFiles: array of paths relative to casmas-bridge root (e.g. "anchor/routes/sync.js")
// If changedFiles is null, copy ALL files from anchor/
function applyAnchorUpdate(changedFiles) {
  const log = [];
  let needsRebuild = false;
  let files = changedFiles;

  if (!files) {
    // Force mode — copy everything in anchor/
    if (!fs.existsSync(ANCHOR_SRC)) { return { needsRebuild: false, log: ['anchor/ dir not found in bridge'] }; }
    const all = walkDir(ANCHOR_SRC);
    files = all.map(f => 'anchor/' + f);
    log.push('force mode — copying all ' + files.length + ' anchor source files');
  }

  for (const relPath of files) {
    const filePart = relPath.replace(/^anchor\//, '');
    const src  = path.join(ANCHOR_SRC, filePart);
    const dest = path.join(ANCHOR_LIVE, filePart);
    if (!fs.existsSync(src)) { log.push('skip (not found): ' + relPath); continue; }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    log.push('copied: ' + filePart);
    if (REBUILD_TRIGGERS.some(t => filePart.endsWith(t))) needsRebuild = true;
  }

  try {
    if (needsRebuild) {
      log.push('rebuild triggered');
      execSync(
        'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml down && ' +
        'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml build --no-cache && ' +
        'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml up -d',
        { timeout: 120000 }
      );
      log.push('full rebuild + restart done');
    } else {
      execSync('docker restart anchor', { timeout: 30000 });
      log.push('docker restart done');
    }
  } catch (e) {
    log.push('restart failed: ' + e.message);
  }

  return { needsRebuild, log };
}

// POST /pull-bridge
// ?force=1 — always copy all anchor/ source files even if git reports no changes
router.post('/', async (req, res) => {
  try {
    const force = req.query.force === '1' || req.body.force === true || req.body.force === '1';
    const result = { ok: true, ingested: 0, skipped: 0, session: null, anchorFilesChanged: [], applyLog: [], forced: force };

    // ── 1. Pull latest from git ────────────────────────────────────────────────
    const pull = pullBridge();
    if (!pull.ok) return res.json({ ok: false, error: 'git pull failed: ' + pull.error });

    // ── 2. Apply anchor source files ──────────────────────────────────────────
    const hasNewFiles = pull.anchorFiles && pull.anchorFiles.length > 0;
    if (hasNewFiles || force) {
      const filesToApply = force ? null : pull.anchorFiles; // null = force all
      result.anchorFilesChanged = force ? ['(force — all files)'] : pull.anchorFiles;
      const apply = applyAnchorUpdate(filesToApply);
      result.applyLog = apply.log;
      console.log('[bridge] apply result:', apply.log.join('; '));
      if (hasNewFiles && !force) {
        const fileList = pull.anchorFiles.map(f => '  • ' + f).join('\n');
        await sendEmail(
          '⚓ Anchor — Source Updated & Applied',
          `Files:\n${fileList}\n\nApply log:\n${apply.log.map(l => '  ' + l).join('\n')}`
        ).catch(() => {});
      }
    }

    // ── 3. Ingest new md/ files ────────────────────────────────────────────────
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

    // ── 4. Push session-latest.md ─────────────────────────────────────────────
    const session = pushSessionMd();
    result.session = session;

    res.json(result);
  } catch (e) {
    console.error('[bridge] error:', e);
    res.json({ ok: false, error: e.message });
  }
});

// POST /alert
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

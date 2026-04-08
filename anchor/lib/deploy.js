'use strict';
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BRIDGE_PATH       = '/bridge';
const ANCHOR_SRC        = BRIDGE_PATH + '/anchor';
const ANCHOR_LIVE       = '/srv/mergerfs/warehouse/anchor';
const REBUILD_TRIGGERS  = ['Dockerfile', 'package.json', 'package-lock.json'];

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

// Copy anchor source files into the live service directory and restart.
// changedFiles: array of paths relative to casmas-bridge root (e.g. "anchor/routes/sync.js")
// Pass null to force-copy ALL files from anchor/
function applyAnchorUpdate(changedFiles) {
  const log = [];
  let needsRebuild = false;
  let files = changedFiles;

  if (!files) {
    if (!fs.existsSync(ANCHOR_SRC)) {
      return { needsRebuild: false, log: ['anchor/ dir not found in bridge'] };
    }
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

// Force a full docker compose rebuild regardless of which files changed
function rebuildAnchor() {
  const log = [];
  try {
    log.push('starting full rebuild...');
    execSync(
      'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml down && ' +
      'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml build --no-cache && ' +
      'docker compose -f ' + ANCHOR_LIVE + '/docker-compose.yml up -d',
      { timeout: 300000 }
    );
    log.push('full rebuild + restart done');
  } catch (e) {
    log.push('rebuild failed: ' + e.message);
  }
  return { log };
}

module.exports = { applyAnchorUpdate, rebuildAnchor };

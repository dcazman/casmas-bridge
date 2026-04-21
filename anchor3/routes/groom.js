'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { db }         = require('../lib/db');
const { decrypt }    = require('../lib/crypto');
const { sendEmail, emailEnabled } = require('../lib/email');

const ATTACH_DIR  = '/attachments';
const STALE_DAYS  = 14;
const JUNK_RE     = /^[a-f0-9:]{20,}$/i;

function isJunk(val) {
  if (!val || !val.trim()) return false;
  const t = val.trim();
  if (JUNK_RE.test(t)) return true;
  const segs = t.split(':').filter(Boolean);
  return segs.length >= 2 && segs.every(s => /^[a-f0-9]{8,}$/i.test(s));
}

router.post('/', async (req, res) => {
  try {
    const report = [];
    let fixed = 0;

    // ── 1. Clear junk open_loops ──────────────────────────────────────────────
    const loopNotes = db.prepare(
      "SELECT id, open_loops FROM notes WHERE open_loops IS NOT NULL AND open_loops!=''"
    ).all().map(n => {
      let val = n.open_loops;
      try { val = decrypt(n.open_loops); } catch {}
      return { id: n.id, open_loops: val };
    });
    const junkIds = loopNotes.filter(n => isJunk(n.open_loops)).map(n => n.id);
    if (junkIds.length) {
      const stmt = db.prepare("UPDATE notes SET open_loops='' WHERE id=?");
      for (const id of junkIds) stmt.run(id);
      report.push(`🧹 Cleared junk open_loops on ${junkIds.length} note(s) (IDs: ${junkIds.join(', ')})`);
      fixed += junkIds.length;
    }

    // ── 2. Delete duplicate notes (same content, keep oldest) ────────────────
    const allNotes = db.prepare(
      "SELECT id, formatted FROM notes WHERE status='processed' AND type != 'private-thoughts' ORDER BY created_at ASC"
    ).all().map(n => {
      let fmt = '';
      try { fmt = (decrypt(n.formatted) || '').trim().toLowerCase().substring(0, 150); } catch {}
      return { id: n.id, fmt };
    });
    const seen = new Map();
    const dupeIds = [];
    for (const n of allNotes) {
      if (n.fmt.length < 30) continue;
      if (seen.has(n.fmt)) dupeIds.push(n.id);
      else seen.set(n.fmt, n.id);
    }
    if (dupeIds.length) {
      const del = db.prepare('DELETE FROM notes WHERE id=?');
      for (const id of dupeIds) del.run(id);
      report.push(`🗑  Deleted ${dupeIds.length} duplicate note(s) (IDs: ${dupeIds.join(', ')})`);
      fixed += dupeIds.length;
    }

    // ── 3. Clear open_loops on stale notes (14+ days, no reminder) ───────────
    const staleLoop = db.prepare(
      `SELECT id FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!='' AND remind_at IS NULL AND created_at < datetime('now','-${STALE_DAYS} days')`
    ).all();
    if (staleLoop.length) {
      const stmt = db.prepare("UPDATE notes SET open_loops='' WHERE id=?");
      for (const n of staleLoop) stmt.run(n.id);
      report.push(`✅ Cleared open_loops on ${staleLoop.length} note(s) older than ${STALE_DAYS} days`);
      fixed += staleLoop.length;
    }

    // ── 4. Rescue stuck pending notes (>24 hrs) → brain-dump ─────────────────
    const stalePending = db.prepare(
      "SELECT id FROM notes WHERE status='pending' AND created_at < datetime('now','-1 day')"
    ).all();
    if (stalePending.length) {
      const stmt = db.prepare("UPDATE notes SET status='processed', type='brain-dump' WHERE id=?");
      for (const n of stalePending) stmt.run(n.id);
      report.push(`⏳ Rescued ${stalePending.length} stuck pending note(s) → brain-dump`);
      fixed += stalePending.length;
    }

    // ── 5. Orphaned attachment files ──────────────────────────────────────────
    try {
      const dbFiles = new Set(db.prepare('SELECT filename FROM attachments').all().map(a => a.filename));
      if (fs.existsSync(ATTACH_DIR)) {
        const orphaned = fs.readdirSync(ATTACH_DIR).filter(f => !dbFiles.has(f));
        for (const f of orphaned) {
          try { fs.unlinkSync(path.join(ATTACH_DIR, f)); } catch {}
        }
        if (orphaned.length) {
          report.push(`🗂  Deleted ${orphaned.length} orphaned attachment file(s)`);
          fixed += orphaned.length;
        }
      }
    } catch (e) {
      report.push(`⚠️  Attachment cleanup failed: ${e.message}`);
    }

    // ── 6. VACUUM ─────────────────────────────────────────────────────────────
    try {
      db.exec('VACUUM');
      report.push('💾 VACUUM complete');
    } catch (e) {
      report.push(`⚠️  VACUUM failed: ${e.message}`);
    }

    // ── 7. Health stats ───────────────────────────────────────────────────────
    const total     = db.prepare("SELECT COUNT(*) as c FROM notes").get().c;
    const processed = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='processed'").get().c;
    const pending   = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='pending'").get().c;
    const withLoops = db.prepare("SELECT COUNT(*) as c FROM notes WHERE open_loops IS NOT NULL AND open_loops!=''").get().c;
    const attachCt  = db.prepare("SELECT COUNT(*) as c FROM attachments").get().c;
    const byType    = db.prepare(
      "SELECT type, COUNT(*) as c FROM notes WHERE status='processed' GROUP BY type ORDER BY c DESC LIMIT 10"
    ).all();

    report.push(`\n📊 DB: ${total} total | ${processed} processed | ${pending} pending`);
    report.push(`📎 Attachments: ${attachCt}`);
    report.push(`🔁 Open loops: ${withLoops} note(s)`);
    report.push(`📂 By type: ${byType.map(r => `${r.type}(${r.c})`).join(', ')}`);

    const summary = fixed > 0
      ? `Fixed ${fixed} issue(s):\n\n${report.join('\n')}`
      : `✅ Nothing to fix.\n\n${report.join('\n')}`;

    if (emailEnabled) await sendEmail('⚓ Anchor 3 Groom Report', summary).catch(() => {});

    res.json({ ok: true, report: summary, fixed });
  } catch (e) {
    console.error('[groom] error:', e);
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;

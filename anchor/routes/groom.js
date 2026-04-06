'use strict';
const express = require('express');
const router  = express.Router();
const { db, decryptNote } = require('../lib/db');
const { sendEmail, emailEnabled } = require('../lib/email');

const JUNK_LOOPS_RE = /^[a-f0-9:]{20,}$/i;

function isJunkLoops(val) {
  if (!val || !val.trim()) return false;
  const trimmed = val.trim();
  if (JUNK_LOOPS_RE.test(trimmed)) return true;
  const segs = trimmed.split(':').filter(Boolean);
  if (segs.length >= 2 && segs.every(s => /^[a-f0-9]{8,}$/i.test(s))) return true;
  return false;
}

router.post('/', async (req, res) => {
  try {
    const report = [];
    let fixed = 0;

    // ── 0. Promote any lingering review notes → processed ─────────────────────
    const reviewNotes = db.prepare("SELECT id FROM notes WHERE status='review'").all();
    if (reviewNotes.length) {
      db.prepare("UPDATE notes SET status='processed' WHERE status='review'").run();
      report.push(`🔄 Promoted ${reviewNotes.length} lingering review note(s) → processed`);
      fixed += reviewNotes.length;
    }

    // ── 1. Clear junk open_loops (hash garbage) ───────────────────────────────
    const allLoops = db.prepare(
      "SELECT id, open_loops FROM notes WHERE open_loops IS NOT NULL AND open_loops!=''"
    ).all().map(n => {
      let val = n.open_loops;
      try { const { decrypt } = require('../lib/crypto'); val = decrypt(n.open_loops); } catch {}
      return { id: n.id, open_loops: val };
    });

    const junkIds = allLoops.filter(n => isJunkLoops(n.open_loops)).map(n => n.id);
    if (junkIds.length) {
      const stmt = db.prepare("UPDATE notes SET open_loops='' WHERE id=?");
      for (const id of junkIds) stmt.run(id);
      report.push(`🧹 Cleared junk open_loops on ${junkIds.length} note(s) (IDs: ${junkIds.join(', ')})`);
      fixed += junkIds.length;
    }

    // ── 2. Delete duplicate notes (same formatted content, keep oldest) ───────
    const allNotes = db.prepare(
      "SELECT id, formatted, created_at FROM notes WHERE status='processed' ORDER BY created_at ASC"
    ).all().map(n => {
      let fmt = n.formatted || '';
      try { const { decrypt } = require('../lib/crypto'); fmt = decrypt(n.formatted) || ''; } catch {}
      return { id: n.id, fmt: fmt.trim().toLowerCase().substring(0, 150), created_at: n.created_at };
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

    // ── 3. Clear open_loops on stale task notes (30+ days, no reminder) ───────
    const staleTaskTypes = ['personal-task','home-task','kids-task','health-task','finance-task'];
    const staleTasks = db.prepare(
      "SELECT id FROM notes WHERE status='processed' AND type IN (" +
      staleTaskTypes.map(()=>'?').join(',') +
      ") AND open_loops IS NOT NULL AND open_loops!='' AND remind_at IS NULL AND created_at < datetime('now','-30 days')"
    ).all(...staleTaskTypes);

    if (staleTasks.length) {
      const stmt = db.prepare("UPDATE notes SET open_loops='' WHERE id=?");
      for (const n of staleTasks) stmt.run(n.id);
      report.push(`✅ Cleared open_loops on ${staleTasks.length} stale task note(s) older than 30 days`);
      fixed += staleTasks.length;
    }

    // ── 4. Flag stale pending notes (>24hrs) → brain-dump/processed ──────────
    const stalePending = db.prepare(
      "SELECT id FROM notes WHERE status='pending' AND created_at < datetime('now','-1 day')"
    ).all();
    if (stalePending.length) {
      const stmt = db.prepare("UPDATE notes SET status='processed', type='brain-dump' WHERE id=?");
      for (const n of stalePending) stmt.run(n.id);
      report.push(`⏳ Rescued ${stalePending.length} stuck pending note(s) → brain-dump`);
      fixed += stalePending.length;
    }

    // ── 5. VACUUM ─────────────────────────────────────────────────────────────
    try {
      db.exec('VACUUM');
      report.push(`💾 VACUUM complete`);
    } catch (e) {
      report.push(`⚠️  VACUUM failed: ${e.message}`);
    }

    // ── 6. Health stats ───────────────────────────────────────────────────────
    const total     = db.prepare("SELECT COUNT(*) as c FROM notes").get().c;
    const processed = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='processed'").get().c;
    const pending   = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='pending'").get().c;
    const withLoops = db.prepare("SELECT COUNT(*) as c FROM notes WHERE open_loops IS NOT NULL AND open_loops!=''").get().c;
    const byType    = db.prepare(
      "SELECT type, COUNT(*) as c FROM notes WHERE status='processed' GROUP BY type ORDER BY c DESC LIMIT 10"
    ).all();

    report.push(`\n📊 DB: ${total} total | ${processed} processed | ${pending} pending`);
    report.push(`🔁 Open loops: ${withLoops} note(s)`);
    report.push(`📂 By type: ${byType.map(r => r.type + '(' + r.c + ')').join(', ')}`);

    const summary = fixed > 0
      ? `Fixed ${fixed} issue(s):\n\n` + report.join('\n')
      : '✅ Nothing to fix.\n\n' + report.join('\n');

    if (emailEnabled) await sendEmail('⚓ Anchor Groom Report', summary).catch(() => {});

    res.json({ ok: true, report: summary, fixed });
  } catch (e) {
    console.error('[groom] error:', e);
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;

'use strict';
const express = require('express');
const router  = express.Router();
const { db, decryptNote } = require('../lib/db');
const { sendEmail, emailEnabled } = require('../lib/email');

// POST /groom
// Runs a maintenance pass on the notes DB:
// - Finds duplicate notes (same formatted content)
// - Surfaces open loops older than 14 days with no update
// - Counts notes by type/status for a health report
// - Optionally emails the report
router.post('/', async (req, res) => {
  try {
    const report = [];
    const now = Date.now();
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    // ── 1. Pending notes older than 24hrs (forgot to sync) ────
    const stalePending = db.prepare(
      "SELECT id, created_at FROM notes WHERE status='pending' AND created_at < datetime('now','-1 day')"
    ).all();
    if (stalePending.length) {
      report.push(`⏳ ${stalePending.length} pending notes older than 24hrs — run Sync Now`);
    }

    // ── 2. Open loops older than 14 days ─────────────────────
    const staleLoops = db.prepare(
      "SELECT id, type, created_at, open_loops FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!='' AND created_at < datetime('now','-14 days')"
    ).all().map(decryptNote);
    if (staleLoops.length) {
      report.push(`🔁 ${staleLoops.length} open loops older than 14 days:`);
      staleLoops.slice(0, 5).forEach(n => {
        report.push(`  [${n.type}] ${(n.open_loops||'').substring(0, 80)}...`);
      });
      if (staleLoops.length > 5) report.push(`  ...and ${staleLoops.length - 5} more`);
    }

    // ── 3. Notes needing review ───────────────────────────────
    const reviewNotes = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='review'").get();
    if (reviewNotes.c > 0) {
      report.push(`👁 ${reviewNotes.c} notes flagged for review — check Anchor UI`);
    }

    // ── 4. DB health stats ────────────────────────────────────
    const total = db.prepare("SELECT COUNT(*) as c FROM notes").get().c;
    const processed = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='processed'").get().c;
    const pending = db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='pending'").get().c;
    const byType = db.prepare(
      "SELECT type, COUNT(*) as c FROM notes WHERE status='processed' GROUP BY type ORDER BY c DESC LIMIT 8"
    ).all();

    report.push(`\n📊 DB Health: ${total} total, ${processed} processed, ${pending} pending, ${reviewNotes.c} review`);
    report.push(`Top categories: ${byType.map(r => r.type + '(' + r.c + ')').join(', ')}`);

    // ── 5. Duplicate detection (same formatted content) ──────
    const allNotes = db.prepare("SELECT id, formatted FROM notes WHERE status='processed'").all().map(decryptNote);
    const seen = new Map();
    const dupes = [];
    for (const n of allNotes) {
      const key = (n.formatted || '').trim().toLowerCase().substring(0, 100);
      if (key.length < 20) continue;
      if (seen.has(key)) { dupes.push({ id: n.id, dupe_of: seen.get(key) }); }
      else seen.set(key, n.id);
    }
    if (dupes.length) {
      report.push(`\n🗑 ${dupes.length} likely duplicate notes found (IDs: ${dupes.map(d => d.id).join(', ')})`);
    }

    const summary = report.length
      ? report.join('\n')
      : '✅ DB looks clean — no issues found';

    // ── Email if configured ───────────────────────────────────
    if (emailEnabled) {
      await sendEmail('Anchor Weekly Groom Report', summary);
    }

    res.json({ ok: true, report: summary, dupeIds: dupes.map(d => d.id) });
  } catch(e) {
    console.error('groom error:', e);
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;

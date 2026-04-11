'use strict';
const cron      = require('node-cron');
const { db, decryptNote, getPending } = require('./db');
const { encrypt, decrypt }            = require('./crypto');
const { sendEmail }                   = require('./email');
const { pullBridge, pushSessionMd }   = require('./session');
const { applyAnchorUpdate }           = require('./deploy');
const { getTempestBlock }             = require('./weather');

// ── Reminder DB helpers ───────────────────────────────────────────────────────

function getDueReminders() {
  try {
    const now = new Date().toISOString();
    return db.prepare(
      "SELECT * FROM notes WHERE remind_at IS NOT NULL AND remind_at <= ? AND (remind_sent IS NULL OR remind_sent=0)"
    ).all(now).map(decryptNote);
  } catch { return []; }
}

function getActiveReminders() {
  try {
    return db.prepare(
      "SELECT * FROM notes WHERE remind_at IS NOT NULL AND remind_at!='' ORDER BY remind_at ASC"
    ).all().map(decryptNote);
  } catch { return []; }
}

function getOpenLoops() {
  return db.prepare(
    "SELECT * FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!='' ORDER BY created_at DESC LIMIT 15"
  ).all().map(decryptNote);
}

function getOpenLoopNotes() {
  try {
    return db.prepare(
      "SELECT * FROM notes WHERE type='open-loop' ORDER BY created_at ASC"
    ).all().map(decryptNote);
  } catch { return []; }
}

function markReminderSent(id) {
  try { db.prepare('UPDATE notes SET remind_sent=1 WHERE id=?').run(id); } catch {}
}

function nextRemindNum() {
  try {
    const row = db.prepare("SELECT value FROM secrets WHERE key='remind_counter'").get();
    const next = row ? parseInt(row.value) + 1 : 1;
    db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('remind_counter',?)").run(String(next));
    return next;
  } catch { return null; }
}

// ── Remind line parser ────────────────────────────────────────────────────────

function parseRemindLine(body) {
  let thing, dateStr;
  if (body.includes(',')) {
    const ci = body.indexOf(',');
    thing   = body.slice(0, ci).trim();
    dateStr = body.slice(ci + 1).trim();
  } else {
    const dateM = body.match(/((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}(?::\d{2})?\s*(?:am|pm)|tom(?:orrow)?|\d+\s*(?:week|day)s?).*)$/i);
    if (dateM && dateM.index > 0) {
      thing   = body.slice(0, dateM.index).trim();
      dateStr = dateM[1];
    } else {
      thing   = body;
      dateStr = '';
    }
  }
  return { thing, dateStr };
}

// ── Date parser ───────────────────────────────────────────────────────────────

function parseReminderDate(str) {
  const s   = (str || '').trim().toLowerCase();
  const now = new Date();
  const DH  = 11;

  if (!s) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    d.setHours(DH, 0, 0, 0);
    return d;
  }

  const relM = s.match(/^(\d+)\s*(week|day)s?$/);
  if (relM) {
    const d = new Date(now);
    const n = parseInt(relM[1]);
    if (relM[2] === 'week') d.setDate(d.getDate() + n * 7);
    else d.setDate(d.getDate() + n);
    d.setHours(DH, 0, 0, 0);
    return d;
  }

  const timeM = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  let hour = null, min = 0;
  if (timeM) {
    hour = parseInt(timeM[1]);
    min  = timeM[2] ? parseInt(timeM[2]) : 0;
    if (timeM[3] === 'pm' && hour < 12) hour += 12;
    if (timeM[3] === 'am' && hour === 12) hour = 0;
  }
  const h = hour !== null ? hour : DH;

  if (/\btom(?:orrow)?\b/.test(s)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(h, min, 0, 0);
    return d;
  }

  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dayM = days.findIndex(d => s.includes(d));
  if (dayM !== -1) {
    const d = new Date(now);
    let diff = dayM - d.getDay();
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    d.setHours(h, min, 0, 0);
    return d;
  }

  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const moM = months.findIndex(m => s.includes(m));
  if (moM !== -1) {
    const numM = s.match(/\b(\d{1,2})\b/);
    const day  = numM ? parseInt(numM[1]) : 1;
    const d    = new Date(now.getFullYear(), moM, day);
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    d.setHours(h, min, 0, 0);
    return d;
  }

  if (hour !== null) {
    const d = new Date(now);
    d.setHours(hour, min, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }

  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  d.setHours(DH, 0, 0, 0);
  return d;
}

// ── Command processor ─────────────────────────────────────────────────────────

function isReminderCommand(text) {
  return /\b(done|snooze|change)\s+\d+/i.test((text || '').trim());
}

function processCommands(text) {
  const results = [];
  const s = (text || '').trim();
  const segments = s.split(/,|\n/).map(x => x.trim()).filter(Boolean);

  for (const seg of segments) {
    const doneM   = seg.match(/^done\s+(\d+)$/i);
    const snoozeM = seg.match(/^snooze\s+(\d+)(?:\s+(.+))?$/i);
    const changeM = seg.match(/^change\s+(\d+)\s+to\s+(.+)$/i);

    if (doneM) {
      const id = parseInt(doneM[1]);
      const note = db.prepare('SELECT * FROM notes WHERE remind_num=?').get(id);
      if (note) {
        db.prepare('DELETE FROM notes WHERE id=?').run(note.id);
        results.push({ cmd: 'done', num: id, ok: true });
      } else {
        results.push({ cmd: 'done', num: id, ok: false, error: 'not found' });
      }
      continue;
    }

    if (snoozeM) {
      const id    = parseInt(snoozeM[1]);
      const when  = snoozeM[2] || '';
      const note  = db.prepare('SELECT * FROM notes WHERE remind_num=?').get(id);
      if (note) {
        const newDate = parseReminderDate(when).toISOString();
        db.prepare('UPDATE notes SET remind_at=?, remind_sent=0 WHERE id=?').run(newDate, note.id);
        results.push({ cmd: 'snooze', num: id, ok: true, newDate });
      } else {
        results.push({ cmd: 'snooze', num: id, ok: false, error: 'not found' });
      }
      continue;
    }

    if (changeM) {
      const id      = parseInt(changeM[1]);
      const newText = changeM[2].trim();
      const note    = db.prepare('SELECT * FROM notes WHERE remind_num=?').get(id);
      if (note) {
        const dateTokens = newText.match(/((?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d+\s*(?:am|pm)|tomorrow|next week).*)$/i);
        const content    = dateTokens ? newText.slice(0, newText.indexOf(dateTokens[0])).trim() : newText;
        const dateStr    = dateTokens ? dateTokens[0] : null;
        if (content) db.prepare('UPDATE notes SET formatted=? WHERE id=?').run(encrypt(content), note.id);
        if (dateStr) {
          const newDate = parseReminderDate(dateStr).toISOString();
          db.prepare('UPDATE notes SET remind_at=?, remind_sent=0 WHERE id=?').run(newDate, note.id);
        }
        results.push({ cmd: 'change', num: id, ok: true, content, newDate: dateStr ? parseReminderDate(dateStr).toISOString() : null });
      } else {
        results.push({ cmd: 'change', num: id, ok: false, error: 'not found' });
      }
      continue;
    }
  }

  return results;
}

// ── Email command block ───────────────────────────────────────────────────────

function cmdBlock(ref) {
  if (ref != null) {
    return `Reply in Anchor (Add Note → Sync Now):\n  done ${ref}  ·  snooze ${ref}  ·  snooze ${ref} friday 3pm  ·  change ${ref} to new text`;
  }
  return `Reply in Anchor (Add Note → Sync Now):\n  done N  ·  snooze N  ·  snooze N friday 3pm  ·  change N to new text`;
}

// ── Digest email builder (shared by 7AM cron and on-demand alert) ─────────────

async function buildDigestEmail() {
  const reminders     = getActiveReminders();
  const openLoopNotes = getOpenLoopNotes();
  const today         = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const dueToday = reminders.filter(n => {
    const d = new Date(n.remind_at);
    return d >= today && d < tomorrow;
  });
  const upcoming = reminders.filter(n => {
    const d = new Date(n.remind_at);
    return d >= tomorrow;
  }).slice(0, 5);

  const loops           = getOpenLoops();
  const { count: pending } = getPending();
  const tz              = { timeZone: 'America/New_York' };
  const dateStr         = new Date().toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', ...tz });

  let body = `☀️ Anchor — ${dateStr}\n\n`;

  // ── Tempest weather block (fails gracefully) ──────────────────────────────
  try {
    const weatherBlock = await getTempestBlock();
    if (weatherBlock) body += weatherBlock + '\n\n';
  } catch (e) {
    console.warn('[remind] weather block error:', e.message, '— continuing without weather');
  }

  if (dueToday.length) {
    body += `📅 Due Today\n`;
    for (const n of dueToday) {
      const num  = n.remind_num ? `${n.remind_num})` : '•';
      const text = (n.formatted || '').split('\n')[0].trim().substring(0, 70);
      const time = new Date(n.remind_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz });
      body += `  ${num} ${text} — ${time}\n`;
    }
    body += '\n';
  }

  if (upcoming.length) {
    body += `🗓 Coming Up\n`;
    for (const n of upcoming) {
      const num  = n.remind_num ? `${n.remind_num})` : '•';
      const text = (n.formatted || '').split('\n')[0].trim().substring(0, 60);
      const when = new Date(n.remind_at).toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', hour: 'numeric', minute: '2-digit', hour12: true, ...tz });
      body += `  ${num} ${text} — ${when}\n`;
    }
    body += '\n';
  }

  if (openLoopNotes.length) {
    body += `🔓 Open Loops\n`;
    for (const n of openLoopNotes) {
      const text = (n.formatted || n.raw_input || '').split('\n')[0].trim().substring(0, 90);
      body += `  • ${text}\n`;
    }
    body += '\n';
  }

  if (loops.length) {
    body += `🔁 AI-Flagged Loops\n`;
    for (const n of loops.slice(0, 8)) {
      body += `  • ${(n.open_loops || '').substring(0, 90)}\n`;
    }
    if (loops.length > 8) body += `  …and ${loops.length - 8} more\n`;
    body += '\n';
  }

  if (pending > 0) body += `📋 ${pending} unsynced notes\n\n`;

  if (!dueToday.length && !upcoming.length && !openLoopNotes.length && !loops.length && !pending) {
    body += `✅ All clear.\n\n`;
  }

  body += `---\n${cmdBlock()}\nanchor.thecasmas.com`;

  const subject = dueToday.length
    ? `☀️ Anchor — ${dueToday.length} due today · ${dateStr}`
    : `☀️ Anchor — ${dateStr}`;

  return { subject, body };
}

// ── Cron jobs ─────────────────────────────────────────────────────────────────

function startScheduler() {
  console.log('[remind] scheduler starting');

  cron.schedule('0 7 * * *', async () => {
    console.log('[remind] 7AM digest running');
    try {
      const { subject, body } = await buildDigestEmail();
      await sendEmail(subject, body);
      const due = getDueReminders();
      for (const n of due) markReminderSent(n.id);
      console.log('[remind] digest email sent');
    } catch (e) {
      console.error('[remind] digest email failed:', e.message);
    }
    try { pushSessionMd(); } catch (e) { console.error('[remind] session push failed:', e.message); }
  }, { timezone: 'America/New_York' });

  cron.schedule('0 */3 * * *', async () => {
    try {
      const pull = pullBridge();
      if (pull.ok && pull.anchorFiles && pull.anchorFiles.length) {
        const apply    = applyAnchorUpdate(pull.anchorFiles);
        const fileList = pull.anchorFiles.map(f => '  • ' + f).join('\n');
        const applyLog = apply.log.map(l => '  ' + l).join('\n');
        await sendEmail('⚓ Anchor — Source Updated', `Files:\n${fileList}\n\nLog:\n${applyLog}`);
      }
    } catch (e) { console.error('[remind] 3hr cron error:', e.message); }
  });

  cron.schedule('*/15 * * * *', async () => {
    const due = getDueReminders();
    if (!due.length) return;
    for (const n of due) {
      const ref     = n.remind_num || n.id;
      const num     = n.remind_num ? `${n.remind_num}) ` : '';
      const preview = (n.formatted || n.raw_input || '').split('\n')[0].trim().substring(0, 60);
      const subject = `⏰ ${num}${preview}`;
      const body    = `${num}${n.formatted || n.raw_input}\n\n---\n${cmdBlock(ref)}\nanchor.thecasmas.com`;
      try {
        await sendEmail(subject, body);
        markReminderSent(n.id);
      } catch (e) { console.error('[remind] reminder email failed:', e.message); }
    }
  });

  console.log('[remind] scheduler ready');
}

module.exports = { startScheduler, buildDigestEmail, processCommands, isReminderCommand, nextRemindNum, parseReminderDate, parseRemindLine };

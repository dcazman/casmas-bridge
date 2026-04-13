'use strict';
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { db, getPending, getApiKey } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto');
const { fetchUrl, extractText, parseCat } = require('../lib/helpers');
const { parseReminderDate, parseRemindLine, nextRemindNum, nextLoopNum } = require('../lib/remind');
const { decryptNote } = require('../lib/db');

const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

async function extractImage(file) {
  const key = getApiKey();
  const base64 = file.buffer.toString('base64');
  const mediaType = /^image\//i.test(file.mimetype) ? file.mimetype : 'image/jpeg';
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: "Extract and transcribe all text from this image. If it's a screenshot, note, whiteboard, or document, reproduce the content faithfully. If it's a photo or diagram with no readable text, describe what you see concisely." }
      ]}]
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('Vision API error: ' + (data.error?.message || resp.status));
  return data.content?.[0]?.text || '[No text found in image]';
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } });

// POST /note  or  POST /notes
router.post('/', upload.single('file'), async (req, res) => {
  try {
    let raw = (req.body.raw||'').trim();
    if (req.file) {
      const isImg = /^image\//i.test(req.file.mimetype) || IMAGE_RE.test(req.file.originalname);
      const e = isImg ? await extractImage(req.file) : await extractText(req.file);
      const fn = (isImg ? '[Image: ' : '[File: ') + req.file.originalname + ']\n' + e.trim();
      raw = raw ? raw+'\n\n'+fn : fn;
    }
    const um = raw.match(/^(https?:\/\/\S+)$/);
    if (um) raw = await fetchUrl(um[1]);
    if (!raw) return res.json({ ok: false, error: 'No input' });

    // remind block — "remind" on its own line, then each subsequent line is a reminder
    // Also supports single-line: "remind thing, date"
    if (/^(?:r(?:em(?:ind(?:er)?)?)?|todo)\s*$/im.test(raw)) {
      // Multi-line block: "remind\nthing, date\nthing2, date2" (also accepts "r", "todo")
      const lines = raw.split('\n');
      const startIdx = lines.findIndex(l => /^(?:r(?:em(?:ind(?:er)?)?)?|todo)\s*$/i.test(l.trim()));
      const remindLines = lines.slice(startIdx + 1).filter(l => l.trim());
      for (const line of remindLines) {
        const { thing, dateStr } = parseRemindLine(line.trim());
        if (!thing) continue;
        const remindAt = parseReminderDate(dateStr).toISOString();
        const num = nextRemindNum();
        const enc = encrypt(thing);
        db.prepare("INSERT INTO notes (type,status,raw_input,formatted,remind_at,remind_num) VALUES ('remind','processed',?,?,?,?)").run(enc, enc, remindAt, num);
      }
      return res.json({ ok: true, pendingCount: getPending().count });
    }

    const remindMatch = raw.match(/^(?:r(?:em(?:ind(?:er)?)?)?|todo)\s+(.+)$/im);
    if (remindMatch) {
      // Single-line with optional extra detail below:
      //   remind dan taxes tomorrow 6pm
      //   other detail here         ← appended to thing
      const allLines = raw.split('\n');
      const remindLineIdx = allLines.findIndex(l => /^(?:r(?:em(?:ind(?:er)?)?)?|todo)\s+/i.test(l.trim()));
      const extraLines = allLines.slice(remindLineIdx + 1).filter(l => l.trim());
      const { thing, dateStr } = parseRemindLine(remindMatch[1].trim());
      const fullThing = extraLines.length ? thing + '\n' + extraLines.join('\n') : thing;
      const remindAt = parseReminderDate(dateStr).toISOString();
      const num = nextRemindNum();
      const enc = encrypt(fullThing);
      db.prepare("INSERT INTO notes (type,status,raw_input,formatted,remind_at,remind_num) VALUES ('remind','processed',?,?,?,?)").run(enc, enc, remindAt, num);
      return res.json({ ok: true, pendingCount: getPending().count });
    }

    const secs = parseCat(raw);
    if (secs.length > 0) {
      const ins = db.prepare('INSERT INTO notes (type,status,raw_input,formatted) VALUES (?,?,?,?)');
      let inserted = 0;
      db.transaction(s => {
        for (const sec of s) {
          // For list notes, expand comma-separated lines into individual items
          if (sec.type === 'list') {
            const expanded = [];
            for (const line of sec.lines) {
              if (line.trim() && !line.trim().match(/^\[.\]/) && line.includes(',')) {
                expanded.push(...line.split(',').map(l => l.trim()).filter(Boolean));
              } else {
                expanded.push(line);
              }
            }
            sec.lines = expanded;
          }
          const t = sec.lines.join('\n').trim();
          if (!t) continue;
          // Dedup: skip if identical formatted content already exists
          const enc = encrypt(t);
          const existing = db.prepare("SELECT id FROM notes WHERE formatted=? LIMIT 1").get(enc);
          if (!existing) {
            if (sec.type === 'open-loop') {
              const loopNum = nextLoopNum();
              const prefixed = `Loop #${loopNum}: ${t}`;
              const encPrefixed = encrypt(prefixed);
              db.prepare("INSERT INTO notes (type,status,raw_input,formatted,loop_num) VALUES (?,?,?,?,?)").run(sec.type, 'processed', encPrefixed, encPrefixed, loopNum);
            } else {
              ins.run(sec.type, 'processed', enc, enc);
            }
            inserted++;
          }
        }
      })(secs);
      return res.json({ ok: true, pendingCount: getPending().count, split: inserted });
    }

    // Dedup pending: skip if identical raw content already pending
    const encRaw = encrypt(raw);
    const existingPending = db.prepare("SELECT id FROM notes WHERE raw_input=? AND status='pending' LIMIT 1").get(encRaw);
    if (!existingPending) {
      db.prepare("INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)").run(encRaw, encRaw);
    }
    res.json({ ok: true, pendingCount: getPending().count });
  } catch(e) { console.error(e); res.json({ ok: false, error: e.message }); }
});

// GET /notes/:id — return note content (used by list checkbox toggle)
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.json({ ok: false, error: 'Invalid id' });
  try {
    const row = db.prepare('SELECT * FROM notes WHERE id=?').get(id);
    if (!row) return res.json({ ok: false, error: 'Not found' });
    res.json({ ok: true, formatted: decrypt(row.formatted) || '', type: row.type });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// DELETE /notes/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.json({ ok: false, error: 'Invalid id' });
  try { db.prepare('DELETE FROM notes WHERE id=?').run(id); res.json({ ok: true }); }
  catch(e) { res.json({ ok: false, error: e.message }); }
});

// PUT /notes/:id — edit formatted content and/or reclassify
// Always clears review status so the 👁 badge disappears after any edit or reclassify
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.json({ ok: false, error: 'Invalid id' });
  const { formatted, type } = req.body;
  try {
    const { ALL_TYPES } = require('../lib/helpers');
    if (formatted !== undefined && type && ALL_TYPES.includes(type)) {
      // Both content edit + reclassify
      db.prepare("UPDATE notes SET formatted=?, type=?, status='processed' WHERE id=?").run(encrypt(formatted), type, id);
    } else if (formatted !== undefined) {
      // Content edit only — also clear review status
      db.prepare("UPDATE notes SET formatted=?, status='processed' WHERE id=?").run(encrypt(formatted), id);
    } else if (type && ALL_TYPES.includes(type)) {
      if (type === 'remind') {
        // Reclassify to remind — parse remind_at from existing content
        const note = decryptNote(db.prepare('SELECT * FROM notes WHERE id=?').get(id));
        const content = note ? (note.formatted || note.raw_input || '') : '';
        const firstLine = content.split('\n')[0].trim();
        const { dateStr } = parseRemindLine(firstLine);
        const remindAt = parseReminderDate(dateStr).toISOString();
        const num = nextRemindNum();
        db.prepare("UPDATE notes SET type=?, status='processed', remind_at=?, remind_num=? WHERE id=?").run(type, remindAt, num, id);
      } else {
        db.prepare("UPDATE notes SET type=?, status='processed' WHERE id=?").run(type, id);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

// PATCH /notes/:id/remind — snooze: update remind_at and reset remind_sent so it fires again
router.patch('/:id/remind', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.json({ ok: false, error: 'Invalid id' });
  const { remind_at } = req.body;
  if (!remind_at) return res.json({ ok: false, error: 'remind_at required' });
  try {
    const iso = new Date(remind_at).toISOString();
    db.prepare("UPDATE notes SET remind_at=?, remind_sent=0 WHERE id=?").run(iso, id);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;

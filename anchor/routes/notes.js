'use strict';
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { db, getPending, getApiKey } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto');
const { fetchUrl, extractText, parseCat } = require('../lib/helpers');
const { parseReminderDate, nextRemindNum } = require('../lib/remind');

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
    function parseRemindLine(body) {
      let thing, dateStr;
      if (body.includes(',')) {
        const ci = body.indexOf(',');
        thing = body.slice(0, ci).trim();
        dateStr = body.slice(ci + 1).trim();
      } else {
        const dateM = body.match(/((?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2}(?::\d{2})?\s*(?:am|pm)|tom(?:orrow)?|\d+\s*(?:week|day)s?).*)$/i);
        if (dateM && dateM.index > 0) {
          thing = body.slice(0, dateM.index).trim();
          dateStr = dateM[1];
        } else {
          thing = body;
          dateStr = '';
        }
      }
      return { thing, dateStr };
    }

    if (/^(?:r(?:emind)?|todo)\s*$/im.test(raw)) {
      // Multi-line block: "remind\nthing, date\nthing2, date2" (also accepts "r", "todo")
      const lines = raw.split('\n');
      const startIdx = lines.findIndex(l => /^(?:r(?:emind)?|todo)\s*$/i.test(l.trim()));
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

    const remindMatch = raw.match(/^(?:r(?:emind)?|todo)\s+(.+)$/i);
    if (remindMatch) {
      // Single-line: "remind thing, date"
      const { thing, dateStr } = parseRemindLine(remindMatch[1].trim());
      const remindAt = parseReminderDate(dateStr).toISOString();
      const num = nextRemindNum();
      const enc = encrypt(thing);
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
            ins.run(sec.type, 'processed', enc, enc);
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
      // Reclassify only
      db.prepare("UPDATE notes SET type=?, status='processed' WHERE id=?").run(type, id);
    }
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;

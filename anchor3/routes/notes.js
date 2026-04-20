'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { db, decryptNote, getPending } = require('../lib/db');
const { parseCat, extractText, fetchUrl } = require('../lib/helpers');
const { encrypt } = require('../lib/crypto');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', (req, res) => {
  try {
    const { sort } = req.query;
    const order = sort === 'oldest' ? 'ORDER BY created_at ASC' : 'ORDER BY created_at DESC';
    const notes = db.prepare(`SELECT * FROM notes ${order} LIMIT 500`).all().map(decryptNote);
    res.json({ ok: true, notes });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const n = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
    if (!n) return res.json({ ok: false, error: 'Not found' });
    res.json({ ok: true, ...decryptNote(n) });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    let raw = req.body.raw || '';

    if (req.file) {
      const isImage = req.file.mimetype.startsWith('image/');
      if (isImage) {
        raw = '[IMAGE: ' + req.file.originalname + ']';
      } else {
        try { raw = await extractText(req.file); } catch (e) { raw = req.file.originalname + ' (unreadable)'; }
      }
    }

    if (!raw.trim()) return res.json({ ok: false, error: 'Empty note' });

    const urlMatch = raw.trim().match(/^(https?:\/\/\S+)$/);
    if (urlMatch) {
      try { raw = await fetchUrl(urlMatch[1]); } catch {}
    }

    const secs = parseCat(raw);
    if (!secs.length) {
      db.prepare("INSERT INTO notes (raw_input, formatted, status, type) VALUES (?,?,?,?)").run(
        encrypt(raw), encrypt(raw), 'pending', 'pending'
      );
      const { count } = getPending();
      return res.json({ ok: true, split: 1, pendingCount: count });
    }

    let created = 0;
    for (const sec of secs) {
      const text = sec.lines.join('\n');
      db.prepare("INSERT INTO notes (raw_input, formatted, status, type, tags) VALUES (?,?,?,?,?)").run(
        encrypt(text), encrypt(text), 'processed', sec.type, sec.label ? encrypt(sec.label) : null
      );
      created++;
    }
    const { count } = getPending();
    res.json({ ok: true, split: created, pendingCount: count });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.put('/:id', (req, res) => {
  try {
    const { formatted, tags } = req.body;
    if (formatted != null) db.prepare('UPDATE notes SET formatted=? WHERE id=?').run(encrypt(formatted), req.params.id);
    if (tags != null) db.prepare('UPDATE notes SET tags=? WHERE id=?').run(encrypt(tags), req.params.id);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;

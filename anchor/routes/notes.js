'use strict';
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { db, getPending } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto');
const { fetchUrl, extractText, parseCat } = require('../lib/helpers');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } });

// POST /note  or  POST /notes
router.post('/', upload.single('file'), async (req, res) => {
  try {
    let raw = (req.body.raw||'').trim();
    if (req.file) {
      const e = await extractText(req.file);
      const fn = '[File: '+req.file.originalname+']\n'+e.trim();
      raw = raw ? raw+'\n\n'+fn : fn;
    }
    const um = raw.match(/^(https?:\/\/\S+)$/);
    if (um) raw = await fetchUrl(um[1]);
    if (!raw) return res.json({ ok: false, error: 'No input' });

    const secs = parseCat(raw);
    if (secs.length > 0) {
      const ins = db.prepare('INSERT INTO notes (type,status,raw_input,formatted) VALUES (?,?,?,?)');
      let inserted = 0;
      db.transaction(s => {
        for (const sec of s) {
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

'use strict';
const express = require('express');
const multer  = require('multer');
const router  = express.Router();
const { db, getPending } = require('../lib/db');
const { encrypt } = require('../lib/crypto');
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
      db.transaction(s => { for (const sec of s) { const t=sec.lines.join('\n').trim(); ins.run(sec.type,'processed',encrypt(t),encrypt(t)); } })(secs);
      return res.json({ ok: true, pendingCount: getPending().count, split: secs.length });
    }
    db.prepare("INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)").run(encrypt(raw), encrypt(raw));
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

// PUT /notes/:id
router.put('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.json({ ok: false, error: 'Invalid id' });
  const { formatted, type } = req.body;
  try {
    if (formatted !== undefined) db.prepare('UPDATE notes SET formatted=? WHERE id=?').run(encrypt(formatted), id);
    const { ALL_TYPES } = require('../lib/helpers');
    if (type && ALL_TYPES.includes(type)) db.prepare('UPDATE notes SET type=? WHERE id=?').run(type, id);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;

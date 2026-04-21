'use strict';
const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { db, decryptNote, getPending, getApiKey } = require('../lib/db');
const { parseCat, extractText, fetchUrl } = require('../lib/helpers');
const { encrypt } = require('../lib/crypto');
const { parseReminderDate, parseRemindLine, nextRemindNum } = require('../lib/remind');

const ATTACH_DIR = '/attachments';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function summarizeAttachment(file) {
  try {
    const key = getApiKey();
    const isImage = file.mimetype.startsWith('image/');
    let content;
    if (isImage) {
      const base64 = file.buffer.toString('base64');
      content = [
        { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: base64 } },
        { type: 'text', text: 'Briefly describe this image in 1-2 sentences.' }
      ];
    } else {
      let text = '';
      try { text = await extractText(file); } catch { text = file.originalname; }
      content = [{ type: 'text', text: `Summarize this file content in 1-2 sentences:\n\n${text.slice(0, 3000)}` }];
    }
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 200, messages: [{ role: 'user', content }] })
    });
    const data = await resp.json();
    return data.content?.[0]?.text || '';
  } catch { return ''; }
}

function saveFileToDisk(file) {
  if (!fs.existsSync(ATTACH_DIR)) fs.mkdirSync(ATTACH_DIR, { recursive: true });
  const ext = path.extname(file.originalname).toLowerCase() || '';
  const filename = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(ATTACH_DIR, filename), file.buffer);
  return filename;
}

function getAttachmentsForNotes(noteIds) {
  if (!noteIds.length) return {};
  const placeholders = noteIds.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM attachments WHERE note_id IN (${placeholders})`).all(...noteIds);
  const map = {};
  for (const a of rows) {
    if (!map[a.note_id]) map[a.note_id] = [];
    map[a.note_id].push({ id: a.id, filename: a.filename, original_name: a.original_name, mime_type: a.mime_type, size_bytes: a.size_bytes, summary: a.summary });
  }
  return map;
}

router.get('/', (req, res) => {
  try {
    const { sort } = req.query;
    const order = sort === 'oldest' ? 'ORDER BY created_at ASC' : 'ORDER BY created_at DESC';
    const notes = db.prepare(`SELECT * FROM notes WHERE type != 'private-thoughts' ${order} LIMIT 500`).all().map(decryptNote);
    const attachMap = getAttachmentsForNotes(notes.map(n => n.id));
    const result = notes.map(n => ({ ...n, attachments: attachMap[n.id] || [] }));
    res.json({ ok: true, notes: result });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.get('/:id', (req, res) => {
  try {
    const n = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
    if (!n) return res.json({ ok: false, error: 'Not found' });
    const note = decryptNote(n);
    const attachments = db.prepare('SELECT * FROM attachments WHERE note_id=?').all(note.id);
    res.json({ ok: true, ...note, attachments });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    let raw = req.body.raw || '';
    let savedAttachment = null;

    if (req.file) {
      const summary = await summarizeAttachment(req.file);
      const filename = saveFileToDisk(req.file);
      savedAttachment = { filename, original_name: req.file.originalname, mime_type: req.file.mimetype, size_bytes: req.file.buffer.length, summary };

      // If no text provided, use summary as note text
      if (!raw.trim()) {
        raw = `[Attachment: ${req.file.originalname}]${summary ? '\n' + summary : ''}`;
      }
    }

    if (!raw.trim()) return res.json({ ok: false, error: 'Empty note' });

    const urlMatch = raw.trim().match(/^(https?:\/\/\S+)$/);
    if (urlMatch) {
      try { raw = await fetchUrl(urlMatch[1]); } catch {}
    }

    const secs = parseCat(raw);
    if (!secs.length) {
      const result = db.prepare("INSERT INTO notes (raw_input, formatted, status, type) VALUES (?,?,?,?)").run(
        encrypt(raw), encrypt(raw), 'pending', 'pending'
      );
      if (savedAttachment) {
        db.prepare("INSERT INTO attachments (note_id, filename, original_name, mime_type, size_bytes, summary) VALUES (?,?,?,?,?,?)").run(
          result.lastInsertRowid, savedAttachment.filename, savedAttachment.original_name, savedAttachment.mime_type, savedAttachment.size_bytes, savedAttachment.summary
        );
      }
      const { count } = getPending();
      return res.json({ ok: true, split: 1, pendingCount: count });
    }

    let created = 0;
    let firstNoteId = null;
    for (const sec of secs) {
      const text = sec.lines.join('\n');
      let noteId;
      if (sec.type === 'remind') {
        const firstLine = sec.lines[0] ? sec.lines[0].trim() : '';
        const { thing, dateStr } = parseRemindLine(firstLine);
        const content = thing || text;
        const remindAt = parseReminderDate(dateStr).toISOString();
        const num = nextRemindNum();
        const enc = encrypt(content);
        const result = db.prepare("INSERT INTO notes (raw_input, formatted, status, type, remind_at, remind_num, tags) VALUES (?,?,?,?,?,?,?)").run(
          enc, enc, 'processed', 'remind', remindAt, num, sec.label ? encrypt(sec.label) : null
        );
        noteId = result.lastInsertRowid;
      } else {
        const result = db.prepare("INSERT INTO notes (raw_input, formatted, status, type, tags) VALUES (?,?,?,?,?)").run(
          encrypt(text), encrypt(text), 'processed', sec.type, sec.label ? encrypt(sec.label) : null
        );
        noteId = result.lastInsertRowid;
      }
      if (firstNoteId === null) firstNoteId = noteId;
      created++;
    }

    if (savedAttachment && firstNoteId !== null) {
      db.prepare("INSERT INTO attachments (note_id, filename, original_name, mime_type, size_bytes, summary) VALUES (?,?,?,?,?,?)").run(
        firstNoteId, savedAttachment.filename, savedAttachment.original_name, savedAttachment.mime_type, savedAttachment.size_bytes, savedAttachment.summary
      );
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
    // Also remove attachment files from disk
    const attachments = db.prepare('SELECT filename FROM attachments WHERE note_id=?').all(req.params.id);
    for (const a of attachments) {
      const fp = path.join(ATTACH_DIR, a.filename);
      if (fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch {} }
    }
    db.prepare('DELETE FROM attachments WHERE note_id=?').run(req.params.id);
    db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;

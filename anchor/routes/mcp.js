'use strict';
const express = require('express');
const router  = express.Router();
const { db, decryptNote } = require('../lib/db');
const { WORK_TYPES } = require('../lib/helpers');
const { encrypt } = require('../lib/crypto');

function isMcp(req) { return req.headers['x-mcp-caller'] !== undefined; }
function filterCaller(notes, caller) { return caller === 'work' ? notes.filter(n => WORK_TYPES.includes(n.type)) : notes; }

router.post('/notes', (req, res) => {
  if (!isMcp(req)) return res.status(403).json({ error: 'Forbidden' });
  const { type, limit=20, sort='newest', label, caller } = req.body;
  const so = { 'newest': 'ORDER BY created_at DESC', 'oldest': 'ORDER BY created_at ASC', 'open-loops': "ORDER BY (open_loops IS NOT NULL AND open_loops!='') DESC,created_at DESC" };
  let q = "SELECT * FROM notes WHERE status='processed'"; const p = [];
  if (type)  { q += ' AND type=?'; p.push(type); }
  if (label) { q += ' AND tags LIKE ?'; p.push('%'+label+'%'); }
  q += ' ' + (so[sort]||so['newest']) + ' LIMIT ?'; p.push(limit);
  const notes = db.prepare(q).all(...p).map(decryptNote);
  const f = filterCaller(notes, caller);
  res.json({ notes: f, count: f.length, caller });
});

router.post('/search', (req, res) => {
  if (!isMcp(req)) return res.status(403).json({ error: 'Forbidden' });
  const { query, caller } = req.body;
  if (!query) return res.json({ notes: [], count: 0 });
  const notes = db.prepare("SELECT * FROM notes WHERE status='processed' AND (formatted LIKE ? OR tags LIKE ? OR raw_input LIKE ?) ORDER BY created_at DESC LIMIT 30")
    .all('%'+query+'%','%'+query+'%','%'+query+'%').map(decryptNote);
  const f = filterCaller(notes, caller);
  res.json({ notes: f, count: f.length, query, caller });
});

router.post('/open-loops', (req, res) => {
  if (!isMcp(req)) return res.status(403).json({ error: 'Forbidden' });
  const { caller } = req.body;
  const notes = db.prepare("SELECT * FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!='' ORDER BY created_at DESC").all().map(decryptNote);
  const f = filterCaller(notes, caller);
  res.json({ notes: f, count: f.length, caller });
});

router.post('/summary', (req, res) => {
  if (!isMcp(req)) return res.status(403).json({ error: 'Forbidden' });
  const { days=7, caller } = req.body;
  const since = new Date(); since.setDate(since.getDate() - days);
  const notes = db.prepare("SELECT * FROM notes WHERE status='processed' AND created_at>=? ORDER BY created_at DESC").all(since.toISOString()).map(decryptNote);
  const f = filterCaller(notes, caller);
  const byType = {}; for (const n of f) byType[n.type] = (byType[n.type]||0) + 1;
  res.json({ notes: f, count: f.length, byType, days, caller });
});

router.delete('/notes/:id', (req, res) => {
  if (!req.headers['x-mcp-caller']) return res.status(403).json({ error: 'Forbidden' });
  const id = parseInt(req.params.id);
  if (!id) return res.json({ ok: false, error: 'Invalid' });
  db.prepare('DELETE FROM notes WHERE id=?').run(id);
  res.json({ ok: true });
});

module.exports = router;

'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const { db, getApiKey, setLastSync, getPending } = require('../lib/db');
const { encrypt, decrypt }  = require('../lib/crypto');
const { logUsage }          = require('../lib/usage');
const { isReminderCommand, processCommands, nextRemindNum } = require('../lib/remind');

const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://192.168.50.50:11434';
const USE_OLLAMA  = process.env.USE_OLLAMA === 'true';
const OLLAMA_PROMPT_PATH = '/bridge/md/ollama-system-prompt.md';

function loadOllamaPrompt() {
  try { return fs.readFileSync(OLLAMA_PROMPT_PATH, 'utf8').trim(); }
  catch { return 'You are Anchor, Dan Casmas\'s personal AI organizer.'; }
}

async function callAI(system, userContent) {
  if (USE_OLLAMA) {
    const ollamaSystem = loadOllamaPrompt() + '\n\n' + system;
    const resp = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mistral', format: 'json', stream: false, messages: [{ role: 'system', content: ollamaSystem }, { role: 'user', content: userContent }] })
    });
    const data = await resp.json();
    return { text: data.message?.content || '', usage: null };
  } else {
    const key = getApiKey();
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL_HAIKU, max_tokens: 8192, system, messages: [{ role: 'user', content: userContent }] })
    });
    const data = await resp.json();
    return { text: data.content[0].text, usage: data.usage };
  }
}

router.post('/', async (req, res) => {
  const pending = db.prepare("SELECT id,raw_input FROM notes WHERE status='pending'").all();
  if (!pending.length) return res.json({ ok: true, processed: 0 });

  // ── 1. Split: reminder commands vs regular notes ───────────────────────────
  const commands = [];
  const regular  = [];

  for (const n of pending) {
    const text = decrypt(n.raw_input) || '';
    if (isReminderCommand(text)) {
      commands.push({ id: n.id, text });
    } else {
      regular.push(n);
    }
  }

  // ── 2. Process reminder commands (done N, snooze N, change N) ─────────────
  let commandResults = [];
  for (const cmd of commands) {
    const results = processCommands(cmd.text);
    commandResults = commandResults.concat(results);
    db.prepare('DELETE FROM notes WHERE id=?').run(cmd.id);
    console.log('[sync] command note', cmd.id, ':', cmd.text.substring(0, 60));
  }

  if (!regular.length) {
    setLastSync();
    return res.json({ ok: true, processed: 0, commands: commandResults.length, commandDetail: commandResults });
  }

  // ── 3. Classify via AI ─────────────────────────────────────────────────────
  const dec   = regular.map(n => ({ id: n.id, text: decrypt(n.raw_input) }));
  const gr    = db.prepare("SELECT formatted FROM notes WHERE type='pi' AND formatted LIKE '%Classification Guide%' ORDER BY created_at DESC LIMIT 1").get();
  const guide = gr ? decrypt(gr.formatted) : '';

  const SYS = `You are Anchor, Dan Casmas's AI organizer.
${guide ? 'GUIDE:\n' + guide : ''}
Classify each note. Split multi-topic notes.

REMINDERS: If a note contains reminder intent — phrases like "remind me", "remind dan", "don't forget", "remember to", "don't let me forget" — set remind_at to an ISO 8601 datetime string parsed from the note text (America/New_York timezone). Use today's date as the base for relative dates. If no specific time is given use null. Examples:
  "remind dan take meds friday 3pm" → remind_at: "2026-04-10T15:00:00"
  "remind me call vet tomorrow 10am" → remind_at: "2026-04-07T10:00:00"
  "don't forget to buy dog food" → remind_at: null

Return a JSON array. Each object must have: source_id, type, formatted, tags, open_loops, uncertain, proposed_type, remind_at (string or null).
Only JSON. No markdown.`;

  try {
    const { text, usage } = await callAI(SYS, 'Today is ' + new Date().toISOString() + '\nProcess:\n' + JSON.stringify(dec));
    if (usage) logUsage(usage.input_tokens, usage.output_tokens, USE_OLLAMA ? 'ollama' : MODEL_HAIKU, 'sync');

    const parsed  = JSON.parse(text.replace(/```json|```/g, '').trim());
    const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.notes || [parsed]);
    const ins     = db.prepare('INSERT INTO notes (type,status,raw_input,formatted,tags,open_loops) VALUES (?,?,?,?,?,?)');
    const flag    = db.prepare("UPDATE notes SET status='review',type='brain-dump' WHERE id=?");

    db.transaction(items => {
      const seen = new Set();
      for (const it of items) {
        if (it.uncertain) {
          if (!seen.has(it.source_id)) { flag.run(it.source_id); seen.add(it.source_id); }
          continue;
        }
        if (!seen.has(it.source_id)) {
          db.prepare("UPDATE notes SET type=?,status='processed',formatted=?,tags=?,open_loops=? WHERE id=?")
            .run(it.type, encrypt(it.formatted), encrypt(it.tags || ''), encrypt(it.open_loops || ''), it.source_id);
          seen.add(it.source_id);
          // Assign reminder number if AI detected intent
          if (it.remind_at) {
            const num = nextRemindNum();
            db.prepare('UPDATE notes SET remind_at=?,remind_sent=0,remind_num=? WHERE id=?')
              .run(it.remind_at, num, it.source_id);
            console.log(`[sync] reminder set — note ${it.source_id}, num ${num}, at ${it.remind_at}`);
          }
        } else {
          const newId = ins.run(it.type, 'processed', encrypt(it.formatted), encrypt(it.formatted), encrypt(it.tags || ''), encrypt(it.open_loops || '')).lastInsertRowid;
          if (it.remind_at) {
            const num = nextRemindNum();
            db.prepare('UPDATE notes SET remind_at=?,remind_sent=0,remind_num=? WHERE id=?')
              .run(it.remind_at, num, newId);
          }
        }
      }
    })(results);

    setLastSync();
    res.json({
      ok:        true,
      processed: results.filter(r => !r.uncertain).length,
      flagged:   results.filter(r => r.uncertain).length,
      reminders: results.filter(r => r.remind_at).length,
      splits:    Math.max(0, results.length - regular.length),
      commands:  commandResults.length,
      engine:    USE_OLLAMA ? 'ollama' : 'anthropic'
    });
  } catch(e) {
    console.error(e);
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;

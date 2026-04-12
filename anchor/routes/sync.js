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

// Types that should never be reclassified by the sync engine
const PROTECTED_TYPES = new Set(['list', 'pi', 'summary', 'anchor', 'employment', 'claude-handoff']);

function loadOllamaPrompt() {
  try { return fs.readFileSync(OLLAMA_PROMPT_PATH, 'utf8').trim(); }
  catch { return 'You are Anchor, Dan Casmas\'s personal AI organizer.'; }
}

function extractJSON(raw) {
  let s = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const arrStart = s.indexOf('[');
  const objStart = s.indexOf('{');
  const start = (arrStart === -1) ? objStart : (objStart === -1) ? arrStart : Math.min(arrStart, objStart);
  if (start === -1) throw new Error('No JSON structure found in AI response');
  if (arrStart !== -1 && (objStart === -1 || arrStart <= objStart)) {
    const end = s.lastIndexOf(']');
    if (end !== -1) { try { return JSON.parse(s.substring(arrStart, end + 1)); } catch {} }
  }
  const end = s.lastIndexOf('}');
  if (end !== -1) { try { return JSON.parse(s.substring(objStart, end + 1)); } catch {} }
  throw new Error('Could not parse JSON from AI response');
}

// Stuck notes become random/processed — no review status
function flagStuck(ids, reason) {
  const stmt = db.prepare("UPDATE notes SET status='processed', type='random' WHERE id=?");
  for (const id of ids) {
    stmt.run(id);
    console.warn(`[sync] flagged note ${id} as random — ${reason}`);
  }
}

async function callAI(system, userContent) {
  if (USE_OLLAMA) {
    const ollamaSystem = loadOllamaPrompt() + '\n\n' + system;
    const resp = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'mistral',
        format: 'json',
        stream: false,
        messages: [
          { role: 'system', content: ollamaSystem },
          { role: 'user',   content: userContent }
        ]
      })
    });
    if (!resp.ok) throw new Error('Ollama HTTP ' + resp.status);
    const data = await resp.json();
    const text = data.message?.content || data.response || '';
    if (!text) throw new Error('Ollama returned empty content');
    return { text, usage: null };
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
  const pending = db.prepare("SELECT id,type,raw_input FROM notes WHERE status='pending'").all();
  console.log(`[sync] POST received — ${pending.length} pending notes, ids: ${pending.map(n=>n.id).join(',')}`);
  if (!pending.length) return res.json({ ok: true, processed: 0 });

  // Auto-process protected types — never send to AI
  const protectedNotes = pending.filter(n => PROTECTED_TYPES.has(n.type));
  if (protectedNotes.length) {
    const protectedStmt = db.prepare("UPDATE notes SET status='processed' WHERE id=?");
    for (const n of protectedNotes) {
      protectedStmt.run(n.id);
      console.log(`[sync] protected note ${n.id} (type=${n.type}) — marked processed, skipping AI`);
    }
  }

  const unprotected = pending.filter(n => !PROTECTED_TYPES.has(n.type));

  const commands = [];
  const regular  = [];
  for (const n of unprotected) {
    const text = decrypt(n.raw_input) || '';
    if (isReminderCommand(text)) commands.push({ id: n.id, text });
    else regular.push(n);
  }

  let commandResults = [];
  for (const cmd of commands) {
    const results = processCommands(cmd.text);
    commandResults = commandResults.concat(results);
    db.prepare('DELETE FROM notes WHERE id=?').run(cmd.id);
  }

  if (!regular.length) {
    setLastSync();
    return res.json({ ok: true, processed: protectedNotes.length, protected: protectedNotes.length, commands: commandResults.length, commandDetail: commandResults });
  }

  const dec   = regular.map(n => ({ id: n.id, text: decrypt(n.raw_input) }));
  const gr    = db.prepare("SELECT formatted FROM notes WHERE type='pi' AND formatted LIKE '%Classification Guide%' ORDER BY created_at DESC LIMIT 1").get();
  const guide = gr ? decrypt(gr.formatted) : '';

  const SYS = `You are Anchor, Dan Casmas's AI organizer.
${guide ? 'GUIDE:\n' + guide : ''}
Classify each note. Split multi-topic notes. Never use type 'brain-dump'.

CONFIDENCE RULE: Rate your confidence 1-10 before committing to a type.
- 7 or above → commit to your best guess, set uncertain=false
- 6 or below → set uncertain=true (the note goes to random for manual review)
A recipe, research note, or how-to guide you recognize is always a 7+. Only truly cryptic or garbled notes score below 6.

REMINDERS: If a note contains reminder intent — phrases like "remind me", "remind dan", "don't forget", "remember to", "don't let me forget" — set remind_at to an ISO 8601 datetime string parsed from the note text (America/New_York timezone). Use today's date as the base for relative dates. If no specific time is given use null.

Return ONLY a JSON array. Each object must have: source_id, type, formatted, tags, open_loops, uncertain, proposed_type, remind_at (string or null).
No markdown. No explanation. Only the JSON array.`;

  const regularIds = regular.map(n => n.id);

  try {
    const { text, usage } = await callAI(SYS, 'Today is ' + new Date().toISOString() + '\nProcess:\n' + JSON.stringify(dec));
    if (usage) logUsage(usage.input_tokens, usage.output_tokens, USE_OLLAMA ? 'ollama' : MODEL_HAIKU, 'sync');

    let parsed;
    try {
      parsed = extractJSON(text);
    } catch (parseErr) {
      console.error('[sync] JSON parse failed:', parseErr.message);
      flagStuck(regularIds, 'AI returned unparseable response');
      setLastSync();
      return res.json({ ok: true, processed: 0, flagged: regularIds.length, error: 'AI response could not be parsed', engine: USE_OLLAMA ? 'ollama' : 'anthropic' });
    }

    const results = Array.isArray(parsed) ? parsed : (parsed.results || parsed.notes || [parsed]);

    if (!results.length) {
      flagStuck(regularIds, 'AI returned empty results');
      setLastSync();
      return res.json({ ok: true, processed: 0, flagged: regularIds.length, engine: USE_OLLAMA ? 'ollama' : 'anthropic' });
    }

    const flagUncertain = db.prepare("UPDATE notes SET status='processed', type='random' WHERE id=?");
    const ins = db.prepare('INSERT INTO notes (type,status,raw_input,formatted,tags,open_loops) VALUES (?,?,?,?,?,?)');

    db.transaction(items => {
      const seen = new Set();
      for (const it of items) {
        const sid = it.source_id ?? it.id;
        if (sid == null) continue;
        if (it.uncertain) {
          if (!seen.has(sid)) { flagUncertain.run(sid); seen.add(sid); }
          continue;
        }
        if (!seen.has(sid)) {
          const changes = db.prepare("UPDATE notes SET type=?,status='processed',formatted=?,tags=?,open_loops=? WHERE id=?")
            .run(it.type, encrypt(it.formatted), encrypt(it.tags || ''), encrypt(it.open_loops || ''), sid).changes;
          if (changes === 0) console.warn(`[sync] UPDATE matched 0 rows for source_id=${sid}`);
          seen.add(sid);
          if (it.remind_at) {
            const num = nextRemindNum();
            db.prepare('UPDATE notes SET remind_at=?,remind_sent=0,remind_num=? WHERE id=?').run(it.remind_at, num, sid);
          }
        } else {
          const newId = ins.run(it.type, 'processed', encrypt(it.formatted), encrypt(it.formatted), encrypt(it.tags || ''), encrypt(it.open_loops || '')).lastInsertRowid;
          if (it.remind_at) {
            const num = nextRemindNum();
            db.prepare('UPDATE notes SET remind_at=?,remind_sent=0,remind_num=? WHERE id=?').run(it.remind_at, num, newId);
          }
        }
      }
    })(results);

    const stillPending = db.prepare("SELECT id FROM notes WHERE id IN (" + regularIds.map(()=>'?').join(',') + ") AND status='pending'").all(...regularIds);
    if (stillPending.length) flagStuck(stillPending.map(n => n.id), 'not matched by AI response');

    setLastSync();
    res.json({
      ok:        true,
      processed: results.filter(r => !r.uncertain).length,
      protected: protectedNotes.length,
      flagged:   results.filter(r => r.uncertain).length + stillPending.length,
      reminders: results.filter(r => r.remind_at).length,
      splits:    Math.max(0, results.length - regular.length),
      commands:  commandResults.length,
      engine:    USE_OLLAMA ? 'ollama' : 'anthropic'
    });
  } catch(e) {
    console.error('[sync] unexpected error:', e);
    try { flagStuck(regularIds, 'unexpected error: ' + e.message); } catch {}
    setLastSync();
    res.json({ ok: false, error: e.message });
  }
});

module.exports = router;

'use strict';
const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const { db, getApiKey, setLastSync, getPending } = require('../lib/db');
const { encrypt, decrypt } = require('../lib/crypto');
const { logUsage } = require('../lib/usage');

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
      body: JSON.stringify({ model: 'llama3.2:3b', stream: false, messages: [{ role: 'system', content: ollamaSystem }, { role: 'user', content: userContent }] })
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

  const dec = pending.map(n => ({ id: n.id, text: decrypt(n.raw_input) }));
  const gr = db.prepare("SELECT formatted FROM notes WHERE type='pi' AND formatted LIKE '%Classification Guide%' ORDER BY created_at DESC LIMIT 1").get();
  const guide = gr ? decrypt(gr.formatted) : '';

  const SYS = `You are Anchor, Dan Casmas's AI organizer.\n${guide ? 'GUIDE:\n'+guide : ''}\nClassify each note. Split multi-topic notes.\nReturn a JSON array of objects with: source_id, type, formatted, tags, open_loops, uncertain, proposed_type.\nOnly JSON. No markdown.`;

  try {
    const { text, usage } = await callAI(SYS, 'Process:\n' + JSON.stringify(dec));
    if (usage) logUsage(usage.input_tokens, usage.output_tokens, USE_OLLAMA ? 'ollama' : MODEL_HAIKU, 'sync');

    const results = JSON.parse(text.replace(/```json|```/g,'').trim());
    const ins  = db.prepare('INSERT INTO notes (type,status,raw_input,formatted,tags,open_loops) VALUES (?,?,?,?,?,?)');
    const flag = db.prepare("UPDATE notes SET status='review',type='brain-dump' WHERE id=?");

    db.transaction(items => {
      const seen = new Set();
      for (const it of items) {
        if (it.uncertain) { if (!seen.has(it.source_id)) { flag.run(it.source_id); seen.add(it.source_id); } continue; }
        if (!seen.has(it.source_id)) {
          db.prepare("UPDATE notes SET type=?,status='processed',formatted=?,tags=?,open_loops=? WHERE id=?")
            .run(it.type, encrypt(it.formatted), encrypt(it.tags||''), encrypt(it.open_loops||''), it.source_id);
          seen.add(it.source_id);
        } else {
          ins.run(it.type,'processed',encrypt(it.formatted),encrypt(it.formatted),encrypt(it.tags||''),encrypt(it.open_loops||''));
        }
      }
    })(results);

    setLastSync();
    res.json({ ok: true, processed: results.filter(r=>!r.uncertain).length, flagged: results.filter(r=>r.uncertain).length, splits: Math.max(0, results.length - pending.length), engine: USE_OLLAMA ? 'ollama' : 'anthropic' });
  } catch(e) { console.error(e); res.json({ ok: false, error: e.message }); }
});

module.exports = router;

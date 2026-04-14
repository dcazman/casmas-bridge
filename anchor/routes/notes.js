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

// Infer a project/topic label from type + text content
function inferLabel(type, text) {
  const t = (text || '').toLowerCase();
  // Skip types that are already self-labeling
  const selfLabeled = ['Kathie-Wife','Zach-Son','Ethan-Son','Andy-FatherInLaw','Maureen-Aunt','Kathy-Aunt',
    'Micky-Stepmother','Lee-Brother','Charity-SisterInLaw','Kevin-Dog','Mat-Cat','Phil-Cat','Ace-Cat',
    'Herschel-Lizard','hens','hey-hey-Rooster','claude-handoff','work-claude-handoff','system-summary'];
  if (selfLabeled.includes(type)) return null;

  // Personal project detection (applies to personal-*, work-*, random, list, pi, remind, open-loop, anchor, etc.)
  if (/casmas.?bridge|anchor\s*2\.0|anchor.?mcp|anchor.*note.*system|note.*system.*anchor/.test(t)) return 'casmas-bridge';
  if (/code.?index|codeindex|rooster.*embed|embed.*rooster|vector.*search|semantic.*search.*repo|repo.*embed/.test(t)) return 'code-index';
  if (/drivecopy|drive.?copy|copy.*drive.*job|google.*drive.*copy|argocd.*drive|drive.*k8s/.test(t)) return 'drivecopy';
  if (/ollama\b|mac mini.*m4|m4 pro.*ram|local.*llm.*hardware|buy.*mac|dedicated.*llm/.test(t)) return 'ollama-hw';
  if (/driveactions|drive.?doc.?actions|docactions/.test(t)) return 'driveactions';
  if (/gutils|google.?utils|gamadv|gam\b.*google|google.*\bgam\b/.test(t)) return 'google-utils';
  if (/argocd|argo.?cd/.test(t)) return 'argocd';
  if (/statuspage/.test(t)) return 'statuspage';
  if (/alexa.*anchor|siri.*anchor|voice.*anchor|anchor.*alexa|anchor.*siri|lambda.*anchor|shortcut.*anchor/.test(t)) return 'voice-anchor';
  if (/plex|sonarr|radarr|sabnzbd|bazarr|nzbd|home.*media.*server|media.*arr/.test(t)) return 'home-media';
  if (/proxmox|truenas|openmediavault|\bomv\b|homelab|home.?lab|nas\b/.test(t)) return 'homelab';
  if (/got.?your.?back|gyb\b/.test(t)) return 'gyb';

  // Work-specific
  if (type.startsWith('work-')) {
    if (/sonos/.test(t)) return 'sonos';
    if (/onboard|offboard|new hire|termination|provisioning|deprovisioning/.test(t)) return 'hr-it';
    if (/google workspace|gsuite|gam\b|gmail.*admin|google.*admin/.test(t)) return 'google-workspace';
    if (/network|switch|firewall|vlan|vpn|infra|server|vm\b|virtual machine|subnet/.test(t)) return 'infrastructure';
    if (/jira|helpdesk|service desk|support.*ticket|ticket.*support/.test(t)) return 'it-support';
    if (/budget|cost|spend|license|renewal|invoice|vendor|contract/.test(t)) return 'budget';
    if (/security|sso|saml|okta|mfa|2fa|zero.?trust|phishing/.test(t)) return 'security';
    if (/slack|zoom|teams|comms|communication/.test(t)) return 'comms';
    return 'work-general';
  }

  // Health
  if (type.startsWith('health-')) {
    if (/weight|diet|calor|food|eat|meal|nutrition|macro/.test(t)) return 'diet';
    if (/workout|gym|exercise|run|walk|bike|lift|strength|cardio|steps/.test(t)) return 'fitness';
    if (/sleep|rest|insomnia/.test(t)) return 'sleep';
    if (/doctor|dentist|appoint|medical|rx\b|prescription|medication|symptoms/.test(t)) return 'medical';
    if (/mental|stress|anxiety|mood|depress|therapy/.test(t)) return 'mental-health';
    return 'general-health';
  }

  // Finance
  if (type.startsWith('finance-')) {
    if (/tax|irs|w2|1099|deduct|filing/.test(t)) return 'taxes';
    if (/invest|stock|retire|401k|\bira\b|brokerage|etf|index fund|vanguard/.test(t)) return 'investing';
    if (/mortgage|home.loan|refi|refinanc/.test(t)) return 'mortgage';
    if (/budget|spend|bill|subscription|expense/.test(t)) return 'budget';
    if (/insurance/.test(t)) return 'insurance';
    return 'general-finance';
  }

  return null;
}

// POST /note  or  POST /notes
router.post('/', upload.single('file'), async (req, res) => {
  try {
    let raw = (req.body.raw||'').trim();

    // Temporary admin: bulk-label all processed notes by keyword inference
    if (raw === '__BULKLABEL__') {
      const allNotes = db.prepare("SELECT * FROM notes WHERE status='processed'").all().map(decryptNote);
      const labeled = [], skipped = [], unchanged = [];
      for (const note of allNotes) {
        const text = note.formatted || note.raw_input || '';
        const inferred = inferLabel(note.type, text);
        if (!inferred) {
          skipped.push({ id: note.id, type: note.type });
          continue;
        }
        if (note.tags === inferred) { unchanged.push({ id: note.id, type: note.type, label: inferred }); continue; }
        db.prepare("UPDATE notes SET tags=? WHERE id=?").run(encrypt(inferred), note.id);
        labeled.push({ id: note.id, type: note.type, label: inferred, prev: note.tags || '' });
      }
      return res.json({ ok: false, error: JSON.stringify({ labeled, skipped, unchanged, total: allNotes.length }) });
    }

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
    res.json({ ok: true, formatted: decrypt(row.formatted) || '', raw_input: decrypt(row.raw_input) || '', type: row.type });
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
  const { formatted, type, tags } = req.body;
  try {
    const { ALL_TYPES } = require('../lib/helpers');
    const hasFmt  = formatted !== undefined;
    const hasType = type && ALL_TYPES.includes(type);
    const hasTags = tags !== undefined;
    if (hasFmt && hasType && hasTags) {
      db.prepare("UPDATE notes SET formatted=?, type=?, tags=?, status='processed' WHERE id=?").run(encrypt(formatted), type, encrypt(tags), id);
    } else if (hasFmt && hasType) {
      db.prepare("UPDATE notes SET formatted=?, type=?, status='processed' WHERE id=?").run(encrypt(formatted), type, id);
    } else if (hasFmt && hasTags) {
      db.prepare("UPDATE notes SET formatted=?, tags=?, status='processed' WHERE id=?").run(encrypt(formatted), encrypt(tags), id);
    } else if (hasFmt) {
      // Content edit only — also clear review status
      db.prepare("UPDATE notes SET formatted=?, status='processed' WHERE id=?").run(encrypt(formatted), id);
    } else if (hasType) {
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
    } else if (hasTags) {
      db.prepare("UPDATE notes SET tags=?, status='processed' WHERE id=?").run(encrypt(tags), id);
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

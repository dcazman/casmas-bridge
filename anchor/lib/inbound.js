'use strict';
const Imap         = require('imap');
const { simpleParser } = require('mailparser');
const { db }       = require('./db');
const { encrypt }  = require('./crypto');
const { parseReminderDate, parseRemindLine, nextRemindNum, nextLoopNum } = require('./remind');

const IMAP_HOST    = process.env.IMAP_HOST || 'mail.privateemail.com';
const IMAP_PORT    = parseInt(process.env.IMAP_PORT || '993');
const IMAP_USER    = process.env.IMAP_USER || '';
const IMAP_PASS    = process.env.IMAP_PASS || '';
const ANCHOR_ADDR  = (process.env.ANCHOR_INBOUND || 'anchor@thecasmas.com').toLowerCase();

const inboundEnabled = !!(IMAP_USER && IMAP_PASS);

// Known Anchor types accepted as subject lines (case-insensitive)
const VALID_TYPES = [
  'task', 'idea', 'remind', 'reminder', 'todo',
  'personal-project', 'open-loop', 'decision',
  'health', 'finance', 'recipe', 'meeting', 'note'
];

// Normalize subject to internal type
function resolveType(subject) {
  const s = (subject || '').trim().toLowerCase();
  if (s === 'reminder' || s === 'todo') return 'remind';
  if (s === 'note') return 'personal-project';
  if (VALID_TYPES.includes(s)) return s;
  return null;
}

function insertNote(type, body, tags) {
  const enc = encrypt(body);
  if (type === 'remind') {
    const firstLine = body.split('\n')[0].trim();
    const { thing, dateStr } = parseRemindLine(firstLine);
    const content = thing || body;
    const remindAt = parseReminderDate(dateStr).toISOString();
    const num = nextRemindNum();
    const encContent = encrypt(content);
    db.prepare("INSERT INTO notes (type,status,raw_input,formatted,remind_at,remind_num,tags) VALUES ('remind','processed',?,?,?,?,?)")
      .run(encContent, encContent, remindAt, num, tags);
    console.log(`[inbound] remind #${num} inserted`);
  } else if (type === 'open-loop') {
    const loopNum = nextLoopNum();
    const prefixed = `Loop #${loopNum}: ${body}`;
    const encPrefixed = encrypt(prefixed);
    db.prepare("INSERT INTO notes (type,status,raw_input,formatted,loop_num,tags) VALUES (?,?,?,?,?,?)")
      .run(type, 'processed', encPrefixed, encPrefixed, loopNum, tags);
    console.log(`[inbound] open-loop #${loopNum} inserted`);
  } else {
    db.prepare("INSERT INTO notes (type,status,raw_input,formatted,tags) VALUES (?,?,?,?,?)")
      .run(type, 'processed', enc, enc, tags);
    console.log(`[inbound] ${type} inserted`);
  }
}

function parseBody(rawBody) {
  const lines = (rawBody || '').trim().split('\n').map(l => l.trim()).filter(Boolean);
  let tags = '';
  let bodyLines = lines;

  if (lines.length > 0 && lines[0].startsWith('@')) {
    tags = lines[0].slice(1).trim();
    bodyLines = lines.slice(1);
  }

  const body = bodyLines.join('\n').trim();
  return { body, tags };
}

function pollInbound() {
  if (!inboundEnabled) {
    console.log('[inbound] IMAP not configured, skipping');
    return;
  }

  const imap = new Imap({
    user: IMAP_USER,
    password: IMAP_PASS,
    host: IMAP_HOST,
    port: IMAP_PORT,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  });

  imap.once('error', err => {
    console.error('[inbound] IMAP error:', err.message);
  });

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err, box) => {
      if (err) { console.error('[inbound] openBox error:', err.message); imap.end(); return; }

      // Search for unseen mail addressed to anchor@
      imap.search(['UNSEEN', ['TO', ANCHOR_ADDR]], (err, uids) => {
        if (err) { console.error('[inbound] search error:', err.message); imap.end(); return; }
        if (!uids || !uids.length) { console.log('[inbound] no new messages'); imap.end(); return; }

        console.log(`[inbound] ${uids.length} message(s) found`);
        const f = imap.fetch(uids, { bodies: '', markSeen: true });

        f.on('message', (msg) => {
          let rawEmail = '';
          msg.on('body', (stream) => {
            stream.on('data', chunk => { rawEmail += chunk.toString('utf8'); });
            stream.once('end', async () => {
              try {
                const parsed = await simpleParser(rawEmail);
                const subject = (parsed.subject || '').trim();
                const type = resolveType(subject);

                if (!type) {
                  console.log(`[inbound] discarding — unknown subject: "${subject}"`);
                  return;
                }

                const rawBody = parsed.text || '';
                const { body, tags } = parseBody(rawBody);

                if (!body) {
                  console.log('[inbound] discarding — empty body');
                  return;
                }

                insertNote(type, body, tags);
              } catch (e) {
                console.error('[inbound] parse error:', e.message);
              }
            });
          });
        });

        f.once('error', err => console.error('[inbound] fetch error:', err.message));
        f.once('end', () => { imap.end(); });
      });
    });
  });

  imap.connect();
}

module.exports = { pollInbound, inboundEnabled };

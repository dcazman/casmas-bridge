'use strict';
const Imap         = require('imap');
const { simpleParser } = require('mailparser');
const { db }       = require('./db');
const { encrypt }  = require('./crypto');
const { parseReminderDate, parseRemindLine, nextRemindNum, nextLoopNum } = require('./remind');

const IMAP_HOST   = process.env.IMAP_HOST || 'mail.privateemail.com';
const IMAP_PORT   = parseInt(process.env.IMAP_PORT || '993');
const IMAP_USER   = process.env.IMAP_USER || '';
const IMAP_PASS   = process.env.IMAP_PASS || '';
const ANCHOR_ADDR = (process.env.ANCHOR_INBOUND || 'anchor@thecasmas.com').toLowerCase();

const inboundEnabled = !!(IMAP_USER && IMAP_PASS);

const CAT_MAP = {
  'wt':'work-task','wp':'work-project','wd':'work-decision','wm':'work-meeting','wi':'work-idea','wpw':'work-password',
  'pt':'personal-task','pp':'personal-project','pd':'personal-decision','pm':'personal-meeting','pid':'personal-idea','rec':'personal-recipe','ppw':'personal-password',
  'ht':'health-task','hid':'health-idea','hpr':'health-project',
  'ft':'finance-task','fid':'finance-idea','fpr':'finance-project',
  'kw':'Kathie-Wife','zs':'Zach-Son','es':'Ethan-Son','afl':'Andy-FatherInLaw',
  'ma':'Maureen-Aunt','ka':'Kathy-Aunt','ms':'Micky-Stepmother','lb':'Lee-Brother','csl':'Charity-SisterInLaw',
  'kd':'Kevin-Dog','mc':'Mat-Cat','pcc':'Phil-Cat','acc':'Ace-Cat',
  'liz':'Herschel-Lizard','hen':'hens','hhr':'hey-hey-Rooster',
  'pi':'pi','ls':'list','re':'remind','r':'random',
  'ol':'open-loop','cal':'calendar','anc':'anchor','emp':'employment','ch':'claude-handoff',
  'remind':'remind','reminder':'remind','todo':'remind',
  'task':'work-task','idea':'work-idea','decision':'work-decision','meeting':'work-meeting',
  'note':'random','open-loop':'open-loop','list':'list'
};

function resolveType(subject) {
  const s = (subject || '').trim().toLowerCase();
  return CAT_MAP[s] || null;
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
  const sigIndex = rawBody.split('\n').findIndex(l => /^--\s*$/.test(l));
  const trimmed = sigIndex !== -1 ? rawBody.split('\n').slice(0, sigIndex).join('\n') : rawBody;
  const lines = trimmed.trim().split('\n').map(l => l.trim()).filter(Boolean);
  let tags = '', bodyLines = lines;
  if (lines.length > 0 && lines[0].startsWith('@')) {
    tags = lines[0].slice(1).trim();
    bodyLines = lines.slice(1);
  }
  return { body: bodyLines.join('\n').trim(), tags };
}

function pollInbound() {
  if (!inboundEnabled) { console.log('[inbound] IMAP not configured, skipping'); return; }

  const imap = new Imap({ user: IMAP_USER, password: IMAP_PASS, host: IMAP_HOST, port: IMAP_PORT, tls: true, tlsOptions: { rejectUnauthorized: false } });

  imap.once('error', err => { console.error('[inbound] IMAP error:', err.message); });

  imap.once('ready', () => {
    imap.openBox('INBOX', false, (err) => {
      if (err) { console.error('[inbound] openBox error:', err.message); imap.end(); return; }

      imap.search(['UNSEEN', ['TO', ANCHOR_ADDR]], (err, uids) => {
        if (err) { console.error('[inbound] search error:', err.message); imap.end(); return; }
        if (!uids || !uids.length) { console.log('[inbound] no new messages'); imap.end(); return; }

        console.log(`[inbound] ${uids.length} message(s) found`);
        const f = imap.fetch(uids, { bodies: '', markSeen: false });

        f.on('message', (msg) => {
          let rawEmail = '', uid = null;
          msg.once('attributes', attrs => { uid = attrs.uid; });
          msg.on('body', (stream) => {
            stream.on('data', chunk => { rawEmail += chunk.toString('utf8'); });
            stream.once('end', async () => {
              try {
                const parsed = await simpleParser(rawEmail);
                const type = resolveType((parsed.subject || '').trim());
                if (!type) { console.log(`[inbound] discarding — unknown subject: "${parsed.subject}"`); return; }
                const { body, tags } = parseBody(parsed.text || '');
                if (!body) { console.log('[inbound] discarding — empty body'); return; }
                insertNote(type, body, tags);
                if (uid) imap.addFlags(uid, ['\\Deleted'], err => {
                  if (!err) imap.expunge(err2 => { if (err2) console.warn('[inbound] expunge error:', err2.message); });
                });
              } catch (e) { console.error('[inbound] parse error:', e.message); }
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

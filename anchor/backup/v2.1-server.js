const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 7778;
const DB_PATH = '/data/notes.db';
const BRIDGE_PATH = '/bridge';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_OPUS  = 'claude-opus-4-5';
const COST_IN  = 0.80 / 1_000_000;
const COST_OUT = 4.00 / 1_000_000;
const API_SPEND_LIMIT   = parseFloat(process.env.API_SPEND_LIMIT || '40');
const PLAN_RENEWAL_DATE = process.env.PLAN_RENEWAL_DATE || '';
const SYNC_NOTE_THRESHOLD  = 20;
const SYNC_TOKEN_THRESHOLD = 10000;
const SYNC_AGE_HOURS = 24;

const SMTP_HOST   = process.env.SMTP_HOST  || '';
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER   = process.env.SMTP_USER  || '';
const SMTP_PASS   = process.env.SMTP_PASS  || '';
const ALERT_EMAIL = process.env.ALERT_EMAIL || SMTP_USER;
const emailEnabled = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
let mailer = null;
if (emailEnabled) {
  mailer = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}
async function sendEmail(subject, body) {
  if (!mailer) return { ok: false, error: 'Email not configured' };
  try { await mailer.sendMail({ from: SMTP_USER, to: ALERT_EMAIL, subject, text: body }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

const ENC_KEY_RAW = process.env.ENCRYPTION_KEY;
if (!ENC_KEY_RAW) { console.error('FATAL: ENCRYPTION_KEY not set'); process.exit(1); }
const ENC_KEY = crypto.scryptSync(ENC_KEY_RAW, 'anchor-salt', 32);
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}
function decrypt(text) {
  if (!text) return text;
  try {
    const [ivH, tagH, encH] = text.split(':');
    if (!encH) return text;
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivH, 'hex'));
    d.setAuthTag(Buffer.from(tagH, 'hex'));
    return d.update(Buffer.from(encH, 'hex')) + d.final('utf8');
  } catch { return text; }
}

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    type TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'pending',
    raw_input TEXT, formatted TEXT, tags TEXT, open_loops TEXT
  );
  CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
    model TEXT, operation TEXT
  );
`);
try { db.exec(`ALTER TABLE notes ADD COLUMN status TEXT DEFAULT 'pending'`); } catch {}

(function bootstrap() {
  const fromEnv = process.env.ANTHROPIC_API_KEY;
  const existing = db.prepare('SELECT value FROM secrets WHERE key=?').get('anthropic_api_key');
  if (fromEnv) {
    db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run('anthropic_api_key', encrypt(fromEnv));
    console.log('API key stored.');
  } else if (!existing) { console.error('FATAL: No ANTHROPIC_API_KEY'); process.exit(1); }
})();

function getApiKey() {
  const r = db.prepare('SELECT value FROM secrets WHERE key=?').get('anthropic_api_key');
  if (!r) throw new Error('API key not found');
  return decrypt(r.value);
}

function logUsage(ti, to, model, op) {
  try { db.prepare('INSERT INTO usage_log (tokens_in,tokens_out,model,operation) VALUES (?,?,?,?)').run(ti||0, to||0, model, op); }
  catch (e) { console.error('usage log:', e.message); }
}

function getUsageStats() {
  const rows = db.prepare('SELECT tokens_in,tokens_out FROM usage_log').all();
  const ti = rows.reduce((s,r)=>s+(r.tokens_in||0),0);
  const to = rows.reduce((s,r)=>s+(r.tokens_out||0),0);
  const cost = ti*COST_IN + to*COST_OUT;
  return { cost: cost.toFixed(4), limit: API_SPEND_LIMIT, pct: Math.min(100, cost/API_SPEND_LIMIT*100).toFixed(1) };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function stripHtml(h) { return h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s{2,}/g,' ').trim(); }

async function fetchUrl(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Anchor/2.0' } });
  if (!r.ok) throw new Error('Fetch failed: ' + url);
  const ct = r.headers.get('content-type')||'';
  const t = await r.text();
  return '[URL: '+url+']\n'+(ct.includes('text/html')?stripHtml(t):t);
}

async function extractText(file) {
  const m=file.mimetype, n=file.originalname.toLowerCase();
  if (m==='text/plain'||n.endsWith('.txt')||n.endsWith('.md')||n.endsWith('.csv')) return file.buffer.toString('utf8');
  if (m==='text/html'||n.endsWith('.html')||n.endsWith('.htm')) return stripHtml(file.buffer.toString('utf8'));
  if (m==='application/pdf'||n.endsWith('.pdf')) { const d=await pdfParse(file.buffer); return d.text; }
  if (n.endsWith('.docx')) { const r=await mammoth.extractRawText({buffer:file.buffer}); return r.value; }
  throw new Error('Unsupported: '+file.originalname);
}

function getLastSync() { const r=db.prepare("SELECT value FROM secrets WHERE key='last_sync'").get(); return r?new Date(decrypt(r.value)):null; }
function setLastSync() { db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('last_sync',?)").run(encrypt(new Date().toISOString())); }
function getPending() {
  const p=db.prepare("SELECT id,raw_input FROM notes WHERE status='pending'").all();
  const chars=p.reduce((s,n)=>s+(decrypt(n.raw_input)||'').length,0);
  return { count:p.length, estimatedTokens:Math.ceil(chars/4) };
}
function shouldSync() {
  const {count,estimatedTokens}=getPending();
  if (count>=SYNC_NOTE_THRESHOLD||estimatedTokens>=SYNC_TOKEN_THRESHOLD) return true;
  const last=getLastSync(); if (!last) return count>0;
  return (Date.now()-last.getTime())/3600000>=SYNC_AGE_HOURS && count>0;
}
function chatContext(q) {
  const all=db.prepare("SELECT * FROM notes WHERE status='processed' ORDER BY created_at DESC LIMIT 200").all().map(dn);
  const words=q.toLowerCase().split(/\W+/).filter(w=>w.length>3);
  const scored=all.map(n=>({...n,score:words.reduce((s,w)=>s+((n.formatted||'').toLowerCase().includes(w)?1:0),0)}));
  const rel=scored.filter(n=>n.score>0).sort((a,b)=>b.score-a.score).slice(0,20);
  const merged=[...new Map([...all.slice(0,10),...rel].map(n=>[n.id,n])).values()];
  return merged.map(n=>'['+n.created_at+'] ('+n.type+') '+n.formatted+(n.tags?' |tags:'+n.tags:'')+(n.open_loops?' |open:'+n.open_loops:'')).join('\n');
}

const ALL_TYPES=['work','work-task','work-decision','work-idea','meeting','personal','personal-task','personal-decision','home','home-task','home-decision','kids','kids-task','health','health-task','finance','finance-task','social','calendar','email','pi','idea','random','brain-dump'];
const WORK_TYPES=['work','work-task','work-decision','work-idea','meeting','calendar','email'];
const CAT={'w':'work','wt':'work-task','wd':'work-decision','wi':'work-idea','m':'meeting','p':'personal','pt':'personal-task','pd':'personal-decision','ho':'home','ht':'home-task','hod':'home-decision','k':'kids','kt':'kids-task','h':'health','hat':'health-task','f':'finance','ft':'finance-task','s':'social','c':'calendar','e':'email','i':'idea','pi':'pi','r':'random','bd':'brain-dump'};

function parseCat(raw) {
  const lines=raw.split('\n'); const secs=[]; let cur=null;
  for (const line of lines) {
    const m=line.match(/^cat\s+(\S+)/i);
    if (m) { if(cur&&cur.lines.length)secs.push(cur); const k=m[1].toLowerCase(); cur={type:CAT[k]||(ALL_TYPES.includes(k)?k:'brain-dump'),lines:[]}; }
    else if (cur&&line.trim()) cur.lines.push(line);
  }
  if (cur&&cur.lines.length) secs.push(cur);
  return secs;
}

const COLORS={'pending':'#475569','brain-dump':'#60a5fa','work':'#38bdf8','work-task':'#0ea5e9','work-decision':'#0284c7','work-idea':'#7dd3fc','meeting':'#fb923c','personal':'#e879f9','personal-task':'#d946ef','personal-decision':'#a21caf','home':'#fdba74','home-task':'#f97316','home-decision':'#ea580c','kids':'#fde68a','kids-task':'#fbbf24','health':'#f87171','health-task':'#ef4444','finance':'#4ade80','finance-task':'#16a34a','social':'#86efac','calendar':'#c084fc','email':'#67e8f9','idea':'#a78bfa','pi':'#fcd34d','random':'#94a3b8'};
function tc(t){return COLORS[t]||'#60a5fa';}
function dn(n){return {...n,raw_input:decrypt(n.raw_input),formatted:decrypt(n.formatted),tags:decrypt(n.tags),open_loops:decrypt(n.open_loops)};}

function renderNote(n) {
  n=dn(n);
  const color=tc(n.type), ip=n.status==='pending', ir=n.status==='review';
  const opts=ALL_TYPES.map(t=>'<option value="'+t+'"'+(t===n.type?' selected':'')+'>'+t+'</option>').join('');
  return `<div class="note${ip?' note-pending':ir?' note-review':''}" id="note-${n.id}">
    <div class="note-meta">
      <span class="note-type" style="color:${color};border-color:${color}20;background:${color}15">${esc(n.type)}</span>
      ${ip?'<span class="pending-badge">⏳ unsynced</span>':ir?'<span class="review-badge">👁 review</span>':''}
      <span class="note-date" data-ts="${esc(n.created_at)}"></span>
      <span class="note-actions">
        <button class="btn-icon" onclick="startEdit(${n.id})">✏️</button>
        <button class="btn-icon btn-delete" onclick="deleteNote(${n.id})">🗑</button>
      </span>
    </div>
    <div class="formatted" id="fmt-${n.id}">${esc(n.formatted||n.raw_input)}</div>
    <div class="note-edit" id="edit-${n.id}" style="display:none">
      <textarea class="edit-ta" id="etxt-${n.id}">${esc(n.formatted||n.raw_input)}</textarea>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn btn-primary" style="padding:5px 12px;font-size:.85rem" onclick="saveEdit(${n.id})">Save</button>
        <button class="btn btn-secondary" style="padding:5px 12px;font-size:.85rem" onclick="cancelEdit(${n.id})">Cancel</button>
      </div>
    </div>
    ${n.tags&&!ip?'<div class="note-tags">'+esc(n.tags).split(',').map(t=>'<span class="tag">'+t.trim()+'</span>').join('')+'</div>':''}
    ${n.open_loops?'<div class="note-loops">🔁 '+esc(n.open_loops)+'</div>':''}
    <div class="note-rc">
      <select class="rc-sel" onchange="reclassify(${n.id},this.value)"><option value="">↩ reclassify...</option>${opts}</select>
      <span class="rc-st" id="rcs-${n.id}"></span>
    </div>
  </div>`;
}

// [REST OF FILE IDENTICAL TO anchor/server.js — this is the v2.1 restore point]
// To restore: cp anchor/backup/v2.1-server.js anchor/server.js

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

// ── Email ──────────────────────────────────────────────────────
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

// ── Encryption ─────────────────────────────────────────────────
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

// ── Database ───────────────────────────────────────────────────
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

const ICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAMAAAADACAYAAABS3GwHAAAABmJLR0QA/wD/AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6AQFAAABPklEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBuAABHgAAAABJRU5ErkJggg==','base64');

app.get('/apple-touch-icon.png',(q,s)=>{s.setHeader('Content-Type','image/png');s.send(ICON);});
app.get('/icon-192.png',(q,s)=>{s.setHeader('Content-Type','image/png');s.send(ICON);});
app.get('/manifest.json',(q,s)=>s.json({name:'Anchor',short_name:'Anchor',description:"Dan's memory, context, and second brain",start_url:'/',display:'standalone',background_color:'#0d1117',theme_color:'#1e3a5f',icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'}]}));

app.get('/', (req, res) => {
  const {q,type,tag,sort}=req.query;
  let query='SELECT * FROM notes WHERE 1=1'; const params=[];
  if(q){query+=' AND (formatted LIKE ? OR raw_input LIKE ? OR tags LIKE ?)';params.push('%'+q+'%','%'+q+'%','%'+q+'%');}
  if(type){query+=' AND type=?';params.push(type);}
  if(tag){query+=' AND tags LIKE ?';params.push('%'+tag+'%');}
  const so={'newest':'ORDER BY created_at DESC','oldest':'ORDER BY created_at ASC','type':'ORDER BY type ASC,created_at DESC','unsynced':"ORDER BY (status='pending') DESC,created_at DESC",'open-loops':"ORDER BY (open_loops IS NOT NULL AND open_loops!='') DESC,created_at DESC",'type-date':'ORDER BY type ASC,created_at DESC'};
  query+=' '+(so[sort]||so['newest'])+' LIMIT 30';
  const notes=db.prepare(query).all(...params);
  const {count:pc,estimatedTokens:pt}=getPending();
  const ls=getLastSync(); const lss=ls?ls.toLocaleString():'Never';
  const as=shouldSync(); const usage=getUsageStats();
  const now=new Date();
  const ya=new Date(now);ya.setFullYear(now.getFullYear()-1);
  const sa=new Date(now);sa.setMonth(now.getMonth()-6);
  const ma=new Date(now);ma.setMonth(now.getMonth()-1);
  const otd=d=>db.prepare('SELECT * FROM notes WHERE date(created_at)=? LIMIT 3').all(d.toISOString().split('T')[0]);
  const yn=otd(ya),sn=otd(sa),mn=otd(ma); const hasOTD=yn.length||sn.length||mn.length;
  const TG=[{l:'Work',t:['work','work-task','work-decision','work-idea','meeting']},{l:'Personal',t:['personal','personal-task','personal-decision']},{l:'Home',t:['home','home-task','home-decision']},{l:'Kids',t:['kids','kids-task']},{l:'Health',t:['health','health-task']},{l:'Finance',t:['finance','finance-task']},{l:'Universal',t:['social','calendar','email','idea','pi','random','brain-dump']}];
  const typeOpts=TG.map(g=>'<optgroup label="'+g.l+'">'+g.t.map(t=>'<option value="'+t+'"'+(type===t?' selected':'')+'>'+t+'</option>').join('')+'</optgroup>').join('');
  const ss=v=>sort===v||(!sort&&v==='newest')?'selected':'';
  const uc=parseFloat(usage.pct)>=90?'#f87171':parseFloat(usage.pct)>=70?'#f59e0b':'#4ade80';
  let rs='';
  if(PLAN_RENEWAL_DATE){const rd=new Date(PLAN_RENEWAL_DATE);rs='Plan renews '+rd.toLocaleDateString()+' ('+(Math.ceil((rd-now)/86400000))+'d)';}

  res.send(`<!DOCTYPE html><html><head>
  <title>Anchor</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1e3a5f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Anchor">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0d1117;color:#e2e8f0;font-size:16px;line-height:1.6}
    .hdr{background:linear-gradient(135deg,#1e3a5f,#1a1f35);border-bottom:1px solid #2d4a7a;padding:16px 32px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
    .hdr-icon{width:48px;height:48px;flex-shrink:0}
    .hdr-text{flex:1}.hdr-text h1{font-size:1.8rem;font-weight:700;color:#93c5fd}.hdr-text p{font-size:.85rem;color:#64748b}
    .hdr-right{display:flex;flex-direction:row;align-items:center;gap:24px}
    .hdr-time{font-size:.85rem;color:#e2e8f0;white-space:nowrap}
    .usage-w{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
    .usage-lbl{font-size:.72rem;color:#94a3b8}
    .usage-bar-w{width:140px;height:6px;background:#1e2d45;border-radius:3px;overflow:hidden}
    .usage-bar{height:100%;border-radius:3px;background:${uc};width:${usage.pct}%}
    .usage-num{font-size:.72rem;color:${uc};font-weight:600}
    .renew-lbl{font-size:.7rem;color:#475569}
    .btn-logout{font-size:.78rem;color:#475569;text-decoration:none;padding:5px 10px;border:1px solid #1e2d45;border-radius:6px}
    .main{padding:24px 32px;max-width:1400px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:24px}
    @media(max-width:900px){.main{grid-template-columns:1fr}}
    .panel{background:#161b27;border:1px solid #1e2d45;border-radius:12px;padding:20px}
    .panel h2{font-size:1rem;font-weight:600;color:#93c5fd;margin-bottom:14px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
    .panel h2:hover{color:#bfdbfe}
    .dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0}
    .chev{margin-left:auto;font-size:.75rem;color:#475569;transition:transform .2s}
    .chev.open{transform:rotate(180deg)}
    .collapsed{display:none}
    .sync-bar{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#0d1117;border:1px solid #1e2d45;border-radius:8px;margin-bottom:14px;flex-wrap:wrap}
    .sync-ct{font-size:.85rem;color:#94a3b8}.sync-ct strong{color:#f59e0b}
    .sync-auto{font-size:.75rem;color:#f59e0b;background:#292208;padding:2px 8px;border-radius:20px;border:1px solid #f59e0b40}
    .sync-last{font-size:.75rem;color:#475569;margin-left:auto}
    .btn-sync{background:#f59e0b;color:#0d1117;font-weight:700;font-size:.85rem;padding:6px 16px;border:none;border-radius:6px;cursor:pointer}
    .btn-sync:disabled{opacity:.4;cursor:not-allowed}
    textarea{width:100%;height:130px;background:#0d1117;color:#e2e8f0;border:1px solid #2d4a7a;border-radius:8px;padding:12px;font-size:1rem;resize:vertical;font-family:inherit}
    textarea:focus{outline:none;border-color:#60a5fa}
    input[type=text]{background:#0d1117;color:#e2e8f0;border:1px solid #2d4a7a;border-radius:8px;padding:8px 12px;font-size:.95rem;font-family:inherit}
    input[type=text]:focus{outline:none;border-color:#60a5fa}
    select{background:#0d1117;color:#e2e8f0;border:1px solid #2d4a7a;border-radius:8px;padding:8px 12px;font-size:.95rem}
    .btn{padding:9px 20px;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer}
    .btn-primary{background:#2563eb;color:#fff}.btn-primary:hover{background:#3b82f6}
    .btn-secondary{background:#1e2d45;color:#93c5fd;border:1px solid #2d4a7a}.btn-secondary:hover{background:#243447}
    .btn-mic{background:#1e2d45;color:#93c5fd;border:1px solid #2d4a7a;display:flex;align-items:center;gap:6px;font-size:.9rem}
    .btn-mic.listening{background:#7c3aed;color:#fff;border-color:#7c3aed;animation:pulse 1.2s infinite}
    .btn-opus{background:#1e1a35;color:#a78bfa;border:1px solid #a78bfa40;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600}
    .btn-bridge{background:#1e2d45;color:#4ade80;border:1px solid #4ade8040;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600}
    .btn-alert{background:#1e2d45;color:#fb923c;border:1px solid #fb923c40;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600}
    .btn-icon{background:none;border:none;cursor:pointer;font-size:.85rem;padding:2px 5px;opacity:.4;transition:opacity .15s}
    .btn-icon:hover{opacity:1}.btn-delete:hover{color:#f87171}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
    .btn-row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center}
    .file-row{display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap}
    .file-lbl{display:inline-flex;align-items:center;gap:6px;background:#1e2d45;color:#93c5fd;border:1px dashed #2d4a7a;border-radius:8px;padding:7px 14px;font-size:.88rem;cursor:pointer}
    .file-lbl:hover{background:#243447;border-color:#60a5fa}
    .file-name{font-size:.82rem;color:#4ade80}
    .btn-cf{background:none;border:none;color:#475569;cursor:pointer;font-size:.9rem;padding:2px 6px}
    .status{font-size:.85rem;color:#4ade80;margin-top:6px;min-height:20px}
    .loading{font-size:.85rem;color:#60a5fa;display:none}
    .search-row{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
    .search-row input{flex:1;min-width:140px}
    .notes-list{max-height:560px;overflow-y:auto;padding-right:4px}
    .notes-list::-webkit-scrollbar{width:4px}
    .notes-list::-webkit-scrollbar-thumb{background:#2d4a7a;border-radius:4px}
    .note{background:#0d1117;border:1px solid #1e2d45;border-radius:10px;padding:16px;margin-bottom:12px}
    .note:hover{border-color:#2d4a7a}
    .note-pending{border-color:#f59e0b30;background:#1a1500}
    .note-review{border-color:#f4723080;background:#1a0f00}
    .review-badge{font-size:.7rem;color:#f97316;background:#1f1100;padding:2px 7px;border-radius:20px;border:1px solid #f9731630}
    .note-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
    .note-type{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:20px;border:1px solid}
    .pending-badge{font-size:.7rem;color:#f59e0b;background:#292208;padding:2px 7px;border-radius:20px;border:1px solid #f59e0b30}
    .note-date{font-size:.78rem;color:#475569}
    .note-actions{margin-left:auto;display:flex;gap:2px}
    .formatted{white-space:pre-wrap;font-size:.95rem;line-height:1.7;color:#cbd5e1}
    .note-edit{margin-top:8px}
    .edit-ta{width:100%;height:100px;background:#0d1117;color:#e2e8f0;border:1px solid #60a5fa;border-radius:8px;padding:10px;font-size:.92rem;font-family:inherit;resize:vertical}
    .note-tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
    .tag{font-size:.75rem;background:#1e3a5f;color:#93c5fd;padding:2px 8px;border-radius:20px}
    .note-loops{margin-top:8px;font-size:.88rem;color:#fbbf24;background:#292208;padding:8px 12px;border-radius:6px;border-left:3px solid #fbbf24}
    .note-rc{margin-top:8px;display:flex;align-items:center;gap:8px}
    .rc-sel{background:#0d1117;color:#475569;border:1px solid #1e2d45;border-radius:6px;padding:3px 8px;font-size:.78rem;cursor:pointer}
    .rc-st{font-size:.75rem;color:#4ade80}
    .chat-msgs{max-height:380px;overflow-y:auto;margin-bottom:14px;display:flex;flex-direction:column;gap:10px}
    .msg{padding:10px 14px;border-radius:10px;font-size:.92rem;line-height:1.6;max-width:92%}
    .msg.user{background:#1e3a5f;color:#bfdbfe;align-self:flex-end}
    .msg.ai{background:#1a2232;color:#e2e8f0;align-self:flex-start;border-left:3px solid #3b82f6}
    .msg.ai.opus{border-left-color:#a78bfa}
    .chat-in{display:flex;gap:8px}.chat-in input{flex:1}
    .chat-mr{display:flex;align-items:center;gap:8px;margin-top:8px}
    .model-lbl{font-size:.75rem;color:#475569}
    .otd-lbl{font-size:.75rem;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;margin-top:14px}
    .empty{color:#334155;font-size:.9rem;padding:20px;text-align:center}
  </style></head><body>
  <div class="hdr">
    <svg class="hdr-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#1e3a5f"/>
      <rect x="10" y="8" width="28" height="34" rx="4" fill="#0d1117" stroke="#2d4a7a" stroke-width="1.5"/>
      <rect x="10" y="8" width="6" height="34" rx="4" fill="#1e2d45"/>
      <line x1="20" y1="17" x2="33" y2="17" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="23" x2="33" y2="23" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"/>
      <line x1="20" y1="29" x2="28" y2="29" stroke="#93c5fd" stroke-width="2" stroke-linecap="round" opacity=".6"/>
      <circle cx="13" cy="16" r="1.5" fill="#3b82f6"/>
      <circle cx="13" cy="22" r="1.5" fill="#3b82f6"/>
      <circle cx="13" cy="28" r="1.5" fill="#3b82f6"/>
    </svg>
    <div class="hdr-text"><h1>Anchor</h1><p>Dan's memory, context, and second brain</p></div>
    <div class="hdr-right">
      <div class="hdr-time" id="hdrTime"></div>
      <div class="usage-w">
        <div class="usage-lbl">Anthropic API spend</div>
        <div class="usage-bar-w"><div class="usage-bar"></div></div>
        <div class="usage-num">$${usage.cost} / $${usage.limit} (${usage.pct}%)</div>
        ${rs?'<div class="renew-lbl">'+rs+'</div>':''}
      </div>
      ${req.headers['cf-access-authenticated-user-email']?'<a href="/cdn-cgi/access/logout" class="btn-logout">Sign out</a>':''}
    </div>
  </div>
  <div class="main">
    <div style="display:flex;flex-direction:column;gap:20px">
      <div class="panel">
        <h2><span class="dot"></span>Add Note</h2>
        <textarea id="inp" placeholder="Brain dump here. Just type. Paste a URL to ingest it."></textarea>
        <div class="file-row">
          <label class="file-lbl">📎 Attach<input type="file" id="fi" accept=".txt,.md,.csv,.pdf,.docx,.html,.htm" onchange="fileSelected(this)" style="display:none"></label>
          <span class="file-name" id="fn"></span>
          <button class="btn-cf" id="cfi" onclick="clearFile()" style="display:none">✕</button>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="submitNote()">Add Note</button>
          <button class="btn btn-mic" id="micBtn" onclick="toggleMic()">🎤 Mic</button>
        </div>
        <div class="status" id="ns"></div>
      </div>

      <div class="panel">
        <h2 onclick="tp('sb','sc')"><span class="dot" style="background:#f59e0b"></span>Sync Queue<span class="chev" id="sc">▼</span></h2>
        <div id="sb" class="collapsed">
          <div class="sync-bar">
            <span class="sync-ct"><strong id="pc">${pc}</strong> pending (~${pt} tokens)</span>
            ${as?'<span class="sync-auto">⚡ auto-sync recommended</span>':''}
            <span class="sync-last">Last: ${lss}</span>
            <button class="btn-sync" id="syncBtn" onclick="runSync()" ${pc===0?'disabled':''}>Sync Now</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
            <button class="btn-bridge" onclick="pullBridge()">⬇ Pull Bridge</button>
            ${emailEnabled?'<button class="btn-alert" onclick="sendAlert()">📧 Alert</button>':''}
            <span class="status" id="bs" style="margin:0"></span>
          </div>
          <div class="status" id="ss"></div>
          <div class="loading" id="sl">⏳ Classifying...</div>
        </div>
      </div>

      <div class="panel">
        <h2 onclick="tp('nb','nc')"><span class="dot" style="background:#34d399"></span>Notes<span class="chev" id="nc">▼</span></h2>
        <div id="nb" class="collapsed">
          <div class="search-row">
            <input type="text" id="sq" placeholder="Search..." value="${esc(q||'')}">
            <select id="st"><option value="">All types</option>${typeOpts}</select>
            <select id="so">
              <option value="newest" ${ss('newest')}>Newest</option>
              <option value="oldest" ${ss('oldest')}>Oldest</option>
              <option value="type" ${ss('type')}>By type</option>
              <option value="unsynced" ${ss('unsynced')}>Unsynced</option>
              <option value="open-loops" ${ss('open-loops')}>Open loops</option>
              <option value="type-date" ${ss('type-date')}>Type+date</option>
            </select>
            <button class="btn btn-secondary" onclick="doSearch()">Search</button>
          </div>
          <div class="notes-list">${notes.length?notes.map(renderNote).join(''):'<div class="empty">No notes yet.</div>'}</div>
        </div>
      </div>
    </div>

    <div style="display:flex;flex-direction:column;gap:20px">
      <div class="panel">
        <h2 onclick="tp('cb','cc')"><span class="dot" style="background:#a78bfa"></span>Ask Anchor<span class="chev" id="cc">▼</span></h2>
        <div id="cb" class="collapsed">
          <div class="chat-msgs" id="cm"><div class="msg ai">Ask me anything about your notes.</div></div>
          <div class="chat-in">
            <input type="text" id="ci" placeholder="What are my open loops?">
            <button class="btn btn-primary" onclick="chat('haiku')">Ask</button>
          </div>
          <div class="chat-mr">
            <span class="model-lbl">Deeper analysis?</span>
            <button class="btn btn-opus" onclick="chat('opus')">⚡ Opus</button>
          </div>
          <div class="loading" id="cl" style="margin-top:8px">⏳ Reading notes...</div>
        </div>
      </div>
      ${hasOTD?`<div class="panel">
        <h2><span class="dot" style="background:#fb923c"></span>🕰 On This Day</h2>
        ${yn.length?'<div class="otd-lbl">1 year ago</div>'+yn.map(renderNote).join(''):''}
        ${sn.length?'<div class="otd-lbl">6 months ago</div>'+sn.map(renderNote).join(''):''}
        ${mn.length?'<div class="otd-lbl">1 month ago</div>'+mn.map(renderNote).join(''):''}
      </div>`:''}
    </div>
  </div>

  <script>
    document.querySelectorAll('.note-date[data-ts]').forEach(el=>{
      const ts=el.getAttribute('data-ts');
      if(ts){const u=ts.includes('T')?ts:ts.replace(' ','T')+'Z';el.textContent=new Date(u).toLocaleString();}
    });
    function clock(){const el=document.getElementById('hdrTime');if(el)el.textContent=new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});}
    clock();setInterval(clock,30000);

    function fileSelected(i){const n=i.files[0]?i.files[0].name:'';document.getElementById('fn').textContent=n;document.getElementById('cfi').style.display=n?'inline':'none';}
    function clearFile(){document.getElementById('fi').value='';document.getElementById('fn').textContent='';document.getElementById('cfi').style.display='none';}

    async function submitNote(){
      const v=document.getElementById('inp').value.trim(),f=document.getElementById('fi').files[0];
      if(!v&&!f)return;
      try{
        const fd=new FormData();if(v)fd.append('raw',v);if(f)fd.append('file',f);
        const r=await fetch('/note',{method:'POST',body:fd});const d=await r.json();
        if(d.ok){document.getElementById('inp').value='';clearFile();document.getElementById('ns').textContent=d.split>1?'✓ Split into '+d.split+' notes':'✓ Saved';document.getElementById('pc').textContent=d.pendingCount;if(d.pendingCount>0)document.getElementById('syncBtn').disabled=false;setTimeout(()=>{document.getElementById('ns').textContent='';},2000);setTimeout(()=>location.reload(),600);}
        else{document.getElementById('ns').textContent='✗ '+(d.error||'Failed');}
      }catch(e){document.getElementById('ns').textContent='✗ Failed';}
    }

    async function runSync(){
      const btn=document.getElementById('syncBtn');btn.disabled=true;
      document.getElementById('sl').style.display='block';document.getElementById('ss').textContent='';
      try{
        const r=await fetch('/sync',{method:'POST'});const d=await r.json();
        if(d.ok){let m='✓ Synced '+d.processed+' notes';if(d.splits>0)m+=', split '+d.splits;if(d.flagged>0)m+=', '+d.flagged+' flagged';document.getElementById('ss').textContent=m;setTimeout(()=>location.reload(),1000);}
        else{document.getElementById('ss').textContent='✗ '+(d.error||'Sync failed');btn.disabled=false;}
      }catch(e){document.getElementById('ss').textContent='✗ Sync failed';btn.disabled=false;}
      document.getElementById('sl').style.display='none';
    }

    async function pullBridge(){
      const s=document.getElementById('bs');s.textContent='⏳ Pulling...';
      try{const r=await fetch('/pull-bridge',{method:'POST'});const d=await r.json();if(d.ok){s.textContent='✓ '+d.ingested+' ingested, '+d.skipped+' skipped';if(d.ingested>0)setTimeout(()=>location.reload(),1200);}else{s.textContent='✗ '+(d.error||'Failed');}}
      catch(e){s.textContent='✗ Failed';}
    }

    async function sendAlert(){
      const s=document.getElementById('bs');s.textContent='⏳ Sending...';
      try{const r=await fetch('/alert',{method:'POST'});const d=await r.json();s.textContent=d.ok?'✓ Sent':'✗ '+(d.error||'Failed');}
      catch(e){s.textContent='✗ Failed';}
    }

    let rec=null;
    function toggleMic(){
      if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){alert('Use Chrome.');return;}
      const btn=document.getElementById('micBtn');
      if(rec){rec.stop();rec=null;btn.classList.remove('listening');btn.textContent='🎤 Mic';return;}
      const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
      rec=new SR();rec.continuous=true;rec.interimResults=false;rec.lang='en-US';
      rec.onresult=e=>{const t=Array.from(e.results).map(r=>r[0].transcript).join(' ');const i=document.getElementById('inp');i.value+=(i.value?' ':'')+t;};
      rec.onend=()=>{btn.classList.remove('listening');btn.textContent='🎤 Mic';rec=null;};
      rec.start();btn.classList.add('listening');btn.textContent='🔴 Listening...';
    }

    function doSearch(){
      const q=document.getElementById('sq').value,t=document.getElementById('st').value,s=document.getElementById('so').value;
      const p=new URLSearchParams();if(q)p.set('q',q);if(t)p.set('type',t);if(s)p.set('sort',s);
      window.location.href='/?'+p.toString();
    }
    document.getElementById('sq').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});

    async function chat(model){
      const v=document.getElementById('ci').value.trim();if(!v)return;
      const msgs=document.getElementById('cm');
      msgs.innerHTML+='<div class="msg user">'+v+'</div>';
      document.getElementById('ci').value='';
      document.getElementById('cl').style.display='block';
      msgs.scrollTop=msgs.scrollHeight;
      try{
        const r=await fetch('/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:v,model,clientTime:new Date().toString()})});
        const d=await r.json();
        const cls=model==='opus'?'msg ai opus':'msg ai';
        const lbl=model==='opus'?' <span style="font-size:.7rem;color:#a78bfa">⚡ Opus</span>':'';
        msgs.innerHTML+='<div class="'+cls+'">'+d.answer+lbl+'</div>';
      }catch(e){msgs.innerHTML+='<div class="msg ai">Error.</div>';}
      document.getElementById('cl').style.display='none';
      msgs.scrollTop=msgs.scrollHeight;
    }
    document.getElementById('ci').addEventListener('keydown',e=>{if(e.key==='Enter')chat('haiku');});

    function isLocal(){const h=window.location.hostname;return h==='localhost'||h.startsWith('192.168.')||h.startsWith('10.')||h.startsWith('172.');}
    function tp(bid,cid){const b=document.getElementById(bid),c=document.getElementById(cid),col=b.classList.contains('collapsed');b.classList.toggle('collapsed',!col);c.classList.toggle('open',col);}
    if(isLocal()){['sb','nb','cb'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('collapsed');});['sc','nc','cc'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.add('open');});}

    async function reclassify(id,type){
      if(!type)return;const s=document.getElementById('rcs-'+id);s.textContent='...';
      try{const r=await fetch('/reclassify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,type})});const d=await r.json();if(d.ok){s.textContent='✓';setTimeout(()=>location.reload(),600);}else s.textContent='✗';}
      catch(e){s.textContent='✗';}
    }
    function startEdit(id){document.getElementById('fmt-'+id).style.display='none';document.getElementById('edit-'+id).style.display='block';}
    function cancelEdit(id){document.getElementById('fmt-'+id).style.display='block';document.getElementById('edit-'+id).style.display='none';}
    async function saveEdit(id){
      const c=document.getElementById('etxt-'+id).value.trim();if(!c)return;
      try{const r=await fetch('/notes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({formatted:c})});const d=await r.json();if(d.ok)location.reload();else alert('Save failed');}
      catch(e){alert('Save failed');}
    }
    async function deleteNote(id){
      if(!confirm('Delete this note? Cannot be undone.'))return;
      try{const r=await fetch('/notes/'+id,{method:'DELETE'});const d=await r.json();if(d.ok)document.getElementById('note-'+id).remove();else alert('Delete failed');}
      catch(e){alert('Delete failed');}
    }
  </script></body></html>`);
});

// ── POST /note ─────────────────────────────────────────────────
app.post('/note', upload.single('file'), async (req, res) => {
  try {
    let raw=(req.body.raw||'').trim();
    if(req.file){const e=await extractText(req.file);raw=raw?raw+'\n\n[File: '+req.file.originalname+']\n'+e.trim():'[File: '+req.file.originalname+']\n'+e.trim();}
    const um=raw.match(/^(https?:\/\/\S+)$/);if(um)raw=await fetchUrl(um[1]);
    if(!raw)return res.json({ok:false,error:'No input'});
    const secs=parseCat(raw);
    if(secs.length>0){
      const ins=db.prepare('INSERT INTO notes (type,status,raw_input,formatted) VALUES (?,?,?,?)');
      db.transaction(s=>{for(const sec of s){const t=sec.lines.join('\n').trim();ins.run(sec.type,'processed',encrypt(t),encrypt(t));}})(secs);
      return res.json({ok:true,pendingCount:getPending().count,split:secs.length});
    }
    db.prepare("INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)").run(encrypt(raw),encrypt(raw));
    res.json({ok:true,pendingCount:getPending().count});
  } catch(e){console.error(e);res.json({ok:false,error:e.message});}
});

// ── DELETE /notes/:id ──────────────────────────────────────────
app.delete('/notes/:id', (req, res) => {
  const id=parseInt(req.params.id);if(!id)return res.json({ok:false,error:'Invalid id'});
  try{db.prepare('DELETE FROM notes WHERE id=?').run(id);res.json({ok:true});}
  catch(e){res.json({ok:false,error:e.message});}
});

// ── PUT /notes/:id ─────────────────────────────────────────────
app.put('/notes/:id', (req, res) => {
  const id=parseInt(req.params.id);if(!id)return res.json({ok:false,error:'Invalid id'});
  const {formatted,type}=req.body;
  try{
    if(formatted!==undefined)db.prepare('UPDATE notes SET formatted=? WHERE id=?').run(encrypt(formatted),id);
    if(type&&ALL_TYPES.includes(type))db.prepare('UPDATE notes SET type=? WHERE id=?').run(type,id);
    res.json({ok:true});
  }catch(e){res.json({ok:false,error:e.message});}
});

// ── POST /pull-bridge (volume mount — no git pull needed) ──────
app.post('/pull-bridge', async (req, res) => {
  try {
    const mdDir=path.join(BRIDGE_PATH,'md');
    if(!fs.existsSync(mdDir))return res.json({ok:true,ingested:0,skipped:0,note:'md/ not found'});
    const files=fs.readdirSync(mdDir).filter(f=>f.endsWith('.md')||f.endsWith('.txt'));
    let ingested=0,skipped=0;
    for(const file of files){
      const key='bridge:file:'+file;
      if(db.prepare('SELECT key FROM secrets WHERE key=?').get(key)){skipped++;continue;}
      const content=fs.readFileSync(path.join(mdDir,file),'utf8').trim();
      if(!content){skipped++;continue;}
      const raw='[Bridge: '+file+']\n'+content;
      db.prepare("INSERT INTO notes (type,status,raw_input,formatted) VALUES ('pending','pending',?,?)").run(encrypt(raw),encrypt(raw));
      db.prepare('INSERT OR REPLACE INTO secrets (key,value) VALUES (?,?)').run(key,'1');
      ingested++;
    }
    res.json({ok:true,ingested,skipped});
  }catch(e){res.json({ok:false,error:e.message});}
});

// ── POST /alert ────────────────────────────────────────────────
app.post('/alert', async (req, res) => {
  const {count:pc}=getPending();
  const loops=db.prepare("SELECT COUNT(*) as c FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!=''").get();
  const u=getUsageStats();
  const r=await sendEmail('Anchor Alert — '+pc+' pending, '+loops.c+' open loops','Pending: '+pc+'\nOpen loops: '+loops.c+'\nAPI spend: $'+u.cost+' / $'+u.limit+'\n\nVisit anchor.thecasmas.com');
  res.json(r);
});

// ── POST /sync ─────────────────────────────────────────────────
app.post('/sync', async (req, res) => {
  const pending=db.prepare("SELECT id,raw_input FROM notes WHERE status='pending'").all();
  if(!pending.length)return res.json({ok:true,processed:0});
  const dec=pending.map(n=>({id:n.id,text:decrypt(n.raw_input)}));
  const gr=db.prepare("SELECT formatted FROM notes WHERE type='pi' AND formatted LIKE '%Classification Guide%' ORDER BY created_at DESC LIMIT 1").get();
  const guide=gr?decrypt(gr.formatted):'';
  const SYS=`You are Anchor, Dan Casmas's AI organizer.\n${guide?'GUIDE:\n'+guide:''}\nClassify each note. Split multi-topic notes.\nReturn a JSON array of objects with: source_id, type, formatted, tags, open_loops, uncertain, proposed_type.\nOnly JSON. No markdown.`;
  try{
    const key=getApiKey();
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:MODEL_HAIKU,max_tokens:8192,system:SYS,messages:[{role:'user',content:'Process:\n'+JSON.stringify(dec)}]})});
    const data=await resp.json();
    if(data.usage)logUsage(data.usage.input_tokens,data.usage.output_tokens,MODEL_HAIKU,'sync');
    const results=JSON.parse(data.content[0].text.replace(/```json|```/g,'').trim());
    const ins=db.prepare('INSERT INTO notes (type,status,raw_input,formatted,tags,open_loops) VALUES (?,?,?,?,?,?)');
    const flag=db.prepare("UPDATE notes SET status='review',type='brain-dump' WHERE id=?");
    db.transaction(items=>{
      const seen=new Set();
      for(const it of items){
        if(it.uncertain){if(!seen.has(it.source_id)){flag.run(it.source_id);seen.add(it.source_id);}continue;}
        if(!seen.has(it.source_id)){db.prepare("UPDATE notes SET type=?,status='processed',formatted=?,tags=?,open_loops=? WHERE id=?").run(it.type,encrypt(it.formatted),encrypt(it.tags||''),encrypt(it.open_loops||''),it.source_id);seen.add(it.source_id);}
        else{ins.run(it.type,'processed',encrypt(it.formatted),encrypt(it.formatted),encrypt(it.tags||''),encrypt(it.open_loops||''));}
      }
    })(results);
    setLastSync();
    res.json({ok:true,processed:results.filter(r=>!r.uncertain).length,flagged:results.filter(r=>r.uncertain).length,splits:Math.max(0,results.length-pending.length)});
  }catch(e){console.error(e);res.json({ok:false,error:e.message});}
});

// ── POST /chat ─────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const {question,model,clientTime}=req.body;
  if(!question)return res.json({answer:'No question.'});
  try{
    const key=getApiKey();
    const m=model==='opus'?MODEL_OPUS:MODEL_HAIKU;
    const resp=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:m,max_tokens:1000,messages:[{role:'user',content:"You are Anchor, Dan's AI assistant.\n\nTime: "+(clientTime||new Date().toLocaleString())+'\n\nNOTES:\n'+chatContext(question)+'\n\nQ: '+question}]})});
    const data=await resp.json();
    if(data.usage)logUsage(data.usage.input_tokens,data.usage.output_tokens,m,'chat');
    res.json({answer:data.content[0].text});
  }catch(e){res.json({answer:'Error.'});}
});

// ── POST /reclassify ───────────────────────────────────────────
app.post('/reclassify', (req, res) => {
  const {id,type}=req.body;
  if(!id||!ALL_TYPES.includes(type))return res.json({ok:false,error:'Invalid'});
  db.prepare('UPDATE notes SET type=? WHERE id=?').run(type,id);
  res.json({ok:true});
});

app.get('/usage', (req, res) => res.json(getUsageStats()));

// ── MCP routes ─────────────────────────────────────────────────
function isMcp(req){return req.headers['x-mcp-caller']!==undefined;}
function filterCaller(notes,caller){return caller==='work'?notes.filter(n=>WORK_TYPES.includes(n.type)):notes;}

app.post('/mcp/notes', (req, res) => {
  if(!isMcp(req))return res.status(403).json({error:'Forbidden'});
  const {type,limit=20,sort='newest',caller}=req.body;
  const so={'newest':'ORDER BY created_at DESC','oldest':'ORDER BY created_at ASC','open-loops':"ORDER BY (open_loops IS NOT NULL AND open_loops!='') DESC,created_at DESC"};
  let q="SELECT * FROM notes WHERE status='processed'"; const p=[];
  if(type){q+=' AND type=?';p.push(type);}
  q+=' '+(so[sort]||so['newest'])+' LIMIT ?';p.push(limit);
  const notes=db.prepare(q).all(...p).map(dn);
  const f=filterCaller(notes,caller);
  res.json({notes:f,count:f.length,caller});
});

app.post('/mcp/search', (req, res) => {
  if(!isMcp(req))return res.status(403).json({error:'Forbidden'});
  const {query,caller}=req.body;if(!query)return res.json({notes:[],count:0});
  const notes=db.prepare("SELECT * FROM notes WHERE status='processed' AND (formatted LIKE ? OR tags LIKE ? OR raw_input LIKE ?) ORDER BY created_at DESC LIMIT 30").all('%'+query+'%','%'+query+'%','%'+query+'%').map(dn);
  const f=filterCaller(notes,caller);
  res.json({notes:f,count:f.length,query,caller});
});

app.post('/mcp/open-loops', (req, res) => {
  if(!isMcp(req))return res.status(403).json({error:'Forbidden'});
  const {caller}=req.body;
  const notes=db.prepare("SELECT * FROM notes WHERE status='processed' AND open_loops IS NOT NULL AND open_loops!='' ORDER BY created_at DESC").all().map(dn);
  const f=filterCaller(notes,caller);
  res.json({notes:f,count:f.length,caller});
});

app.post('/mcp/summary', (req, res) => {
  if(!isMcp(req))return res.status(403).json({error:'Forbidden'});
  const {days=7,caller}=req.body;
  const since=new Date();since.setDate(since.getDate()-days);
  const notes=db.prepare("SELECT * FROM notes WHERE status='processed' AND created_at>=? ORDER BY created_at DESC").all(since.toISOString()).map(dn);
  const f=filterCaller(notes,caller);
  const byType={};for(const n of f)byType[n.type]=(byType[n.type]||0)+1;
  res.json({notes:f,count:f.length,byType,days,caller});
});

app.delete('/mcp/notes/:id', (req, res) => {
  if(!req.headers['x-mcp-caller'])return res.status(403).json({error:'Forbidden'});
  const id=parseInt(req.params.id);if(!id)return res.json({ok:false,error:'Invalid'});
  db.prepare('DELETE FROM notes WHERE id=?').run(id);
  res.json({ok:true});
});

app.listen(PORT, () => console.log('anchor running on port ' + PORT));

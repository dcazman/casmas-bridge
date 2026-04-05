'use strict';
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function stripHtml(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s{2,}/g,' ').trim();
}

async function fetchUrl(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Anchor/2.0' } });
  if (!r.ok) throw new Error('Fetch failed: ' + url);
  const ct = r.headers.get('content-type') || '';
  const t = await r.text();
  return '[URL: '+url+']\n' + (ct.includes('text/html') ? stripHtml(t) : t);
}

async function extractText(file) {
  const m = file.mimetype, n = file.originalname.toLowerCase();
  if (m==='text/plain'||n.endsWith('.txt')||n.endsWith('.md')||n.endsWith('.csv')) return file.buffer.toString('utf8');
  if (m==='text/html'||n.endsWith('.html')||n.endsWith('.htm')) return stripHtml(file.buffer.toString('utf8'));
  if (m==='application/pdf'||n.endsWith('.pdf')) { const d = await pdfParse(file.buffer); return d.text; }
  if (n.endsWith('.docx')) { const r = await mammoth.extractRawText({ buffer: file.buffer }); return r.value; }
  throw new Error('Unsupported: ' + file.originalname);
}

const ALL_TYPES = ['work','work-task','work-decision','work-idea','meeting','personal','personal-task','personal-decision','home','home-task','home-decision','kids','kids-task','health','health-task','finance','finance-task','social','calendar','email','pi','idea','random','brain-dump'];
const WORK_TYPES = ['work','work-task','work-decision','work-idea','meeting','calendar','email'];
const CAT = {'w':'work','wt':'work-task','wd':'work-decision','wi':'work-idea','m':'meeting','p':'personal','pt':'personal-task','pd':'personal-decision','ho':'home','ht':'home-task','hod':'home-decision','k':'kids','kt':'kids-task','h':'health','hat':'health-task','f':'finance','ft':'finance-task','s':'social','c':'calendar','e':'email','i':'idea','pi':'pi','r':'random','bd':'brain-dump'};

function parseCat(raw) {
  const lines = raw.split('\n'); const secs = []; let cur = null;
  for (const line of lines) {
    const m = line.match(/^cat\s+(\S+)/i);
    if (m) { if(cur&&cur.lines.length) secs.push(cur); const k=m[1].toLowerCase(); cur={type:CAT[k]||(ALL_TYPES.includes(k)?k:'brain-dump'),lines:[]}; }
    else if (cur && line.trim()) cur.lines.push(line);
  }
  if (cur && cur.lines.length) secs.push(cur);
  return secs;
}

const COLORS = {'pending':'#475569','brain-dump':'#60a5fa','work':'#38bdf8','work-task':'#0ea5e9','work-decision':'#0284c7','work-idea':'#7dd3fc','meeting':'#fb923c','personal':'#e879f9','personal-task':'#d946ef','personal-decision':'#a21caf','home':'#fdba74','home-task':'#f97316','home-decision':'#ea580c','kids':'#fde68a','kids-task':'#fbbf24','health':'#f87171','health-task':'#ef4444','finance':'#4ade80','finance-task':'#16a34a','social':'#86efac','calendar':'#c084fc','email':'#67e8f9','idea':'#a78bfa','pi':'#fcd34d','random':'#94a3b8'};
function typeColor(t) { return COLORS[t] || '#60a5fa'; }

module.exports = { esc, stripHtml, fetchUrl, extractText, parseCat, typeColor, ALL_TYPES, WORK_TYPES };

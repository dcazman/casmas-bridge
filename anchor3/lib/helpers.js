'use strict';
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function stripHtml(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

async function fetchUrl(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Anchor/3.0' } });
  if (!r.ok) throw new Error('Fetch failed: ' + url);
  const ct = r.headers.get('content-type') || '';
  const t = await r.text();
  return '[URL: ' + url + ']\n' + (ct.includes('text/html') ? stripHtml(t) : t);
}

async function extractText(file) {
  const m = file.mimetype, n = file.originalname.toLowerCase();
  if (m === 'text/plain' || n.endsWith('.txt') || n.endsWith('.md') || n.endsWith('.csv')) return file.buffer.toString('utf8');
  if (m === 'text/html' || n.endsWith('.html') || n.endsWith('.htm')) return stripHtml(file.buffer.toString('utf8'));
  if (m === 'application/pdf' || n.endsWith('.pdf')) { const d = await pdfParse(file.buffer); return d.text; }
  if (n.endsWith('.docx')) { const r = await mammoth.extractRawText({ buffer: file.buffer }); return r.value; }
  throw new Error('Unsupported: ' + file.originalname);
}

const ALL_TYPES = [
  'work-task', 'work-decision', 'work-idea', 'work-project', 'work-meeting', 'work-password',
  'personal-task', 'personal-decision', 'personal-idea', 'personal-project', 'personal-recipe', 'personal-password', 'personal-meeting',
  'health-task', 'health-idea', 'health-project',
  'finance-task', 'finance-idea', 'finance-project',
  'Kathie-Wife', 'Zach-Son', 'Ethan-Son', 'Andy-FatherInLaw',
  'Maureen-Aunt', 'Kathy-Aunt', 'Micky-Stepmother', 'Lee-Brother', 'Charity-SisterInLaw',
  'Kevin-Dog', 'Mat-Cat', 'Phil-Cat', 'Ace-Cat', 'Herschel-Lizard', 'hens', 'hey-hey-Rooster',
  'pi', 'list', 'remind', 'random', 'open-loop', 'closed-loop', 'calendar', 'anchor', 'employment', 'claude-handoff',
  'private-thoughts', 'personal-thought',
  'pending',
  'work', 'personal', 'home', 'home-task', 'home-decision', 'kids', 'kids-task',
  'health', 'finance', 'social', 'email', 'idea', 'brain-dump',
  'anchor-task', 'work-claude-handoff', 'system-summary', 'summary', 'recipe', 'password'
];

const WORK_TYPES = ['work-task', 'work-decision', 'work-idea', 'work-project', 'work-meeting', 'work-password', 'calendar', 'employment', 'claude-handoff'];

const CAT = {
  'wt': 'work-task', 'wd': 'work-decision', 'wi': 'work-idea', 'wp': 'work-project',
  'wm': 'work-meeting', 'wpw': 'work-password',
  'pst': 'personal-task', 'pta': 'personal-task', 'pd': 'personal-decision', 'pid': 'personal-idea', 'pp': 'personal-project',
  'rec': 'personal-recipe', 'rcp': 'personal-recipe', 'ppw': 'personal-password', 'pm': 'personal-meeting',
  'ht': 'health-task', 'hid': 'health-idea', 'hpr': 'health-project',
  'ft': 'finance-task', 'fid': 'finance-idea', 'fpr': 'finance-project',
  'kw': 'Kathie-Wife', 'zs': 'Zach-Son', 'es': 'Ethan-Son', 'afl': 'Andy-FatherInLaw',
  'ma': 'Maureen-Aunt', 'ka': 'Kathy-Aunt', 'ms': 'Micky-Stepmother', 'lb': 'Lee-Brother', 'csl': 'Charity-SisterInLaw',
  'kd': 'Kevin-Dog', 'mc': 'Mat-Cat', 'pcc': 'Phil-Cat', 'acc': 'Ace-Cat',
  'liz': 'Herschel-Lizard', 'hen': 'hens', 'hhr': 'hey-hey-Rooster',
  'pi': 'pi', 'ls': 'list', 'li': 'list', 're': 'remind', 'r': 'random',
  'ol': 'open-loop', 'cal': 'calendar', 'anc': 'anchor', 'emp': 'employment', 'ch': 'claude-handoff',
  'pw': 'password', 'pass': 'password',
  'pt': 'private-thoughts'
};

function parseCat(raw) {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'); const secs = []; let cur = null;
  for (const line of lines) {
    const m = line.match(/^cat\s+(\S+)(.*)?$/i);
    const bare = !m ? line.match(/^([a-zA-Z0-9_-]+)((?:\s+(?:ls|list))?)\s*$/) : null;
    const isTypeMarker = m || (bare && (CAT[bare[1].toLowerCase()] || ALL_TYPES.includes(bare[1].toLowerCase())));
    if (isTypeMarker) {
      const mKey = m ? m[1] : bare[1];
      const mMod = m ? (m[2] || '') : (bare[2] || '');
      if (cur && cur.lines.length) secs.push(cur);
      const tokens = mKey.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      const rest = mMod.trim().toLowerCase();
      const isList = rest === 'ls' || rest === 'list';
      if (tokens.length > 1) {
        for (let ki = 0; ki < tokens.length; ki++) {
          const t = CAT[tokens[ki]] || (ALL_TYPES.includes(tokens[ki]) ? tokens[ki] : 'random');
          cur = { type: t, lines: [], isList };
          if (ki < tokens.length - 1) secs.push(cur);
        }
      } else {
        const k = tokens[0];
        cur = { type: CAT[k] || (ALL_TYPES.includes(k) ? k : 'random'), lines: [], isList };
      }
    } else if (cur && line.trim()) {
      const labelM = line.trim().match(/^@(\S+)$/);
      if (labelM) { cur.label = cur.label ? cur.label + ',' + labelM[1] : labelM[1]; }
      else { cur.lines.push(line); }
    }
  }
  if (cur && cur.lines.length) secs.push(cur);
  for (const sec of secs) {
    if (sec.isList) {
      sec.lines = sec.lines.map(l => /^\s*\[.\]/.test(l) ? l : '[ ] ' + l.trim());
    }
  }
  return secs.filter(s => s.lines.length > 0);
}

const COLORS = {
  'work-task': '#0ea5e9', 'work-decision': '#0284c7', 'work-idea': '#7dd3fc',
  'work-project': '#38bdf8', 'work-meeting': '#fb923c', 'work-password': '#f87171',
  'personal-task': '#d946ef', 'personal-decision': '#a21caf', 'personal-idea': '#c084fc',
  'personal-project': '#e879f9', 'personal-recipe': '#fb923c', 'personal-password': '#f87171',
  'personal-meeting': '#f59e0b',
  'health-task': '#ef4444', 'health-idea': '#fca5a5', 'health-project': '#f87171',
  'finance-task': '#16a34a', 'finance-idea': '#86efac', 'finance-project': '#4ade80',
  'Kathie-Wife': '#fcd34d', 'Zach-Son': '#fde68a', 'Ethan-Son': '#fbbf24',
  'Andy-FatherInLaw': '#f59e0b', 'Maureen-Aunt': '#fde68a', 'Kathy-Aunt': '#fcd34d',
  'Micky-Stepmother': '#fbbf24', 'Lee-Brother': '#f59e0b', 'Charity-SisterInLaw': '#fde68a',
  'Kevin-Dog': '#2dd4bf', 'Mat-Cat': '#5eead4', 'Phil-Cat': '#99f6e4',
  'Ace-Cat': '#67e8f9', 'Herschel-Lizard': '#a5f3fc', 'hens': '#34d399', 'hey-hey-Rooster': '#4ade80',
  'pi': '#fcd34d', 'list': '#22d3ee', 'remind': '#f472b6', 'random': '#94a3b8',
  'open-loop': '#fb923c', 'closed-loop': '#6b7280', 'calendar': '#c084fc', 'anchor': '#34d399',
  'employment': '#94a3b8', 'claude-handoff': '#60a5fa',
  'pending': '#f59e0b',
  'work': '#38bdf8', 'personal': '#e879f9', 'home': '#fdba74', 'home-task': '#f97316',
  'kids': '#fde68a', 'kids-task': '#fbbf24', 'health': '#f87171', 'finance': '#4ade80',
  'social': '#86efac', 'email': '#67e8f9', 'idea': '#a78bfa', 'brain-dump': '#60a5fa',
  'summary': '#fbbf24', 'anchor-task': '#10b981', 'recipe': '#fb923c', 'password': '#f87171',
  'private-thoughts': '#a855f7',
  'personal-thought': '#a855f7'
};

function typeColor(t) { return COLORS[t] || '#60a5fa'; }

module.exports = { esc, stripHtml, fetchUrl, extractText, parseCat, typeColor, ALL_TYPES, WORK_TYPES, COLORS };

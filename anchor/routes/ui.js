'use strict';
const express = require('express');
const router  = express.Router();
const fs = require('fs');
const path = require('path');
const { db, decryptNote, getPending, getLastSync, shouldSync } = require('../lib/db');
const { esc, typeColor, ALL_TYPES } = require('../lib/helpers');
const { emailEnabled } = require('./bridge');
const { getTempestToken } = require('../lib/weather');

const ICON_PATH = path.join(__dirname, '../assets/anchor-icon.png');
const ICON_BUF  = fs.existsSync(ICON_PATH) ? fs.readFileSync(ICON_PATH) : Buffer.alloc(0);

function renderListContent(text, noteId) {
  const lines = (text || '').split('\n').filter(l => l.trim());
  if (!lines.length) return '<div class="list-items"></div>';
  const firstIsLabel = lines.length > 1 && !/^\[.\]/i.test(lines[0].trim());
  let html = '';
  if (firstIsLabel) {
    html += `<div style="font-weight:600;color:#22d3ee;margin-bottom:8px;font-size:.85rem;text-transform:uppercase;letter-spacing:.5px">${esc(lines[0].trim())}</div>`;
  }
  const startIdx = firstIsLabel ? 1 : 0;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const checked = /^\[x\]/i.test(line.trim());
    const label = line.replace(/^\[.\]\s*/, '').trim();
    const uid = 'chk-' + noteId + '-' + i;
    html += `<label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;margin-bottom:4px">
      <input type="checkbox" id="${uid}" ${checked?'checked':''} onchange="toggleListItem(${noteId},${i},this.checked)" style="margin-top:3px;accent-color:#22d3ee">
      <span style="${checked?'text-decoration:line-through;color:#475569':''}">${esc(label)}</span>
    </label>`;
  }
  return '<div class="list-items">' + html + '</div>';
}

function renderNote(n) {
  n = decryptNote(n);
  const color = typeColor(n.type), ip = n.status==='pending';
  const opts = ALL_TYPES.map(t => '<option value="'+t+'"'+(t===n.type?' selected':'')+'>'+t+'</option>').join('');
  const isList    = n.type === 'list' || /^\s*\[.\]/m.test(n.formatted || '') || /^\s*\[.\]/m.test(n.raw_input || '');
  const listSrc   = (n.formatted && /^\s*\[.\]/m.test(n.formatted)) ? n.formatted : (n.raw_input || n.formatted || '');
  const isRemind  = n.type === 'remind';
  const isOpenLoop = n.type === 'open-loop';
  const numBadge = (isRemind && n.remind_num != null)
    ? `<span class="remind-num" title="Reminder #${n.remind_num} — type: done ${n.remind_num} or snooze ${n.remind_num}">#${n.remind_num}</span>`
    : '';
  const remindBadge = isRemind && n.remind_at
    ? `<span style="font-size:.7rem;color:#f472b6;background:#2d0a1a;padding:2px 7px;border-radius:20px;border:1px solid #f472b630">🔔 ${new Date(n.remind_at).toLocaleString()}</span>`
    : (isRemind ? '<span style="font-size:.7rem;color:#f472b6;opacity:.5">🔔 no alarm set</span>' : '');
  const openLoopBadge = isOpenLoop
    ? '<span style="font-size:.7rem;color:#fb923c;background:#1a0a00;padding:2px 7px;border-radius:20px;border:1px solid #fb923c40">🔓 open loop — in daily email</span>'
    : '';
  const quickActions = (isRemind && n.remind_num != null)
    ? `<div class="remind-actions">
        <button class="btn-done" onclick="quickDone(${n.remind_num},${n.id})">✓ done ${n.remind_num}</button>
        <button class="btn-snooze" onclick="quickSnooze(${n.remind_num},${n.id})">⏱ snooze ${n.remind_num}</button>
        <button class="btn-snooze-pick" onclick="quickSnoozePick(${n.remind_num},${n.id})">📅 snooze to…</button>
      </div>`
    : '';
  const rawText = n.formatted || n.raw_input || '';
  const collapsible = !ip;
  const formattedContent = isList
    ? '<div class="list-wrap' + (collapsible ? ' list-collapse' : '') + '" id="fmt-'+n.id+'">' + renderListContent(listSrc, n.id) + '</div>'
      + (collapsible ? '<button class="btn-expand" id="exp-'+n.id+'" onclick="toggleExpand('+n.id+')">▼ more</button>' : '')
    : '<div class="formatted' + (collapsible ? ' fmt-collapse' : '') + '" id="fmt-'+n.id+'">' + esc(rawText) + '</div>'
      + (collapsible ? '<button class="btn-expand" id="exp-'+n.id+'" onclick="toggleExpand('+n.id+')">▼ more</button>' : '');
  const dateTs = isRemind && n.remind_at ? n.remind_at : n.created_at;
  return `<div class="note${ip?' note-pending':''}${isRemind&&n.remind_num!=null?' note-remind':''}${isOpenLoop?' note-openloop':''}" id="note-${n.id}">
    <div class="note-meta">
      ${numBadge}
      <span class="note-type" style="color:${color};border-color:${color}20;background:${color}15">${esc(n.type)}</span>
      ${ip?'<span class="pending-badge">⏳ unsynced</span>':''}
      ${remindBadge}${openLoopBadge}
      <span class="note-date" data-ts="${esc(dateTs)}"></span>
      <span class="note-actions">
        <button class="btn-icon" onclick="startEdit(${n.id})">✏️</button>
        <button class="btn-icon btn-delete" onclick="deleteNote(${n.id})">🗑</button>
      </span>
    </div>
    ${formattedContent}
    ${quickActions}
    <div class="note-edit" id="edit-${n.id}" style="display:none">
      <textarea class="edit-ta" id="etxt-${n.id}">${esc(n.formatted||n.raw_input)}</textarea>
      <input type="text" class="edit-tags" id="etags-${n.id}" placeholder="Labels (comma-separated, e.g. casmas-bridge, code-index)" value="${esc(n.tags||'')}">
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn btn-primary" style="padding:5px 12px;font-size:.85rem" onclick="saveEdit(${n.id})">Save</button>
        <button class="btn btn-secondary" style="padding:5px 12px;font-size:.85rem" onclick="cancelEdit(${n.id})">Cancel</button>
      </div>
    </div>
    ${n.tags&&!ip?'<div class="note-tags">'+n.tags.split(',').map(t=>{const ts=t.trim();return '<span class="tag" data-tag="'+esc(ts)+'" onclick="filterByTag(this.dataset.tag)" title="Filter by label">'+esc(ts)+'</span>';}).join('')+'</div>':''}
    ${n.open_loops?'<div class="note-loops">🔁 '+esc(n.open_loops)+'</div>':''}
    <div class="note-rc">
      <select class="rc-sel" onchange="reclassify(${n.id},this.value)"><option value="">↩ reclassify...</option>${opts}</select>
      <span class="rc-st" id="rcs-${n.id}"></span>
    </div>
  </div>`;
}

router.get('/apple-touch-icon.png', (q,s) => { s.setHeader('Content-Type','image/png'); s.send(ICON_BUF); });
router.get('/icon-192.png',         (q,s) => { s.setHeader('Content-Type','image/png'); s.send(ICON_BUF); });
router.get('/manifest.json',        (q,s) => s.json({ name:'Anchor', short_name:'Anchor', description:"Dan's memory, context, and second brain", start_url:'/', display:'standalone', background_color:'#0d1117', theme_color:'#1e3a5f', icons:[{src:'/icon-192.png',sizes:'192x192',type:'image/png'}] }));

function queryNotes(q, type, tag, sort, showReminders) {
  let query = 'SELECT * FROM notes WHERE 1=1'; const params = [];
  if (q)   { query += ' AND (formatted LIKE ? OR raw_input LIKE ? OR tags LIKE ?)'; params.push('%'+q+'%','%'+q+'%','%'+q+'%'); }
  if (type){ query += ' AND type=?'; params.push(type); }
  else if (!showReminders) { query += " AND type != 'remind'"; }
  if (tag) { query += ' AND tags LIKE ?'; params.push('%'+tag+'%'); }
  const so = { 'newest':'ORDER BY created_at DESC','oldest':'ORDER BY created_at ASC','type':'ORDER BY type ASC,created_at DESC','unsynced':"ORDER BY (status='pending') DESC,created_at DESC",'open-loops':"ORDER BY (open_loops IS NOT NULL AND open_loops!='') DESC,created_at DESC",'type-date':'ORDER BY type ASC,created_at DESC' };
  query += ' ' + (so[sort]||so['newest']) + ' LIMIT 30';
  return db.prepare(query).all(...params);
}

router.get('/notes-html', (req, res) => {
  const { q, type, tag, sort, reminders } = req.query;
  const showReminders = reminders === '1' || type === 'remind';
  const notes = queryNotes(q, type, tag||'', sort, showReminders);
  res.send(notes.length ? notes.map(renderNote).join('') : '<div class="empty">No notes yet.</div>');
});

router.post('/remind-cmd', (req, res) => {
  const { cmd, num, when } = req.body;
  if (!cmd || num == null) return res.json({ ok: false, error: 'Missing cmd or num' });
  try {
    const { processCommands } = require('../lib/remind');
    let text;
    if (cmd === 'done')   text = `done ${num}`;
    if (cmd === 'snooze') text = when ? `snooze ${num} ${when}` : `snooze ${num}`;
    if (!text) return res.json({ ok: false, error: 'Unknown cmd' });
    const results = processCommands(text);
    res.json({ ok: true, results });
  } catch(e) { res.json({ ok: false, error: e.message }); }
});

router.get('/', (req, res) => {
  const { q, type, tag, sort } = req.query;
  const notes = queryNotes(q, type, tag, sort, false);
  const { count: pc } = getPending();
  const ls  = getLastSync(); const lss = ls ? ls.toLocaleString() : 'Never';
  const as  = shouldSync();
  const useOllama = process.env.USE_OLLAMA === 'true';
  const engineLabel = useOllama ? '🐓 Rooster (local)' : '🤖 Anthropic API';
  const hasWeather = !!getTempestToken();
  const now = new Date();
  const ya = new Date(now); ya.setFullYear(now.getFullYear()-1);
  const sa = new Date(now); sa.setMonth(now.getMonth()-6);
  const ma = new Date(now); ma.setMonth(now.getMonth()-1);
  const otd = d => db.prepare("SELECT * FROM notes WHERE date(datetime(created_at,'localtime'))=? LIMIT 3").all(d.toLocaleDateString('en-CA'));
  const yn=otd(ya), sn=otd(sa), mn=otd(ma);
  const hasOTD = yn.length||sn.length||mn.length;
  const TG = [
    {l:'Work',t:['work-task','work-decision','work-idea','work-project','work-meeting','work-password']},
    {l:'Personal',t:['personal-task','personal-decision','personal-idea','personal-project','personal-recipe','personal-password','personal-meeting']},
    {l:'Health',t:['health-task','health-idea','health-project']},
    {l:'Finance',t:['finance-task','finance-idea','finance-project']},
    {l:'Family',t:['Kathie-Wife','Zach-Son','Ethan-Son','Andy-FatherInLaw','Maureen-Aunt','Kathy-Aunt','Micky-Stepmother','Lee-Brother','Charity-SisterInLaw']},
    {l:'Pets',t:['Kevin-Dog','Mat-Cat','Phil-Cat','Ace-Cat','Herschel-Lizard','hens','hey-hey-Rooster']},
    {l:'System',t:['pi','remind','random','list','open-loop','calendar','anchor','employment','claude-handoff']}
  ];
  const typeOpts = TG.map(g=>'<optgroup label="'+g.l+'">'+g.t.map(t=>'<option value="'+t+'"'+(type===t?' selected':'')+'>'+t+'</option>').join('')+'</optgroup>').join('');
  const ss = v => sort===v||(!sort&&v==='newest')?'selected':'';

  res.send(`<!DOCTYPE html><html><head>
  <title>Anchor 2.0</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1e3a5f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Anchor 2.0">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="icon" type="image/png" href="/apple-touch-icon.png">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#0d1117;color:#e2e8f0;font-size:16px;line-height:1.6}
    .hdr{background:linear-gradient(135deg,#1e3a5f,#1a1f35);border-bottom:1px solid #2d4a7a;padding:16px 32px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
    .hdr-icon{width:56px;height:56px;flex-shrink:0;object-fit:contain}
    .hdr-text{flex:1}.hdr-text h1{font-size:1.8rem;font-weight:700;color:#93c5fd}.hdr-text p{font-size:.85rem;color:#64748b}
    .hdr-right{display:flex;flex-direction:row;align-items:center;gap:20px}
    .hdr-time{font-size:.85rem;color:#e2e8f0;white-space:nowrap}
    .engine-lbl{font-size:.68rem;color:#64748b;margin-top:2px}
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
    .btn-rebuild{background:#2d1e1e;color:#f87171;border:1px solid #f8717140;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600}
    .btn-digest{background:#1e2d45;color:#fb923c;border:1px solid #fb923c40;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600}
    .btn-groom{background:#1e2d45;color:#c084fc;border:1px solid #c084fc40;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600}
    .btn-remind-toggle{background:#1e2d45;color:#f472b6;border:1px solid #f472b640;font-size:.82rem;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600;white-space:nowrap}
    .btn-remind-toggle.active{background:#2d0a1a;color:#fda4af;border-color:#f472b6}
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
    .note-remind{border-color:#f472b630;background:#1a0a14}
    .note-openloop{border-color:#fb923c50;background:#1a0d00}
    .note-meta{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
    .note-type{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:3px 8px;border-radius:20px;border:1px solid}
    .pending-badge{font-size:.7rem;color:#f59e0b;background:#292208;padding:2px 7px;border-radius:20px;border:1px solid #f59e0b30}
    .note-date{font-size:.78rem;color:#475569}
    .note-actions{margin-left:auto;display:flex;gap:2px}
    .formatted{white-space:pre-wrap;font-size:.95rem;line-height:1.7;color:#cbd5e1}
    .list-items{font-size:.95rem;line-height:1.7;color:#cbd5e1}
    .note-edit{margin-top:8px}
    .edit-ta{width:100%;height:100px;background:#0d1117;color:#e2e8f0;border:1px solid #60a5fa;border-radius:8px;padding:10px;font-size:.92rem;font-family:inherit;resize:vertical}
    .edit-tags{width:100%;background:#0d1117;color:#e2e8f0;border:1px solid #60a5fa40;border-radius:6px;padding:6px 10px;font-size:.82rem;font-family:inherit;margin-top:6px;box-sizing:border-box}
    .edit-tags::placeholder{color:#334155}
    .note-tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
    .tag{font-size:.75rem;background:#1e3a5f;color:#93c5fd;padding:2px 8px;border-radius:20px;cursor:pointer;transition:background .15s}
    .tag:hover{background:#264a7a}
    .note-loops{margin-top:8px;font-size:.88rem;color:#fbbf24;background:#292208;padding:8px 12px;border-radius:6px;border-left:3px solid #fbbf24}
    .note-rc{margin-top:8px;display:flex;align-items:center;gap:8px}
    .rc-sel{background:#0d1117;color:#475569;border:1px solid #1e2d45;border-radius:6px;padding:3px 8px;font-size:.78rem;cursor:pointer}
    .rc-st{font-size:.75rem;color:#4ade80}
    .chat-msgs{max-height:380px;overflow-y:auto;margin-bottom:14px;display:flex;flex-direction:column;gap:10px}
    .msg{padding:10px 14px;border-radius:10px;font-size:.92rem;line-height:1.6;max-width:92%}
    .msg.user{background:#1e3a5f;color:#bfdbfe;align-self:flex-end}
    .msg.ai{background:#1a2232;color:#e2e8f0;align-self:flex-start;border-left:3px solid #3b82f6}
    .msg.ai.opus{border-left-color:#a78bfa}
    .msg.ai.rooster{border-left-color:#4ade80}
    .chat-in{display:flex;gap:8px}.chat-in input{flex:1}
    .chat-mr{display:flex;align-items:center;gap:8px;margin-top:8px}
    .model-lbl{font-size:.75rem;color:#475569}
    .groom-report{margin-top:8px;padding:10px 12px;background:#0d1117;border:1px solid #c084fc30;border-radius:8px;font-size:.82rem;color:#c4b5fd;white-space:pre-wrap;display:none}
    .otd-lbl{font-size:.75rem;color:#475569;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;margin-top:14px}
    .empty{color:#334155;font-size:.9rem;padding:20px;text-align:center}
    .cmd-ref{font-size:.82rem;color:#94a3b8;line-height:1.9}
    .cmd-ref code{background:#0d1117;color:#22d3ee;padding:1px 6px;border-radius:4px;font-size:.8rem;font-family:monospace}
    .cmd-ref .cmd-group{margin-bottom:12px}
    .cmd-ref .cmd-label{color:#475569;font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
    .fmt-collapse{max-height:72px;overflow:hidden}
    .list-collapse{max-height:140px;overflow:hidden}
    .btn-expand{background:none;border:none;color:#3b82f6;font-size:.78rem;cursor:pointer;padding:3px 0;margin-top:2px;display:block;opacity:.8}
    .btn-expand:hover{color:#60a5fa;opacity:1}
    .remind-num{display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:32px;padding:0 10px;background:#7c1d3f;color:#fda4af;font-size:1rem;font-weight:800;border-radius:8px;border:2px solid #f472b6;letter-spacing:.5px;cursor:default;flex-shrink:0}
    .remind-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
    .btn-done{background:#14532d;color:#4ade80;border:1px solid #4ade8040;font-size:.8rem;font-weight:700;padding:5px 12px;border-radius:6px;cursor:pointer}
    .btn-done:hover{background:#166534;border-color:#4ade80}
    .btn-snooze{background:#1e1a35;color:#a78bfa;border:1px solid #a78bfa40;font-size:.8rem;font-weight:700;padding:5px 12px;border-radius:6px;cursor:pointer}
    .btn-snooze:hover{background:#2e1a5e;border-color:#a78bfa}
    .btn-snooze-pick{background:#1a2232;color:#60a5fa;border:1px solid #60a5fa40;font-size:.8rem;font-weight:700;padding:5px 12px;border-radius:6px;cursor:pointer}
    .btn-snooze-pick:hover{background:#1e3a5f;border-color:#60a5fa}
    .wx-panel{background:#0d1117;border-radius:10px;padding:14px 16px}
    .wx-main{display:flex;align-items:flex-end;gap:16px;margin-bottom:10px}
    .wx-temp{font-size:2.8rem;font-weight:700;color:#f0f9ff;line-height:1}
    .wx-feels{font-size:.8rem;color:#475569;margin-top:2px}
    .wx-row{display:flex;gap:16px;flex-wrap:wrap}
    .wx-stat{display:flex;flex-direction:column;align-items:center;background:#161b27;border:1px solid #1e2d45;border-radius:8px;padding:8px 12px;min-width:72px}
    .wx-stat-val{font-size:1rem;font-weight:600;color:#e2e8f0}
    .wx-stat-lbl{font-size:.68rem;color:#475569;text-transform:uppercase;letter-spacing:.3px;margin-top:2px}
    .wx-time{font-size:.72rem;color:#334155;margin-top:10px;text-align:right}
    .wx-refresh{background:none;border:none;color:#334155;cursor:pointer;font-size:.75rem;padding:2px 6px;border-radius:4px}
    .wx-refresh:hover{color:#60a5fa}
    .wx-loading{color:#334155;font-size:.85rem;padding:8px 0}
    .wx-error{color:#475569;font-size:.82rem;padding:8px 0}
  </style></head><body>
  <div class="hdr">
    <img src="/apple-touch-icon.png" class="hdr-icon" alt="Anchor 2.0">
    <div class="hdr-text"><h1>Anchor <span style="font-size:1rem;color:#fcd34d;font-weight:500">2.0</span></h1><p>Dan's memory, context, and second brain</p></div>
    <div class="hdr-right">
      <div class="hdr-time" id="hdrTime"></div>
      <div class="engine-lbl">${engineLabel}</div>
      ${req.headers['cf-access-authenticated-user-email']?'<a href="/cdn-cgi/access/logout" class="btn-logout">Sign out</a>':''}
    </div>
  </div>
  <div class="main">
    <div style="display:flex;flex-direction:column;gap:20px">
      <div class="panel">
        <h2><span class="dot"></span>Add Note</h2>
        <textarea id="inp" placeholder="Brain dump here. Type, paste a URL, or paste/drag an image."></textarea>
        <div class="file-row">
          <label class="file-lbl">📎 Attach<input type="file" id="fi" accept=".txt,.md,.csv,.pdf,.docx,.html,.htm,.jpg,.jpeg,.png,.gif,.webp" onchange="fileSelected(this)" style="display:none"></label>
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
            <span class="sync-ct"><strong id="pc">${pc}</strong> pending</span>
            ${as?'<span class="sync-auto">⚡ auto-sync recommended</span>':''}
            <span class="sync-last">Last: ${lss}</span>
            <button class="btn-sync" id="syncBtn" onclick="runSync()" ${pc===0?'disabled':''}>Sync Now</button>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px">
            <button class="btn-bridge" onclick="pullBridge()">⇄ Sync Bridge</button>
            <button class="btn-rebuild" onclick="runRebuild()">🔨 Rebuild</button>
            <button class="btn-groom" onclick="runGroom()">🧹 Groom</button>
            ${emailEnabled?'<button class="btn-digest" onclick="sendDigest()">📋 Digest</button>':''}
            <span class="status" id="bs" style="margin:0"></span>
          </div>
          <div class="groom-report" id="groomReport"></div>
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
            <input type="text" id="stag" placeholder="Label..." value="${esc(tag||'')}" title="Filter by label (click a tag badge to fill)" style="max-width:130px">
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
          <div style="margin-bottom:12px">
            <button class="btn-remind-toggle" id="remindToggle" onclick="toggleReminders()">🔔 Reminders</button>
          </div>
          <div class="notes-list">${notes.length?notes.map(renderNote).join(''):'<div class="empty">No notes yet.</div>'}</div>
        </div>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:20px">
      ${hasWeather ? `<div class="panel" id="wxPanel">
        <h2 onclick="toggleWx()"><span class="dot" style="background:#38bdf8"></span>🌤 Casmas Weather
          <button class="wx-refresh" onclick="event.stopPropagation();loadWeather()" title="Refresh">↻</button>
          <span class="chev" id="wxChev">▼</span>
        </h2>
        <div id="wxBody" class="collapsed"></div>
      </div>` : ''}
      <div class="panel">
        <h2 onclick="tp('cb','cc')"><span class="dot" style="background:#a78bfa"></span>Ask Anchor<span class="chev" id="cc">▼</span></h2>
        <div id="cb" class="collapsed">
          <div class="chat-msgs" id="cm"><div class="msg ai">Ask me anything about your notes.</div></div>
          <div class="chat-in">
            <input type="text" id="ci" placeholder="What are my open loops?">
            <button class="btn btn-primary" onclick="chat('haiku')">Ask</button>
          </div>
          <div class="chat-mr"><span class="model-lbl">Need Claude's brain?</span><button class="btn btn-opus" onclick="chat('claude')">Ask Claude ($)</button></div>
          <div class="loading" id="cl" style="margin-top:8px">⏳ Reading notes...</div>
          <div style="margin-top:12px">
            <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:#475569;font-size:.8rem" onclick="toggleHistory()">
              <span>📜 Chat History</span><span id="histChev">▶</span>
            </div>
            <div id="histBox" style="display:none;margin-top:8px;max-height:300px;overflow-y:auto;border-top:1px solid #1e2d45;padding-top:8px"></div>
            <div style="display:flex;gap:8px;margin-top:4px">
              <button class="btn-bridge" onclick="clearHistory()" style="font-size:.72rem;padding:3px 8px">🗑 Clear History</button>
            </div>
          </div>
        </div>
      </div>
      <div class="panel">
        <h2 onclick="tp('refb','refc')"><span class="dot" style="background:#22d3ee"></span>📖 Commands<span class="chev" id="refc">▼</span></h2>
        <div id="refb" class="collapsed">
          <div class="cmd-ref">
            <div class="cmd-group">
              <div class="cmd-label">Work</div>
              <code>wt</code> task &nbsp; <code>wp</code> project &nbsp; <code>wd</code> decision &nbsp; <code>wm</code> meeting &nbsp; <code>wi</code> idea &nbsp; <code>wpw</code> password
            </div>
            <div class="cmd-group">
              <div class="cmd-label">Personal</div>
              <code>pt</code> task &nbsp; <code>pp</code> project &nbsp; <code>pd</code> decision &nbsp; <code>pm</code> meeting &nbsp; <code>pid</code> idea &nbsp; <code>rec</code> recipe &nbsp; <code>ppw</code> password
            </div>
            <div class="cmd-group">
              <div class="cmd-label">Health &amp; Finance</div>
              <code>ht</code> task &nbsp; <code>hid</code> idea &nbsp; <code>hpr</code> project &nbsp;&nbsp;&nbsp; <code>ft</code> task &nbsp; <code>fid</code> idea &nbsp; <code>fpr</code> project
            </div>
            <div class="cmd-group">
              <div class="cmd-label">Family</div>
              <code>kw</code> Kathie &nbsp; <code>zs</code> Zach &nbsp; <code>es</code> Ethan &nbsp; <code>afl</code> Andy &nbsp; <code>ma</code> Maureen &nbsp; <code>ka</code> Kathy-Aunt<br>
              <code>ms</code> Micky &nbsp; <code>lb</code> Lee &nbsp; <code>csl</code> Charity
            </div>
            <div class="cmd-group">
              <div class="cmd-label">Pets</div>
              <code>kd</code> Kevin &nbsp; <code>mc</code> Mat &nbsp; <code>pcc</code> Phil &nbsp; <code>acc</code> Ace &nbsp; <code>liz</code> Herschel &nbsp; <code>hen</code> hens &nbsp; <code>hhr</code> hey-hey-Rooster
            </div>
            <div class="cmd-group">
              <div class="cmd-label">System</div>
              <code>pi</code> personal-info &nbsp; <code>ls</code> list &nbsp; <code>re</code> remind &nbsp; <code>r</code> random &nbsp; <code>ol</code> open-loop &nbsp; <code>cal</code> calendar &nbsp; <code>anc</code> anchor &nbsp; <code>emp</code> employment &nbsp; <code>ch</code> claude-handoff
            </div>
            <div class="cmd-group">
              <div class="cmd-label">Tips</div>
              <span style="color:#94a3b8">Lines with <code>[ ]</code> or <code>[x]</code> auto-render as checklist &nbsp;|&nbsp; <code>cat pp ls</code> auto-checkboxes every line &nbsp;|&nbsp; <code>cat wt,wp</code> creates two notes</span>
            </div>
            <div class="cmd-group">
              <div class="cmd-label">Reminders</div>
              <code>remind</code> or <code>re</code> or <code>todo</code> &nbsp; then: &nbsp; <span style="color:#64748b">call dentist, monday 9am</span><br>
              <code>done N</code> &nbsp; <code>snooze N</code> &nbsp; <code>snooze N friday 3pm</code>
            </div>
          </div>
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
    function renderTimestamps(){document.querySelectorAll('.note-date[data-ts]').forEach(el=>{const ts=el.getAttribute('data-ts');if(ts){const u=ts.includes('T')?ts:ts.replace(' ','T')+'Z';el.textContent=new Date(u).toLocaleString();}});}
    renderTimestamps();
    function clock(){const el=document.getElementById('hdrTime');if(el)el.textContent=new Date().toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});}
    clock();setInterval(clock,30000);
    async function loadWeather(){
      const body=document.getElementById('wxBody');if(!body)return;
      if(body.innerHTML.trim()==='')body.innerHTML='<div class="wx-loading">Loading...</div>';
      try{
        const r=await fetch('/weather');const d=await r.json();
        if(!d.ok){body.innerHTML='<div class="wx-error">Unavailable</div>';return;}
        const feels=d.feelsF!=null&&d.feelsF!==d.tempF?'<div class="wx-feels">feels '+d.feelsF+'°F</div>':'';
        const gust=d.gustMph?d.windMph+' / '+d.gustMph:d.windMph||'—';
        const hiLo=d.highF!=null&&d.lowF!=null?d.highF+'° / '+d.lowF+'°':'—';
        const precipColor=d.precipChance>60?'#f87171':d.precipChance>30?'#fbbf24':'#4ade80';
        body.innerHTML=\`
          <div class="wx-panel">
            <div class="wx-main">
              <div><div class="wx-temp">\${d.tempF!=null?d.tempF+'°':'—'}</div>\${feels}</div>
              \${d.forecastConditions||d.conditions?'<div style="font-size:.85rem;color:#94a3b8;margin-left:auto;text-align:right">'+(d.forecastConditions||d.conditions)+'</div>':''}
            </div>
            <div class="wx-row">
              <div class="wx-stat"><span class="wx-stat-val">\${d.humidity!=null?d.humidity+'%':'—'}</span><span class="wx-stat-lbl">Humidity</span></div>
              <div class="wx-stat"><span class="wx-stat-val">\${gust} mph</span><span class="wx-stat-lbl">Wind \${d.windDir||''}</span></div>
              <div class="wx-stat"><span class="wx-stat-val">\${d.pressureMb||'—'}</span><span class="wx-stat-lbl">Pressure mb</span></div>
              <div class="wx-stat"><span class="wx-stat-val">UV \${d.uv||'—'}</span><span class="wx-stat-lbl">Index</span></div>
              <div class="wx-stat"><span class="wx-stat-val">\${hiLo}</span><span class="wx-stat-lbl">Hi / Lo</span></div>
              <div class="wx-stat"><span class="wx-stat-val" style="color:\${precipColor}">\${d.precipChance!=null?d.precipChance+'%':'—'}</span><span class="wx-stat-lbl">Rain chance</span></div>
              \${d.rainToday?'<div class="wx-stat"><span class="wx-stat-val">'+d.rainToday+'"</span><span class="wx-stat-lbl">Rain today</span></div>':''}
              \${d.lightning?'<div class="wx-stat"><span class="wx-stat-val">⚡ '+d.lightning+'</span><span class="wx-stat-lbl">Strikes/hr</span></div>':''}
            </div>
            <div class="wx-time">Updated \${d.time} · Casmas station</div>
          </div>\`;
      }catch(e){body.innerHTML='<div class="wx-error">Could not load weather</div>';}
    }
    function toggleWx(){
      const body=document.getElementById('wxBody'),chev=document.getElementById('wxChev');
      const collapsed=body.classList.contains('collapsed');
      body.classList.toggle('collapsed',!collapsed);
      if(chev)chev.classList.toggle('open',collapsed);
      if(collapsed&&body.innerHTML.trim()===''){loadWeather();}
    }
    if(document.getElementById('wxBody')){setInterval(()=>{if(!document.getElementById('wxBody')?.classList.contains('collapsed'))loadWeather();},600000);}
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
        if(d.ok){let m='✓ Synced '+d.processed+' notes';if(d.splits>0)m+=', split '+d.splits;if(d.flagged>0)m+=', '+d.flagged+' flagged';if(d.engine)m+=' ('+d.engine+')';document.getElementById('ss').textContent=m;setTimeout(()=>location.reload(),1000);}
        else{document.getElementById('ss').textContent='✗ '+(d.error||'Sync failed');btn.disabled=false;}
      }catch(e){document.getElementById('ss').textContent='✗ Sync failed';btn.disabled=false;}
      document.getElementById('sl').style.display='none';
    }
    async function pullBridge(){
      const s=document.getElementById('bs');s.textContent='⏳ Syncing...';
      try{
        const r=await fetch('/pull-bridge?force=1',{method:'POST'});const d=await r.json();
        if(d.ok){const applied=d.applyLog&&d.applyLog.length?' — code applied, restarting…':'';s.textContent='✓ '+d.ingested+' ingested, '+d.skipped+' skipped'+applied;setTimeout(()=>location.reload(),2500);}
        else{s.textContent='✗ '+(d.error||'Failed');}
      }catch(e){s.textContent='✗ Failed';}
    }
    async function runRebuild(){
      if(!confirm('Full Docker rebuild — service will be down for ~1-2 min. Continue?')) return;
      const s=document.getElementById('bs');s.textContent='⏳ Rebuilding...';
      const btn=document.querySelector('.btn-rebuild');if(btn)btn.disabled=true;
      try{
        const r=await fetch('/pull-bridge/rebuild',{method:'POST'});const d=await r.json();
        if(d.ok){s.textContent='✓ Rebuild done — reloading in 5s…';setTimeout(()=>location.reload(),5000);}
        else{s.textContent='✗ '+(d.error||'Rebuild failed');}
      }catch(e){s.textContent='✗ Request failed (reload manually)';}
      if(btn)btn.disabled=false;
    }
    async function runGroom(){
      const s=document.getElementById('bs');const r=document.getElementById('groomReport');
      s.textContent='⏳ Grooming...';r.style.display='none';
      try{
        const res=await fetch('/groom',{method:'POST'});const d=await res.json();
        if(d.ok){s.textContent='✓ Groom complete'+(d.fixed>0?' — fixed '+d.fixed:'');r.textContent=d.report;r.style.display='block';}
        else{s.textContent='✗ '+(d.error||'Groom failed');}
      }catch(e){s.textContent='✗ Failed';}
    }
    async function sendDigest(){
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
    function tp(bid,cid){const b=document.getElementById(bid),c=document.getElementById(cid),col=b.classList.contains('collapsed');b.classList.toggle('collapsed',!col);c.classList.toggle('open',col);}
    function isLocal(){const h=window.location.hostname;return h==='localhost'||h.startsWith('192.168.')||h.startsWith('10.')||h.startsWith('172.');}
    if(isLocal()){['sb','nb','cb','refb'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('collapsed');});['sc','nc','cc','refc'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.add('open');});}
    function toggleExpand(id){
      const fmt=document.getElementById('fmt-'+id),btn=document.getElementById('exp-'+id);
      if(!fmt||!btn)return;
      const cls=fmt.classList.contains('list-collapse')?'list-collapse':'fmt-collapse';
      const collapsed=fmt.classList.contains(cls);
      fmt.classList.toggle(cls,!collapsed);
      btn.textContent=collapsed?'▲ less':'▼ more';
    }
    let _showReminders=false;
    function toggleReminders(){
      _showReminders=!_showReminders;
      const btn=document.getElementById('remindToggle');
      btn.classList.toggle('active',_showReminders);
      btn.textContent=_showReminders?'🔔 Reminders ✓':'🔔 Reminders';
      const st=document.getElementById('st');
      if(_showReminders&&st)st.value='';
      doSearch();
    }
    const HIST_KEY='anchor_chat_history';const MAX_HIST=30;
    function loadHistory(){try{return JSON.parse(localStorage.getItem(HIST_KEY)||'[]');}catch{return[];}}
    function saveToHistory(q,a,engine){const h=loadHistory();h.push({ts:new Date().toLocaleString(),q,a,engine});if(h.length>MAX_HIST)h.splice(0,h.length-MAX_HIST);localStorage.setItem(HIST_KEY,JSON.stringify(h));renderHistory();}
    function renderHistory(){
      const box=document.getElementById('histBox');if(!box)return;
      const h=loadHistory();
      if(!h.length){box.innerHTML='<div style="color:#475569;font-size:.8rem">No history yet.</div>';return;}
      box.innerHTML=[...h].reverse().map(e=>{
        const eng=e.engine==='rooster'?'<span style="color:#4ade80;font-size:.65rem">🐓</span>':e.engine==='claude'?'<span style="color:#a78bfa;font-size:.65rem">⚡</span>':'';
        return '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #1e2d45"><div style="font-size:.7rem;color:#475569;margin-bottom:3px">'+e.ts+' '+eng+'</div><div style="font-size:.82rem;color:#94a3b8;margin-bottom:3px">Q: '+e.q+'</div><div style="font-size:.85rem;color:#e2e8f0">'+e.a+'</div></div>';
      }).join('');
    }
    function toggleHistory(){const box=document.getElementById('histBox'),chev=document.getElementById('histChev');const open=box.style.display!=='none';box.style.display=open?'none':'block';chev.textContent=open?'▶':'▼';if(!open)renderHistory();}
    function clearHistory(){if(confirm('Clear chat history?')){localStorage.removeItem(HIST_KEY);renderHistory();}}
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
        const isRooster=d.engine==='rooster';
        const cls=isRooster?'msg ai rooster':model==='claude'?'msg ai opus':'msg ai';
        const lbl=isRooster?' <span style="font-size:.75rem;color:#4ade80;font-weight:600">🐓 Rooster</span>':model==='claude'?' <span style="font-size:.75rem;color:#a78bfa;font-weight:600">⚡ Claude</span>':'';
        msgs.innerHTML+='<div class="'+cls+'">'+d.answer+lbl+'</div>';
        saveToHistory(v,d.answer,d.engine);
      }catch(e){msgs.innerHTML+='<div class="msg ai">Error.</div>';}
      document.getElementById('cl').style.display='none';
      msgs.scrollTop=msgs.scrollHeight;
    }
    document.getElementById('ci')?.addEventListener('keydown',e=>{if(e.key==='Enter')chat('haiku');});
    document.getElementById('inp')?.addEventListener('paste',async function(e){
      const items=(e.clipboardData||window.clipboardData||{}).items||[];
      for(const item of items){
        if(item.type.startsWith('image/')){
          e.preventDefault();
          const file=item.getAsFile();if(!file)continue;
          const ns=document.getElementById('ns');ns.textContent='📷 Reading image...';
          const fd=new FormData();fd.append('file',file,'pasted-image.png');
          try{
            const r=await fetch('/note',{method:'POST',body:fd});const d=await r.json();
            if(d.ok){ns.textContent='✓ Image saved';document.getElementById('pc').textContent=d.pendingCount;if(d.pendingCount>0)document.getElementById('syncBtn').disabled=false;setTimeout(()=>{ns.textContent='';},2000);setTimeout(()=>location.reload(),600);}
            else{ns.textContent='✗ '+(d.error||'Failed');}
          }catch(err){ns.textContent='✗ Failed';}
          return;
        }
      }
    });
    document.getElementById('sq')?.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
    let _st;
    document.getElementById('sq')?.addEventListener('input',()=>{clearTimeout(_st);_st=setTimeout(doSearch,350);});
    document.getElementById('st')?.addEventListener('change',()=>{_showReminders=false;document.getElementById('remindToggle').classList.remove('active');document.getElementById('remindToggle').textContent='🔔 Reminders';doSearch();});
    document.getElementById('so')?.addEventListener('change',doSearch);
    function filterByTag(tag){const el=document.getElementById('stag');if(el){el.value=tag;doSearch();}}
    function doSearch(){
      const q=document.getElementById('sq')?.value||'',t=document.getElementById('st')?.value||'',s=document.getElementById('so')?.value||'',tg=document.getElementById('stag')?.value||'';
      const p=new URLSearchParams();if(q)p.set('q',q);if(t)p.set('type',t);if(s)p.set('sort',s);if(tg)p.set('tag',tg);
      if(_showReminders&&!t)p.set('reminders','1');
      fetch('/notes-html?'+p.toString()).then(r=>r.text()).then(html=>{
        const nl=document.querySelector('.notes-list');if(nl){nl.innerHTML=html;renderTimestamps();}
      }).catch(e=>console.error('search failed',e));
    }
    async function reclassify(id,type){
      if(!type)return;const s=document.getElementById('rcs-'+id);s.textContent='...';
      try{
        const r=await fetch('/reclassify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,type})});
        const d=await r.json();
        if(d.ok){s.textContent='✓';const noteEl=document.getElementById('note-'+id);if(noteEl){const badge=noteEl.querySelector('.note-type');if(badge)badge.textContent=type;}}
        else s.textContent='✗';
      }catch(e){s.textContent='✗';}
    }
    function startEdit(id){
      const fmt=document.getElementById('fmt-'+id),exp=document.getElementById('exp-'+id);
      if(fmt)fmt.style.display='none';if(exp)exp.style.display='none';
      document.getElementById('edit-'+id).style.display='block';
    }
    function cancelEdit(id){
      const fmt=document.getElementById('fmt-'+id),exp=document.getElementById('exp-'+id);
      if(fmt)fmt.style.display='block';if(exp)exp.style.display='block';
      document.getElementById('edit-'+id).style.display='none';
    }
    async function saveEdit(id){
      const c=document.getElementById('etxt-'+id).value.trim();if(!c)return;
      const tags=(document.getElementById('etags-'+id)?.value||'').trim();
      try{
        const r=await fetch('/notes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({formatted:c,tags})});
        const d=await r.json();
        if(d.ok){
          const fmt=document.getElementById('fmt-'+id);if(fmt){fmt.textContent=c;fmt.style.display='block';}
          document.getElementById('edit-'+id).style.display='none';
          const noteEl=document.getElementById('note-'+id);
          if(noteEl){
            let tagsDiv=noteEl.querySelector('.note-tags');
            if(tags){
              const esc2=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
              const badges=tags.split(',').map(t=>{const ts=t.trim();return '<span class="tag" data-tag="'+esc2(ts)+'" onclick="filterByTag(this.dataset.tag)" title="Filter by label">'+esc2(ts)+'</span>';}).join('');
              if(tagsDiv){tagsDiv.innerHTML=badges;}else{tagsDiv=document.createElement('div');tagsDiv.className='note-tags';tagsDiv.innerHTML=badges;const rc=noteEl.querySelector('.note-rc');if(rc)noteEl.insertBefore(tagsDiv,rc);else noteEl.appendChild(tagsDiv);}
            }else if(tagsDiv){tagsDiv.remove();}
          }
          const editBtn=document.querySelector('#note-'+id+' .btn-icon');if(editBtn){const orig=editBtn.textContent;editBtn.textContent='✓';setTimeout(()=>editBtn.textContent=orig,1200);}
        }else alert('Save failed');
      }catch(e){alert('Save failed');}
    }
    async function deleteNote(id){
      if(!confirm('Delete this note? Cannot be undone.'))return;
      try{const r=await fetch('/notes/'+id,{method:'DELETE'});const d=await r.json();if(d.ok)document.getElementById('note-'+id).remove();else alert('Delete failed');}
      catch(e){alert('Delete failed');}
    }
    async function toggleListItem(noteId,lineIndex,checked){
      try{
        const chkEl=document.getElementById('chk-'+noteId+'-'+lineIndex);if(!chkEl)return;
        const span=chkEl.parentElement?.querySelector('span');
        if(span){span.style.textDecoration=checked?'line-through':'';span.style.color=checked?'#475569':'';}
        const r=await fetch('/notes/'+noteId);const d=await r.json();if(!d.ok)return;
        const lines=(d.formatted||d.raw_input||'').split('\\n');
        const items=lines.filter(l=>l.trim());
        if(lineIndex>=items.length){console.error('toggleListItem: lineIndex out of bounds',lineIndex,items.length);return;}
        items[lineIndex]=(checked?'[x] ':'[ ] ')+items[lineIndex].replace(/^\[.\]\s*/,'');
        await fetch('/notes/'+noteId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({formatted:items.join('\\n')})});
      }catch(e){console.error('toggleListItem failed',e);}
    }
    async function quickDone(num,noteId){
      if(!confirm('Mark reminder #'+num+' done and delete it?'))return;
      try{
        const r=await fetch('/remind-cmd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'done',num})});
        const d=await r.json();
        if(d.ok)document.getElementById('note-'+noteId)?.remove();
        else alert('Failed: '+(d.error||'unknown'));
      }catch(e){alert('Failed');}
    }
    async function quickSnooze(num,noteId){
      try{
        const r=await fetch('/remind-cmd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'snooze',num})});
        const d=await r.json();
        if(d.ok){
          const res=d.results&&d.results[0];
          const newDate=res&&res.newDate?new Date(res.newDate).toLocaleString():'1 week';
          const noteEl=document.getElementById('note-'+noteId);
          if(noteEl){const badge=noteEl.querySelector('span[style*="f472b6"]');if(badge)badge.textContent='🔔 '+newDate;}
        }else alert('Failed: '+(d.error||'unknown'));
      }catch(e){alert('Failed');}
    }
    async function quickSnoozePick(num,noteId){
      const when=prompt('Snooze #'+num+' until when?\\n\\nExamples: friday 3pm, tomorrow, monday 10am, 2 weeks');
      if(!when)return;
      try{
        const r=await fetch('/remind-cmd',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'snooze',num,when})});
        const d=await r.json();
        if(d.ok){
          const res=d.results&&d.results[0];
          const newDate=res&&res.newDate?new Date(res.newDate).toLocaleString():when;
          const noteEl=document.getElementById('note-'+noteId);
          if(noteEl){const badge=noteEl.querySelector('span[style*="f472b6"]');if(badge)badge.textContent='🔔 '+newDate;}
        }else alert('Failed: '+(d.error||'unknown'));
      }catch(e){alert('Failed');}
    }
  </script></body></html>`);
});

module.exports = router;

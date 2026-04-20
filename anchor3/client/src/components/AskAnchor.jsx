import { useState, useRef, useEffect } from 'preact/hooks';
import { isLocal } from '../helpers';

const HIST_KEY = 'anchor3_chat_history';
const MAX_HIST = 30;

function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; } }
function saveHistory(q, a, engine) {
  const h = loadHistory();
  h.push({ ts: new Date().toLocaleString(), q, a, engine });
  if (h.length > MAX_HIST) h.splice(0, h.length - MAX_HIST);
  localStorage.setItem(HIST_KEY, JSON.stringify(h));
}

export function AskAnchor() {
  const [open,     setOpen]     = useState(isLocal);
  const [msgs,     setMsgs]     = useState([{ role: 'ai', text: "Ask me anything about your notes." }]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [rooster,  setRooster]  = useState(() => localStorage.getItem('anchor3_rooster') !== 'false');
  const [showHist, setShowHist] = useState(false);
  const msgsRef = useRef(null);

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight;
  }, [msgs]);

  function toggleRooster() {
    const next = !rooster;
    setRooster(next);
    localStorage.setItem('anchor3_rooster', next ? 'true' : 'false');
  }

  async function chat(model) {
    const q = input.trim(); if (!q) return;
    setMsgs(m => [...m, { role: 'user', text: q }]);
    setInput(''); setLoading(true);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, model, clientTime: new Date().toString() }) });
      const d = await r.json();
      const engine = d.engine || model;
      setMsgs(m => [...m, { role: 'ai', text: d.answer, engine }]);
      saveHistory(q, d.answer, engine);
    } catch { setMsgs(m => [...m, { role: 'ai', text: 'Error.' }]); }
    setLoading(false);
  }

  const history = loadHistory();

  return (
    <div class="panel">
      <div class="panel-hdr" onClick={() => setOpen(o => !o)}>
        <span class="dot" style="background:#a78bfa"></span>
        🧠 Ask Anchor
        <span class={`chev${open ? ' open' : ''}`}>▼</span>
      </div>
      <div class={open ? '' : 'collapsed'}>
        <div class="chat-msgs" ref={msgsRef}>
          {msgs.map((m, i) => {
            const cls = m.role === 'user' ? 'msg user' : `msg ai${m.engine === 'rooster' ? ' rooster' : m.engine === 'claude' ? ' opus' : ''}`;
            const lbl = m.role === 'ai' && m.engine === 'rooster' ? ' 🐓' : m.role === 'ai' && m.engine === 'claude' ? ' ⚡' : '';
            return <div key={i} class={cls}>{m.text}{lbl}</div>;
          })}
          {loading && <div class="loading">⏳ Reading notes…</div>}
        </div>
        <div class="chat-in">
          <input type="text" value={input} onInput={e => setInput(e.target.value)}
            placeholder="What are my open loops?"
            onKeyDown={e => { if (e.key === 'Enter' && rooster) chat('haiku'); }} />
          <button class="btn btn-primary" onClick={() => chat('haiku')} disabled={!rooster || loading}>Ask</button>
        </div>
        <div class="chat-mr">
          <button onClick={toggleRooster} style={`font-size:.75rem;padding:3px 10px;border-radius:6px;border:none;cursor:pointer;background:${rooster ? '#14532d' : '#374151'};color:${rooster ? '#4ade80' : '#9ca3af'}`}>
            🐓 Rooster: {rooster ? 'ON' : 'OFF'}
          </button>
          <span class="model-lbl">Need Claude's brain?</span>
          <button class="btn-opus" onClick={() => chat('claude')}>Ask Claude ($)</button>
        </div>
        <div style="margin-top:12px">
          <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;color:#475569;font-size:.8rem" onClick={() => setShowHist(h => !h)}>
            <span>📜 Chat History</span><span>{showHist ? '▼' : '▶'}</span>
          </div>
          {showHist && (
            <div style="margin-top:8px;max-height:260px;overflow-y:auto;border-top:1px solid #1e2d45;padding-top:8px">
              {history.length === 0 && <div style="color:#475569;font-size:.8rem">No history yet.</div>}
              {[...history].reverse().map((e, i) => (
                <div key={i} style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #1e2d45">
                  <div style="font-size:.7rem;color:#475569;margin-bottom:2px">{e.ts}</div>
                  <div style="font-size:.82rem;color:#94a3b8;margin-bottom:2px">Q: {e.q}</div>
                  <div style="font-size:.85rem;color:#e2e8f0">{e.a}</div>
                </div>
              ))}
            </div>
          )}
          {showHist && history.length > 0 && (
            <button style="font-size:.72rem;padding:3px 8px;background:#1e2d45;color:#4ade80;border:none;border-radius:4px;cursor:pointer;margin-top:4px"
              onClick={() => { localStorage.removeItem(HIST_KEY); setShowHist(false); }}>
              🗑 Clear History
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

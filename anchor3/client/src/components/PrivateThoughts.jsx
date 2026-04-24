import { useState, useEffect, useCallback } from 'preact/hooks';
import { Card } from './Card';

const PT_KEY = 'pt_token';
const tok = () => sessionStorage.getItem(PT_KEY) || '';
const COLOR = '#a855f7';

export function PrivateThoughts({ onCardClick, visible }) {
  const [phase,  setPhase]  = useState('loading');
  const [notes,  setNotes]  = useState([]);
  const [count,  setCount]  = useState(null);
  const [pw,     setPw]     = useState('');
  const [curPw,  setCurPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [err,    setErr]    = useState('');
  const [open,      setOpen]      = useState(false);

  useEffect(() => {
    if (visible !== undefined) setOpen(!!visible);
  }, [visible]);
  const [aiOn,      setAiOn]      = useState(false);
  const [cfg,       setCfg]       = useState(false);
  const [labelFilter, setLabelFilter] = useState('');

  function autoLock() {
    sessionStorage.removeItem(PT_KEY);
    setNotes([]); setPw(''); setPhase('locked'); setCfg(false); setAiOn(false);
  }

  const fetchCount = useCallback(async () => {
    try {
      const r = await fetch('/api/private/count');
      const d = await r.json();
      if (d.ok) setCount(d.count);
    } catch {}
  }, []);

  const fetchNotes = useCallback(async () => {
    const r = await fetch('/api/private/notes', { headers: { 'x-pt-token': tok() } });
    if (r.status === 401) { autoLock(); return; }
    const d = await r.json();
    if (d.ok) { setNotes(d.notes); setCount(d.notes.length); }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/private/status', { headers: { 'x-pt-token': tok() } });
      const d = await r.json();
      if (!d.hasPassword) { setPhase('setup'); return; }
      if (d.unlocked) { setPhase('unlocked'); setAiOn(d.aiEnabled); fetchNotes(); }
      else setPhase('locked');
    } catch { setPhase('locked'); }
  }, [fetchNotes]);

  useEffect(() => { checkStatus(); fetchCount(); }, [checkStatus, fetchCount]);

  async function doSetup(e) {
    e.preventDefault(); setErr('');
    const r = await fetch('/api/private/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error); return; }
    sessionStorage.setItem(PT_KEY, d.token);
    setPw(''); setPhase('unlocked'); fetchNotes();
  }

  async function doUnlock(e) {
    e.preventDefault(); setErr('');
    const r = await fetch('/api/private/unlock', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error); return; }
    sessionStorage.setItem(PT_KEY, d.token);
    setPw(''); setPhase('unlocked'); fetchNotes();
  }

  async function doLock() {
    await fetch('/api/private/lock', { method: 'POST', headers: { 'x-pt-token': tok() } });
    autoLock();
  }

  async function doAiToggle() {
    const r = await fetch('/api/private/ai-toggle', { method: 'POST', headers: { 'x-pt-token': tok() } });
    if (r.status === 401) { autoLock(); return; }
    const d = await r.json();
    if (d.ok) setAiOn(d.aiEnabled);
  }

  async function doChangePw(e) {
    e.preventDefault(); setErr('');
    const r = await fetch('/api/private/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPw, currentPassword: curPw })
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error); return; }
    sessionStorage.setItem(PT_KEY, d.token);
    setCurPw(''); setNewPw(''); setCfg(false);
  }

  if (phase === 'loading') return null;

  const isLocked = phase === 'locked' || phase === 'setup';

  return (
    <div class="lane" style={`--lane-color:${COLOR}`}>
      <div class="lane-hdr" onClick={() => setOpen(o => !o)}>
        <span class={`lane-arrow${open ? ' open' : ''}`}>▶</span>
        <div class="lane-title-group">
          <span class="lane-name" style={`color:${COLOR}`}>{isLocked ? '🔒' : '🔓'} PRIVATE-THOUGHTS</span>
          <span class="lane-desc">Private notes — password protected</span>
        </div>
        {count != null && <span class="lane-count">({count})</span>}
        {!isLocked && (
          <div style="display:flex;gap:6px;align-items:center;margin-left:auto" onClick={e => e.stopPropagation()}>
            <button class={`pt-ai-toggle${aiOn ? ' on' : ''}`} onClick={doAiToggle}
              title={aiOn ? 'AI can read these — click to disable' : 'AI cannot read these — click to allow'}>
              🤖 {aiOn ? 'AI on' : 'AI off'}
            </button>
            <button class="pt-cfg-btn" onClick={() => { setCfg(c => !c); setErr(''); }} title="Change password">⚙</button>
            <button class="pt-lock-btn" onClick={doLock}>🔒 Lock</button>
          </div>
        )}
      </div>

      {open && (
        <div class="lane-body">
          {isLocked ? (
            <form onSubmit={phase === 'setup' ? doSetup : doUnlock} class="pt-unlock-form">
              {phase === 'setup' && <p class="pt-hint">Create a password to set up your private area.</p>}
              <div style="display:flex;gap:8px">
                <input type="password" value={pw} onInput={e => setPw(e.target.value)}
                  placeholder={phase === 'setup' ? 'Create password (min 4 chars)' : 'Password'}
                  class="pt-pw-input" autoFocus required minLength={phase === 'setup' ? 4 : 1}
                  style="flex:1" />
                <button type="submit" class="pt-btn">{phase === 'setup' ? 'Set Up' : 'Unlock'}</button>
              </div>
              {err && <p class="pt-err">{err}</p>}
            </form>
          ) : (
            <>
              {cfg && (
                <form onSubmit={doChangePw} class="pt-cfg-form">
                  <input type="password" value={curPw} onInput={e => setCurPw(e.target.value)}
                    placeholder="Current password" class="pt-pw-input" required autoFocus />
                  <input type="password" value={newPw} onInput={e => setNewPw(e.target.value)}
                    placeholder="New password (min 4 chars)" class="pt-pw-input" required minLength={4} />
                  <div class="pt-cfg-btns">
                    <button type="submit" class="pt-btn">Update</button>
                    <button type="button" class="pt-btn pt-btn--ghost" onClick={() => { setCfg(false); setErr(''); }}>Cancel</button>
                  </div>
                  {err && <p class="pt-err">{err}</p>}
                </form>
              )}
              <div class="lane-cards">
                {labelFilter && (
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
                    <span style="font-size:.75rem;color:#a855f7">🏷 {labelFilter}</span>
                    <button style="background:none;border:none;color:#475569;cursor:pointer;font-size:.8rem" onClick={() => setLabelFilter('')}>✕ clear</button>
                  </div>
                )}
                {notes.length === 0 && <p class="pt-empty">No entries yet. Add via main input: pt → body → @label</p>}
                {notes
                  .filter(n => !labelFilter || (n.tags || '').toLowerCase().split(',').map(t => t.trim()).includes(labelFilter.toLowerCase()))
                  .map(n => (
                  <Card
                    key={n.id}
                    note={n}
                    onClick={() => onCardClick && onCardClick(n)}
                    onDelete={fetchNotes}
                    onTagClick={tag => setLabelFilter(tag)}
                    laneType="private-thoughts"
                    onCardDrop={() => {}}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

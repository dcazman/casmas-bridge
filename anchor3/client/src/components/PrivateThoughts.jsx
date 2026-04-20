import { useState, useEffect, useCallback } from 'preact/hooks';

const PT_KEY = 'pt_token';
const tok = () => sessionStorage.getItem(PT_KEY) || '';

export function PrivateThoughts() {
  const [phase,  setPhase]  = useState('loading'); // loading | setup | locked | unlocked
  const [notes,  setNotes]  = useState([]);
  const [pw,     setPw]     = useState('');
  const [curPw,  setCurPw]  = useState('');
  const [newPw,  setNewPw]  = useState('');
  const [err,    setErr]    = useState('');
  const [draft,  setDraft]  = useState('');
  const [aiOn,   setAiOn]   = useState(false);
  const [cfg,    setCfg]    = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/private/status', { headers: { 'x-pt-token': tok() } });
      const d = await r.json();
      if (!d.hasPassword) { setPhase('setup'); return; }
      if (d.unlocked) { setPhase('unlocked'); setAiOn(d.aiEnabled); fetchNotes(); }
      else setPhase('locked');
    } catch { setPhase('locked'); }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  async function fetchNotes() {
    const r = await fetch('/api/private/notes', { headers: { 'x-pt-token': tok() } });
    const d = await r.json();
    if (d.ok) setNotes(d.notes);
  }

  async function doSetup(e) {
    e.preventDefault(); setErr('');
    const r = await fetch('/api/private/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    const d = await r.json();
    if (!d.ok) { setErr(d.error); return; }
    sessionStorage.setItem(PT_KEY, d.token);
    setPw(''); setPhase('unlocked'); setNotes([]);
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
    sessionStorage.removeItem(PT_KEY);
    setNotes([]); setPw(''); setPhase('locked'); setCfg(false); setAiOn(false);
  }

  async function doAiToggle() {
    const r = await fetch('/api/private/ai-toggle', { method: 'POST', headers: { 'x-pt-token': tok() } });
    const d = await r.json();
    if (d.ok) setAiOn(d.aiEnabled);
  }

  async function doAdd(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    await fetch('/api/private/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pt-token': tok() },
      body: JSON.stringify({ raw: draft })
    });
    setDraft(''); fetchNotes();
  }

  async function doDelete(id) {
    if (!confirm('Delete this entry?')) return;
    await fetch('/api/private/notes/' + id, { method: 'DELETE', headers: { 'x-pt-token': tok() } });
    fetchNotes();
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

  if (phase === 'setup') return (
    <section class="pt-wrap pt-wrap--locked">
      <div class="pt-lock-row">
        <span class="pt-icon">🔒</span>
        <h2 class="pt-title">Private Thoughts</h2>
      </div>
      <p class="pt-hint">Create a password to set up your private area.</p>
      <form onSubmit={doSetup} class="pt-form">
        <input type="password" value={pw} onInput={e => setPw(e.target.value)}
          placeholder="Create password (min 4 chars)" class="pt-pw-input" autoFocus required minLength={4} />
        <button type="submit" class="pt-btn">Set Up</button>
      </form>
      {err && <p class="pt-err">{err}</p>}
    </section>
  );

  if (phase === 'locked') return (
    <section class="pt-wrap pt-wrap--locked">
      <div class="pt-lock-row">
        <span class="pt-icon">🔒</span>
        <h2 class="pt-title">Private Thoughts</h2>
      </div>
      <form onSubmit={doUnlock} class="pt-form">
        <input type="password" value={pw} onInput={e => setPw(e.target.value)}
          placeholder="Password" class="pt-pw-input" autoFocus required />
        <button type="submit" class="pt-btn">Unlock</button>
      </form>
      {err && <p class="pt-err">{err}</p>}
    </section>
  );

  return (
    <section class="pt-wrap pt-wrap--open">
      <div class="pt-hdr">
        <div class="pt-hdr-left">
          <span class="pt-icon">🔓</span>
          <h2 class="pt-title">Private Thoughts</h2>
          <span class="pt-count">{notes.length}</span>
        </div>
        <div class="pt-hdr-right">
          <button class={`pt-ai-toggle${aiOn ? ' on' : ''}`} onClick={doAiToggle}
            title={aiOn ? 'AI can read these — click to disable' : 'AI cannot read these — click to allow'}>
            🤖 {aiOn ? 'AI on' : 'AI off'}
          </button>
          <button class="pt-cfg-btn" onClick={() => { setCfg(c => !c); setErr(''); }} title="Change password">⚙</button>
          <button class="pt-lock-btn" onClick={doLock}>🔒 Lock</button>
        </div>
      </div>

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

      <form onSubmit={doAdd} class="pt-add">
        <textarea value={draft} onInput={e => setDraft(e.target.value)}
          placeholder="Write anything… (Ctrl+Enter to add)"
          class="pt-textarea" rows="3"
          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) doAdd(e); }} />
        <button type="submit" class="pt-btn">Add</button>
      </form>

      <div class="pt-notes">
        {notes.length === 0 && <p class="pt-empty">No entries yet.</p>}
        {notes.map(n => (
          <div class="pt-note" key={n.id}>
            <div class="pt-note-body">{n.formatted || n.raw_input}</div>
            <div class="pt-note-foot">
              <span class="pt-note-ts">{new Date(n.created_at).toLocaleString()}</span>
              <button class="pt-note-del" onClick={() => doDelete(n.id)} title="Delete">🗑</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

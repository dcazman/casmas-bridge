import { useState, useEffect, useCallback } from 'preact/hooks';

const PT_KEY = 'pt_token';
const tok = () => sessionStorage.getItem(PT_KEY) || '';
const COLOR = '#a855f7';

export function PrivateThoughts() {
  const [phase,    setPhase]    = useState('loading');
  const [notes,    setNotes]    = useState([]);
  const [pw,       setPw]       = useState('');
  const [curPw,    setCurPw]    = useState('');
  const [newPw,    setNewPw]    = useState('');
  const [err,      setErr]      = useState('');
  const [draft,    setDraft]    = useState('');
  const [aiOn,     setAiOn]     = useState(false);
  const [cfg,      setCfg]      = useState(false);
  const [editId,   setEditId]   = useState(null);
  const [editText, setEditText] = useState('');
  const [open,     setOpen]     = useState(false);

  function autoLock() {
    sessionStorage.removeItem(PT_KEY);
    setNotes([]); setPw(''); setPhase('locked'); setCfg(false); setAiOn(false); setEditId(null);
  }

  const fetchNotes = useCallback(async () => {
    const r = await fetch('/api/private/notes', { headers: { 'x-pt-token': tok() } });
    if (r.status === 401) { autoLock(); return; }
    const d = await r.json();
    if (d.ok) setNotes(d.notes);
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

  useEffect(() => { checkStatus(); }, [checkStatus]);

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
    autoLock();
  }

  async function doAiToggle() {
    const r = await fetch('/api/private/ai-toggle', { method: 'POST', headers: { 'x-pt-token': tok() } });
    if (r.status === 401) { autoLock(); return; }
    const d = await r.json();
    if (d.ok) setAiOn(d.aiEnabled);
  }

  async function doAdd(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    const r = await fetch('/api/private/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pt-token': tok() },
      body: JSON.stringify({ raw: draft })
    });
    if (r.status === 401) { autoLock(); return; }
    setDraft(''); fetchNotes();
  }

  async function doDelete(id) {
    if (!confirm('Delete this entry?')) return;
    const r = await fetch('/api/private/notes/' + id, { method: 'DELETE', headers: { 'x-pt-token': tok() } });
    if (r.status === 401) { autoLock(); return; }
    fetchNotes();
  }

  async function doEdit(id) {
    if (!editText.trim()) return;
    const r = await fetch('/api/private/notes/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-pt-token': tok() },
      body: JSON.stringify({ text: editText })
    });
    if (r.status === 401) { autoLock(); return; }
    setEditId(null); setEditText(''); fetchNotes();
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
          <span class="lane-desc">Personal journal — blurred for privacy</span>
        </div>
        {!isLocked && <span class="lane-count">({notes.length})</span>}
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
                    {editId === n.id ? (
                      <div class="pt-edit">
                        <textarea class="pt-textarea" rows="4" value={editText}
                          onInput={e => setEditText(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) doEdit(n.id); }} />
                        <div class="pt-edit-btns">
                          <button class="pt-btn" onClick={() => doEdit(n.id)}>Save</button>
                          <button class="pt-btn pt-btn--ghost" onClick={() => { setEditId(null); setEditText(''); }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div class="pt-note-body">{n.formatted || n.raw_input}</div>
                    )}
                    <div class="pt-note-foot">
                      <span class="pt-note-ts">{new Date(n.created_at).toLocaleString()}</span>
                      <div class="pt-note-actions">
                        <button class="pt-note-btn" onClick={() => { setEditId(n.id); setEditText(n.formatted || n.raw_input || ''); }} title="Edit">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="pt-note-btn pt-note-btn--del" onClick={() => doDelete(n.id)} title="Delete">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

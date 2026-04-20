import { useState, useEffect } from 'preact/hooks';
import { typeColor, fmtDate, TYPE_GROUPS } from '../helpers';

const ALL_TYPES = TYPE_GROUPS.flatMap(g => g.types);

export function Modal({ note, onClose, onMutate }) {
  const [editing,  setEditing]  = useState(false);
  const [editText, setEditText] = useState(note.formatted || note.raw_input || '');
  const [editTags, setEditTags] = useState(note.tags || '');
  const [saving,   setSaving]   = useState(false);
  const [rcStatus, setRcStatus] = useState('');
  const [remindMsg, setRemindMsg] = useState('');

  useEffect(() => {
    setEditText(note.formatted || note.raw_input || '');
    setEditTags(note.tags || '');
    setEditing(false);
    setRcStatus('');
    setRemindMsg('');
  }, [note.id]);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color = typeColor(note.type);

  async function saveEdit() {
    setSaving(true);
    try {
      const r = await fetch(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formatted: editText, tags: editTags }),
      });
      const d = await r.json();
      if (d.ok) {
        const updated = { ...note, formatted: editText, tags: editTags };
        setEditing(false);
        onMutate(updated);
      }
    } catch {}
    setSaving(false);
  }

  async function deleteNote() {
    if (!confirm('Delete this note? Cannot be undone.')) return;
    try {
      await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      onClose();
      onMutate(null);
    } catch {}
  }

  async function reclassify(type) {
    if (!type) return;
    setRcStatus('…');
    try {
      const r = await fetch('/api/reclassify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: note.id, type }) });
      const d = await r.json();
      if (d.ok) { setRcStatus('✓'); onMutate({ ...note, type }); }
      else setRcStatus('✗ ' + (d.error || 'Failed'));
    } catch { setRcStatus('✗'); }
  }

  async function quickRemind(cmd, when) {
    const num = note.remind_num;
    if (num == null) return;
    try {
      const r = await fetch('/api/remind-cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, num, when }) });
      const d = await r.json();
      if (d.ok) { setRemindMsg(cmd === 'done' ? '✓ Done' : '✓ Snoozed'); onMutate(null); setTimeout(() => onClose(), 800); }
      else setRemindMsg('✗ ' + (d.error || 'Failed'));
    } catch { setRemindMsg('✗ Failed'); }
  }

  const text = note.formatted || note.raw_input || '';
  const tags = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const isRemind = note.type === 'remind';

  return (
    <div class="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal">
        <button class="modal-close" onClick={onClose}>✕</button>

        <div class="modal-meta">
          <span class="type-badge" style={`color:${color};border-color:${color}40;background:${color}15`}>{note.type}</span>
          {note.status === 'pending' && <span style="font-size:.7rem;color:#f59e0b;background:#292208;padding:2px 7px;border-radius:20px;border:1px solid #f59e0b30">⏳ unsynced</span>}
          {note.remind_num != null && <span style="font-size:.78rem;color:#fda4af;background:#7c1d3f;padding:2px 8px;border-radius:6px;font-weight:700">#{note.remind_num}</span>}
          {note.remind_at && <span style="font-size:.75rem;color:#f472b6">🔔 {new Date(note.remind_at).toLocaleString()}</span>}
          <span class="modal-date">{fmtDate(note.created_at)}</span>
        </div>

        {!editing ? (
          <div class="modal-text">{text || '(empty)'}</div>
        ) : (
          <textarea
            class="modal-edit-ta"
            value={editText}
            onInput={e => setEditText(e.target.value)}
            rows={Math.max(4, editText.split('\n').length + 1)}
          />
        )}

        {tags.length > 0 && !editing && (
          <div class="modal-tags">
            {tags.map(t => <span key={t} class="tag">{t}</span>)}
          </div>
        )}

        {editing && (
          <div class="modal-tags-in">
            <div style="font-size:.78rem;color:#475569;margin-bottom:4px">Labels (comma-separated)</div>
            <input type="text" value={editTags} onInput={e => setEditTags(e.target.value)} placeholder="e.g. casmas-bridge, code-index" />
          </div>
        )}

        {note.open_loops && (
          <div style="margin-top:10px;font-size:.88rem;color:#fbbf24;background:#292208;padding:8px 12px;border-radius:6px;border-left:3px solid #fbbf24">
            🔁 {note.open_loops}
          </div>
        )}

        {isRemind && note.remind_num != null && (
          <div class="modal-remind">
            <div class="modal-remind-lbl">Reminder #{note.remind_num}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn-done-sm" onClick={() => quickRemind('done')}>✓ done {note.remind_num}</button>
              <button class="btn-snooze-sm" onClick={() => quickRemind('snooze')}>⏱ snooze</button>
              <button class="btn-snooze-sm" onClick={() => {
                const when = prompt(`Snooze #${note.remind_num} until when?\nExamples: friday 3pm, tomorrow, monday 10am, 2 weeks`);
                if (when) quickRemind('snooze', when);
              }}>📅 snooze to…</button>
            </div>
            {remindMsg && <div class="status" style="margin-top:6px">{remindMsg}</div>}
          </div>
        )}

        <div class="modal-actions">
          {!editing ? (
            <button class="btn btn-secondary" onClick={() => setEditing(true)}>✏️ Edit</button>
          ) : (
            <>
              <button class="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              <button class="btn btn-secondary" onClick={() => { setEditing(false); setEditText(note.formatted || note.raw_input || ''); setEditTags(note.tags || ''); }}>Cancel</button>
            </>
          )}
          <button class="btn-icon btn-danger" onClick={deleteNote} title="Delete">🗑 Delete</button>
        </div>

        <div class="modal-rc">
          <select class="rc-sel" onChange={e => { reclassify(e.target.value); e.target.value = ''; }}>
            <option value="">↩ reclassify…</option>
            {TYPE_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.types.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            ))}
          </select>
          {rcStatus && <span class="rc-st">{rcStatus}</span>}
        </div>
      </div>
    </div>
  );
}

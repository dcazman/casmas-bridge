import { useState } from 'preact/hooks';
import { typeColor, fmtDate, relTime, firstLine } from '../helpers';

export function Card({ note, onClick, onDelete, onTagClick, laneType, onCardDrop }) {
  const [expanded,     setExpanded]     = useState(false);
  const [snoozePicking, setSnoozePicking] = useState(false);
  const [snoozeWhen,   setSnoozeWhen]   = useState('');
  const [dragging,     setDragging]     = useState(false);
  const [dragOver,     setDragOver]     = useState(false);

  const color     = typeColor(note.type);
  const fline     = firstLine(note);
  const fullText  = note.formatted || note.raw_input || '';
  const isPending = note.status === 'pending';
  const isRemind  = note.type === 'remind';

  const dateTs   = isRemind && note.remind_at ? note.remind_at : note.created_at;
  const date     = relTime(dateTs);
  const fullDate = fmtDate(dateTs);

  const tags        = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
  const attachments = note.attachments || [];

  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirm('Delete this note?')) return;
    try {
      await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      onDelete();
    } catch {}
  }

  async function handleDone(e) {
    e.stopPropagation();
    if (!confirm(`Mark reminder #${note.remind_num} done and delete it?`)) return;
    await fetch('/api/remind-cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'done', num: note.remind_num }) });
    onDelete();
  }

  async function handleSnooze(e) {
    e.stopPropagation();
    await fetch('/api/remind-cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'snooze', num: note.remind_num }) });
    onDelete();
  }

  async function handleSnoozePick(e) {
    e.preventDefault(); e.stopPropagation();
    const w = snoozeWhen.trim();
    if (!w) return;
    await fetch('/api/remind-cmd', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'snooze', num: note.remind_num, when: w }) });
    setSnoozePicking(false); setSnoozeWhen(''); onDelete();
  }

  // ── Drag handlers ──────────────────────────────────────────────
  function handleDragStart(e) {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: note.id, type: note.type }));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
  }

  function handleDragEnd() {
    setDragging(false);
    setDragOver(false);
  }

  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.id === note.id) return;
      if (data.type === laneType) {
        e.stopPropagation(); // prevent Lane from also handling within-lane drops
        onCardDrop(data.id, data.type, note.id); // insert before this card
      }
      // Cross-lane: don't stop propagation — Lane.onDrop handles it
    } catch {}
  }

  return (
    <div
      class={`card${isPending ? ' pending' : ''}${isRemind ? ' remind' : ''}${expanded ? ' expanded' : ''}${dragging ? ' card-dragging' : ''}${dragOver ? ' card-drag-over' : ''}`}
      style={`border-color:${color}30`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="card-top" onClick={() => setExpanded(v => !v)} title={expanded ? '' : fullText}>
        <div class="card-top-row">
          <div class="drag-handle" onClick={e => e.stopPropagation()} title="Drag to reorder or move to another lane">⠿</div>
          <div class="card-badge" style={`color:${color};border-color:${color}40;background:${color}15`}>
            {note.type}
            {note.remind_num != null && <span style="margin-left:4px">#{note.remind_num}</span>}
          </div>
        </div>
        <div class={`card-text${expanded ? ' full' : ''}`}>{expanded ? fullText : (fline || '(empty)')}</div>
        <div class="card-date" title={fullDate}>{date}</div>
      </div>

      {isRemind && note.remind_at && (
        <div class="remind-due">🔔 {fmtDate(note.remind_at)}</div>
      )}

      {tags.length > 0 && (
        <div class="card-tags">
          {tags.map(t => (
            <span key={t} class="card-tag" onClick={e => { e.stopPropagation(); onTagClick && onTagClick(t); }} title="Filter by label">
              {t}
            </span>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div class="card-attachments">
          {attachments.map(a => (
            <a key={a.id} class={`card-attach${a.mime_type?.startsWith('image/') ? ' is-image' : ''}`}
              href={`/files/${a.filename}`} target="_blank" rel="noopener"
              onClick={e => e.stopPropagation()} title={a.summary || a.original_name}>
              {a.mime_type?.startsWith('image/')
                ? <img src={`/files/${a.filename}`} alt={a.original_name} class="attach-thumb" />
                : <span>📎 {a.original_name}</span>}
            </a>
          ))}
        </div>
      )}

      {isRemind && note.remind_num != null && (
        <div class="remind-actions">
          <button class="btn-done"        onClick={handleDone}>✓ done {note.remind_num}</button>
          <button class="btn-snooze"      onClick={handleSnooze}>⏱ snooze {note.remind_num}</button>
          <button class="btn-snooze-pick" onClick={e => { e.stopPropagation(); setSnoozePicking(v => !v); }}>📅 snooze to…</button>
          {snoozePicking && (
            <form class="snooze-pick-form" onSubmit={handleSnoozePick} onClick={e => e.stopPropagation()}>
              <input type="text" value={snoozeWhen} onInput={e => setSnoozeWhen(e.target.value)}
                placeholder="friday 3pm, tomorrow, jan 15 9am" autoFocus />
              <button type="submit">Set</button>
              <button type="button" onClick={e => { e.stopPropagation(); setSnoozePicking(false); setSnoozeWhen(''); }}>✕</button>
            </form>
          )}
        </div>
      )}

      <div class="card-actions">
        <button class="card-btn-edit" onClick={e => { e.stopPropagation(); onClick(); }} title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="card-btn-del" onClick={handleDelete} title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  );
}

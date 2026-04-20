import { useState } from 'preact/hooks';
import { typeColor, fmtDate, firstLine } from '../helpers';

export function Card({ note, onClick, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const color     = typeColor(note.type);
  const fline     = firstLine(note);
  const fullText  = note.formatted || note.raw_input || '';
  const date      = fmtDate(note.created_at);
  const isPending = note.status === 'pending';
  const isRemind  = note.type === 'remind';
  const tags      = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  async function handleDelete(e) {
    e.stopPropagation();
    if (!confirm('Delete this note?')) return;
    try {
      await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      onDelete();
    } catch {}
  }

  return (
    <div
      class={`card${isPending ? ' pending' : ''}${isRemind ? ' remind' : ''}${expanded ? ' expanded' : ''}`}
      style={`border-color:${color}30`}
    >
      <div class="card-top" onClick={() => setExpanded(v => !v)} title={expanded ? '' : fullText}>
        <div class="card-badge" style={`color:${color};border-color:${color}40;background:${color}15`}>
          {note.type}
          {note.remind_num != null && <span style="margin-left:4px">#{note.remind_num}</span>}
        </div>
        <div class={`card-text${expanded ? ' full' : ''}`}>{expanded ? fullText : (fline || '(empty)')}</div>
        <div class="card-date">{date}</div>
      </div>

      {tags.length > 0 && (
        <div class="card-tags">
          {tags.map(t => <span key={t} class="card-tag">{t}</span>)}
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

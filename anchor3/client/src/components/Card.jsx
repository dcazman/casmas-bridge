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
        <button class="card-btn-edit" onClick={e => { e.stopPropagation(); onClick(); }} title="Edit">✏️</button>
        <button class="card-btn-del" onClick={handleDelete} title="Delete">🗑</button>
      </div>
    </div>
  );
}

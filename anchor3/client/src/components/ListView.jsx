import { useMemo } from 'preact/hooks';
import { typeColor, fmtDate, relTime, TYPE_GROUPS } from '../helpers';

const TYPE_ORDER = TYPE_GROUPS.flatMap(g => g.types);

function remindLabel(ts) {
  if (!ts) return '';
  try {
    const u = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
    const diff = new Date(u).getTime() - Date.now();
    if (diff < 0) return 'overdue';
    const m = Math.floor(diff / 60000);
    if (m < 60) return `in ${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `in ${h}h`;
    const d = Math.floor(h / 24);
    if (d === 1) return 'tomorrow';
    if (d < 7) return `in ${d}d`;
    return fmtDate(ts);
  } catch { return ''; }
}

function NoteRow({ note, onCardClick, onDelete }) {
  const fullText  = note.formatted || note.raw_input || '';
  const lines     = fullText.split('\n').filter(l => l.trim());
  const rawFirst  = lines[0] || '';
  const isTitle   = rawFirst.trimStart().startsWith('#');
  const line1     = isTitle ? rawFirst.trimStart().slice(1).trim() : rawFirst;
  const line2     = lines[isTitle ? 1 : 1] || '';

  const isRemind  = note.type === 'remind';
  const isOverdue = isRemind && note.remind_at && (() => {
    try {
      const u = note.remind_at.includes('T') ? note.remind_at : note.remind_at.replace(' ', 'T') + 'Z';
      return new Date(u).getTime() < Date.now();
    } catch { return false; }
  })();

  const num  = note.remind_num != null ? note.remind_num : note.loop_num != null ? note.loop_num : null;
  const tags = note.tags ? note.tags.split(',').map(t => t.trim()).filter(Boolean) : [];

  return (
    <div
      class={`lv-row${isOverdue ? ' overdue' : ''}`}
      onClick={() => onCardClick(note)}
    >
      <span class="lv-num">{num != null ? `#${num}` : ''}</span>
      <div class="lv-main">
        <div class={`lv-line1${isTitle ? ' is-title' : ''}`}>{line1 || '(empty)'}</div>
        {line2 && <div class="lv-line2">{line2}</div>}
      </div>
      <div class="lv-meta">
        {isRemind && note.remind_at && (
          <span class={`lv-remind${isOverdue ? ' overdue' : ''}`}>
            🔔 {remindLabel(note.remind_at)}
          </span>
        )}
        {tags.slice(0, 2).map(t => <span key={t} class="lv-tag">{t}</span>)}
        <span class="lv-date">{relTime(note.created_at)}</span>
      </div>
      <div class="lv-actions">
        <button class="lv-btn" title="Edit"
          onClick={e => { e.stopPropagation(); onCardClick(note, 'edit'); }}>✏</button>
        <button class="lv-btn" title="Delete"
          onClick={e => { e.stopPropagation(); onDelete(note); }}>🗑</button>
      </div>
    </div>
  );
}

export function ListView({ notes, search, typeFilter, tagFilter, showPT, onCardClick, onDelete }) {
  const filtered = useMemo(() => {
    let r = showPT ? notes : notes.filter(n => n.type !== 'private-thoughts');
    if (search) {
      const q = search.toLowerCase();
      r = r.filter(n => ((n.formatted || n.raw_input || '') + ' ' + (n.tags || '')).toLowerCase().includes(q));
    }
    if (typeFilter) r = r.filter(n => n.type === typeFilter);
    if (tagFilter) {
      const tq = tagFilter.toLowerCase();
      r = r.filter(n => (n.tags || '').toLowerCase().split(',').map(t => t.trim()).includes(tq));
    }
    return r;
  }, [notes, search, typeFilter, tagFilter, showPT]);

  const groups = useMemo(() => {
    const map = {};
    for (const n of filtered) {
      if (!map[n.type]) map[n.type] = [];
      map[n.type].push(n);
    }
    return Object.entries(map)
      .sort(([a], [b]) => {
        const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
      .map(([type, typeNotes]) => ({ type, notes: typeNotes }));
  }, [filtered]);

  async function handleDelete(note) {
    if (!confirm('Delete this note?')) return;
    try {
      await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
      onDelete();
    } catch {}
  }

  if (groups.length === 0) {
    return (
      <div style="color:#334155;font-size:.9rem;padding:40px;text-align:center">
        {filtered.length === 0 ? 'No notes match your search.' : 'No notes yet.'}
      </div>
    );
  }

  return (
    <div class="list-view">
      {groups.map(({ type, notes: groupNotes }) => {
        const color = typeColor(type);
        return (
          <div key={type} class="lv-section">
            <div class="lv-header">
              <span class="lv-type-badge"
                style={`color:${color};border-color:${color}40;background:${color}15`}>
                {type}
              </span>
              <span class="lv-count">{groupNotes.length}</span>
            </div>
            <div class="lv-grid">
              {groupNotes.map(n => (
                <NoteRow
                  key={n.id}
                  note={n}
                  onCardClick={onCardClick}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

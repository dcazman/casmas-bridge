import { useMemo } from 'preact/hooks';
import { Lane }       from './Lane';
import { TYPE_GROUPS } from '../helpers';

const TYPE_ORDER = TYPE_GROUPS.flatMap(g => g.types);

export function Board({ notes, search, setSearch, typeFilter, setTypeFilter, sort, setSort, onCardClick, onDelete }) {
  const filtered = useMemo(() => {
    let result = notes;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(n => {
        const text = ((n.formatted || n.raw_input || '') + ' ' + (n.tags || '')).toLowerCase();
        return text.includes(q);
      });
    }
    if (typeFilter) result = result.filter(n => n.type === typeFilter);
    return result;
  }, [notes, search, typeFilter]);

  const lanes = useMemo(() => {
    const map = {};
    for (const n of filtered) {
      const t = n.type || 'pending';
      if (!map[t]) map[t] = [];
      map[t].push(n);
    }
    return Object.entries(map)
      .sort(([a], [b]) => {
        const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      })
      .map(([type, laneNotes]) => ({ type, notes: laneNotes }));
  }, [filtered]);

  const typeOptions = TYPE_GROUPS.flatMap(g => g.types.filter(t => notes.some(n => n.type === t)));

  return (
    <div>
      <div class="board-controls">
        <input
          type="text"
          placeholder="Search notes…"
          value={search}
          onInput={e => setSearch(e.target.value)}
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All lanes</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        {(search || typeFilter) && (
          <button class="btn btn-secondary" style="padding:6px 14px;font-size:.85rem" onClick={() => { setSearch(''); setTypeFilter(''); }}>
            Clear
          </button>
        )}
      </div>
      {lanes.length === 0 && (
        <div style="color:#334155;font-size:.9rem;padding:40px;text-align:center">
          {notes.length === 0 ? 'No notes yet. Add your first note above.' : 'No notes match your search.'}
        </div>
      )}
      {lanes.map(({ type, notes: laneNotes }) => (
        <Lane key={type} type={type} notes={laneNotes} onCardClick={onCardClick} onDelete={onDelete} />
      ))}
    </div>
  );
}

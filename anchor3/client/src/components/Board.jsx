import { useMemo, useState } from 'preact/hooks';
import { Lane }       from './Lane';
import { TYPE_GROUPS } from '../helpers';

const TYPE_ORDER = TYPE_GROUPS.flatMap(g => g.types);

export function Board({ notes, search, setSearch, typeFilter, setTypeFilter, sort, setSort, onCardClick, onDelete }) {
  const [tagFilter,  setTagFilter]  = useState('');
  const [collapseAll, setCollapseAll] = useState(true);

  function handleTagClick(tag) {
    setTagFilter(tag);
  }

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
    if (tagFilter) {
      const tq = tagFilter.toLowerCase();
      result = result.filter(n => (n.tags || '').toLowerCase().split(',').map(t => t.trim()).includes(tq));
    }
    return result;
  }, [notes, search, typeFilter, tagFilter]);

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
  const hasFilter = !!(search || typeFilter || tagFilter);

  return (
    <div>
      <div class="board-controls">
        <input
          type="text"
          placeholder="Search notes…"
          value={search}
          onInput={e => setSearch(e.target.value)}
        />
        <input
          type="text"
          class="tag-filter-input"
          placeholder="Label…"
          value={tagFilter}
          onInput={e => setTagFilter(e.target.value)}
          title="Filter by label (click a tag badge to fill)"
        />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All lanes</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        {hasFilter && (
          <button class="btn btn-secondary" style="padding:6px 14px;font-size:.85rem" onClick={() => { setSearch(''); setTypeFilter(''); setTagFilter(''); }}>
            Clear
          </button>
        )}
        <button
          class="btn btn-secondary"
          style="padding:6px 14px;font-size:.85rem;margin-left:auto"
          onClick={() => setCollapseAll(v => v === false ? true : false)}
          title={collapseAll === false ? 'Expand all lanes' : 'Collapse all lanes'}
        >
          {collapseAll === false ? '▶ Expand all' : '▼ Collapse all'}
        </button>
      </div>
      {lanes.length === 0 && (
        <div style="color:#334155;font-size:.9rem;padding:40px;text-align:center">
          {notes.length === 0 ? 'No notes yet. Add your first note above.' : 'No notes match your search.'}
        </div>
      )}
      {lanes.map(({ type, notes: laneNotes }) => (
        <Lane
          key={type}
          type={type}
          notes={laneNotes}
          onCardClick={onCardClick}
          onDelete={onDelete}
          onTagClick={handleTagClick}
          forceOpen={collapseAll}
        />
      ))}
    </div>
  );
}

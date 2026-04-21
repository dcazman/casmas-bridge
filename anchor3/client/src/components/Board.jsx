'use strict';
import { useMemo, useState } from 'preact/hooks';
import { Lane }       from './Lane';
import { TYPE_GROUPS } from '../helpers';

const TYPE_ORDER = TYPE_GROUPS.flatMap(g => g.types);

function loadLS(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function Board({ notes, search, setSearch, typeFilter, setTypeFilter, sort, setSort, onCardClick, onDelete }) {
  const [tagFilter,   setTagFilter]   = useState('');
  const [collapseAll, setCollapseAll] = useState(false);
  const [laneOrder,   setLaneOrder]   = useState(() => loadLS('a3-lane-order', []));
  const [cardOrders,  setCardOrders]  = useState(() => loadLS('a3-card-orders', {}));

  function handleTagClick(tag) { setTagFilter(tag); }

  const filtered = useMemo(() => {
    let result = notes;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(n => ((n.formatted || n.raw_input || '') + ' ' + (n.tags || '')).toLowerCase().includes(q));
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
        if (ai === -1) return 1; if (bi === -1) return -1;
        return ai - bi;
      })
      .map(([type, laneNotes]) => ({ type, notes: laneNotes }));
  }, [filtered]);

  const sortedLanes = useMemo(() => {
    if (!laneOrder.length) return lanes;
    const visible = new Set(lanes.map(l => l.type));
    const ordered = [
      ...laneOrder.filter(t => visible.has(t)),
      ...lanes.map(l => l.type).filter(t => !laneOrder.includes(t)),
    ];
    return ordered.map(t => lanes.find(l => l.type === t)).filter(Boolean);
  }, [lanes, laneOrder]);

  function getOrderedNotes(laneType, laneNotes) {
    const order = cardOrders[laneType];
    if (!order || !order.length) return laneNotes;
    const byId = Object.fromEntries(laneNotes.map(n => [n.id, n]));
    const stored = order.filter(id => byId[id]).map(id => byId[id]);
    const storedSet = new Set(order);
    const newOnes = laneNotes.filter(n => !storedSet.has(n.id));
    return [...stored, ...newOnes];
  }

  function moveLane(type, dir) {
    const types = sortedLanes.map(l => l.type);
    const i = types.indexOf(type);
    const ni = i + dir;
    if (ni < 0 || ni >= types.length) return;
    [types[i], types[ni]] = [types[ni], types[i]];
    setLaneOrder(types);
    localStorage.setItem('a3-lane-order', JSON.stringify(types));
  }

  function handleCardDrop(dragId, fromType, toType, beforeId) {
    if (fromType === toType) {
      setCardOrders(prev => {
        const laneNotes = lanes.find(l => l.type === toType)?.notes || [];
        const order = getOrderedNotes(toType, laneNotes).map(n => n.id);
        const filtered2 = order.filter(id => id !== dragId);
        const idx = beforeId != null ? filtered2.indexOf(beforeId) : -1;
        if (idx === -1) filtered2.push(dragId); else filtered2.splice(idx, 0, dragId);
        const next = { ...prev, [toType]: filtered2 };
        localStorage.setItem('a3-card-orders', JSON.stringify(next));
        return next;
      });
    } else {
      fetch('/api/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: dragId, type: toType }),
      }).then(() => onDelete());
    }
  }

  const typeOptions = TYPE_GROUPS.flatMap(g => g.types.filter(t => notes.some(n => n.type === t)));
  const hasFilter = !!(search || typeFilter || tagFilter);

  return (
    <div>
      <div class="board-controls">
        <input type="text" placeholder="Search notes…" value={search} onInput={e => setSearch(e.target.value)} />
        <input type="text" class="tag-filter-input" placeholder="Label…" value={tagFilter}
          onInput={e => setTagFilter(e.target.value)} title="Filter by label (click a tag badge to fill)" />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All lanes</option>
          {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
        {hasFilter && (
          <button class="btn btn-secondary" style="padding:6px 14px;font-size:.85rem"
            onClick={() => { setSearch(''); setTypeFilter(''); setTagFilter(''); }}>Clear</button>
        )}
        <button class="btn btn-secondary" style="padding:6px 14px;font-size:.85rem;margin-left:auto"
          onClick={() => setCollapseAll(v => v === false ? true : false)}
          title={collapseAll === false ? 'Expand all lanes' : 'Collapse all lanes'}>
          {collapseAll === false ? '▶ Expand all' : '▼ Collapse all'}
        </button>
      </div>
      {sortedLanes.length === 0 && (
        <div style="color:#334155;font-size:.9rem;padding:40px;text-align:center">
          {notes.length === 0 ? 'No notes yet. Add your first note above.' : 'No notes match your search.'}
        </div>
      )}
      {sortedLanes.map(({ type, notes: laneNotes }, idx) => (
        <Lane
          key={type}
          type={type}
          notes={getOrderedNotes(type, laneNotes)}
          onCardClick={onCardClick}
          onDelete={onDelete}
          onTagClick={handleTagClick}
          forceOpen={collapseAll}
          isFirst={idx === 0}
          isLast={idx === sortedLanes.length - 1}
          onMoveUp={() => moveLane(type, -1)}
          onMoveDown={() => moveLane(type, 1)}
          onCardDrop={(dragId, fromType, beforeId) => handleCardDrop(dragId, fromType, type, beforeId)}
        />
      ))}
    </div>
  );
}

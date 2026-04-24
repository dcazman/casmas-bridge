import { useState, useEffect } from 'preact/hooks';
import { Card }    from './Card';
import { typeColor, isLocal, LANE_DESCRIPTIONS } from '../helpers';

export function Lane({ type, notes, onCardClick, onDelete, onTagClick, forceOpen,
                       isFirst, isLast, onMoveUp, onMoveDown, onCardDrop }) {
  const [open,     setOpen]     = useState(isLocal);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (forceOpen !== undefined) setOpen(forceOpen);
  }, [forceOpen]);

  const color = typeColor(type);

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
      // Card.onDrop stops propagation for within-lane drops, so anything
      // reaching here is either cross-lane or a within-lane drop on empty space.
      onCardDrop(data.id, data.type, null);
    } catch {}
  }

  return (
    <div
      class={`lane${dragOver ? ' lane-drop-target' : ''}`}
      style={`--lane-color:${color}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div class="lane-hdr" onClick={() => setOpen(o => !o)}>
        <span class={`lane-arrow${open ? ' open' : ''}`}>▶</span>
        <div class="lane-title-group">
          <span class="lane-name" style={`color:${color}`}>{type.toUpperCase()}</span>
          {LANE_DESCRIPTIONS[type] && <span class="lane-desc">{LANE_DESCRIPTIONS[type]}</span>}
        </div>
        <span class="lane-count">({notes.length})</span>
        <div class="lane-move-btns" onClick={e => e.stopPropagation()}>
          <button class="lane-move-btn" onClick={onMoveUp}   disabled={isFirst} title="Move lane up">▲</button>
          <button class="lane-move-btn" onClick={onMoveDown} disabled={isLast}  title="Move lane down">▼</button>
        </div>
      </div>
      {open && (
        <div class="lane-body">
          <div class="lane-cards">
            {notes.map(n => (
              <Card
                key={n.id}
                note={n}
                onClick={mode => onCardClick(n, mode)}
                onDelete={onDelete}
                onTagClick={onTagClick}
                laneType={type}
                onCardDrop={onCardDrop}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

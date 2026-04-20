import { useState } from 'preact/hooks';
import { Card }    from './Card';
import { typeColor, isLocal } from '../helpers';

export function Lane({ type, notes, onCardClick, onDelete }) {
  const [open, setOpen] = useState(isLocal);

  const color = typeColor(type);

  return (
    <div class="lane" style={`--lane-color:${color}`}>
      <div class="lane-hdr" onClick={() => setOpen(o => !o)}>
        <span class={`lane-arrow${open ? ' open' : ''}`}>▶</span>
        <span class="lane-name" style={`color:${color}`}>{type.toUpperCase()}</span>
        <span class="lane-count">({notes.length})</span>
      </div>
      {open && (
        <div class="lane-body">
          <div class="lane-cards">
            {notes.map(n => <Card key={n.id} note={n} onClick={() => onCardClick(n)} onDelete={onDelete} />)}
          </div>
        </div>
      )}
    </div>
  );
}

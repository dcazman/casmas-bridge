import { useState, useRef } from 'preact/hooks';
import { typeColor, fmtDate, relTime } from '../helpers';

export function Card({ note, onClick, onDelete, onTagClick, laneType, onCardDrop }) {
  const [expanded,      setExpanded]      = useState(false);
  const [snoozePicking, setSnoozePicking] = useState(false);
  const [snoozeWhen,    setSnoozeWhen]    = useState('');
  const [dragging,      setDragging]      = useState(false);
  const [dragOver,      setDragOver]      = useState(false);
  const [cbText,        setCbText]        = useState(null);
  const [viewing,       setViewing]       = useState(false);
  const [hoverPreview,  setHoverPreview]  = useState(null);
  const hoverTimer = useRef(null);

  const color     = typeColor(note.type);
  const fullText  = cbText ?? (note.formatted || note.raw_input || '');
  const isPending = note.status === 'pending';
  const isRemind  = note.type === 'remind';
  const hasChecks = /^\s*\[[ x]\]/im.test(fullText);

  const isOverdue     = isRemind && note.remind_at && (new Date(note.remind_at).getTime() < Date.now());

  const rawFirstLine  = fullText.split('\n').find(l => l.trim()) || '';
  const isTitle       = rawFirstLine.trimStart().startsWith('#');
  const titleText     = isTitle ? rawFirstLine.trimStart().slice(1).trim() : null;
  const collapsedText = isTitle
    ? titleText || '(empty)'
    : hasChecks
    ? rawFirstLine.replace(/^\s*\[[ x]\]\s*/i, '') || '(empty)'
    : (rawFirstLine || '(empty)');

  const checkDone  = hasChecks ? (fullText.match(/^\s*\[x\]/gim) || []).length : 0;
  const checkTotal = hasChecks ? (fullText.match(/^\s*\[[ x]\]/gim) || []).length : 0;

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

  async function toggleCheckbox(lineIdx, e) {
    e.stopPropagation();
    const lines = fullText.split('\n');
    const line  = lines[lineIdx];
    if (/^\s*\[ \]/.test(line)) {
      lines[lineIdx] = line.replace('[ ]', '[x]');
    } else if (/^\s*\[x\]/i.test(line)) {
      lines[lineIdx] = line.replace(/\[x\]/i, '[ ]');
    } else return;
    const updated = lines.join('\n');
    setCbText(updated);
    try {
      await fetch(`/api/notes/${note.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formatted: updated })
      });
    } catch {}
  }

  function handleMouseEnter(e) {
    clearTimeout(hoverTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    hoverTimer.current = setTimeout(() => {
      const showRight = rect.right + 288 < window.innerWidth;
      const top = Math.min(rect.top, window.innerHeight - 340);
      const left = showRight ? rect.right + 8 : rect.left - 288;
      setHoverPreview({ top, left });
    }, 280);
  }

  function handleMouseLeave() {
    clearTimeout(hoverTimer.current);
    setHoverPreview(null);
  }

  function renderHoverPreview() {
    if (!hoverPreview) return null;
    return (
      <div
        class="card-preview"
        style={`position:fixed;top:${hoverPreview.top}px;left:${hoverPreview.left}px`}
        onMouseEnter={() => clearTimeout(hoverTimer.current)}
        onMouseLeave={() => setHoverPreview(null)}
      >
        <div class="cp-header">
          <span class="cp-badge" style={`color:${color};border-color:${color}40;background:${color}15`}>
            {note.type}
            {note.remind_num != null && <span style="margin-left:4px">#{note.remind_num}</span>}
            {note.loop_num != null && <span style="margin-left:4px">#{note.loop_num}</span>}
          </span>
          <span class="cp-meta-date">{fullDate}</span>
        </div>
        {isRemind && (
          <div class="cp-remind-due">🔔 {fmtDate(note.remind_at || note.created_at)}</div>
        )}
        {hasChecks ? (
          <div class="cp-body">
            <div class="cp-progress">{checkDone}/{checkTotal} done</div>
            {fullText.split('\n').map((line, i) => {
              const unc = /^\s*\[ \]/.test(line);
              const chk = /^\s*\[x\]/i.test(line);
              if (unc || chk) {
                const label = line.replace(/^\s*\[[ x]\]\s*/i, '');
                return (
                  <div key={i} class="cp-cb-line">
                    <span class={chk ? 'cp-chk' : 'cp-unc'}>{chk ? '☑' : '☐'}</span>
                    <span class={chk ? 'cp-cb-lbl done' : 'cp-cb-lbl'}>{label}</span>
                  </div>
                );
              }
              return line.trim() ? <div key={i} class="cp-other">{line}</div> : null;
            })}
          </div>
        ) : (
          <div class="cp-body cp-text-body">
            {fullText.length > 480 ? fullText.slice(0, 480) + '…' : fullText}
          </div>
        )}
        {tags.length > 0 && (
          <div class="cp-tags">
            {tags.map(t => <span key={t} class="cp-tag">{t}</span>)}
          </div>
        )}
        {note.loop_num != null && (
          <div class="cp-age">Open {relTime(note.created_at)}</div>
        )}
      </div>
    );
  }

  function renderBody() {
    if (!expanded) {
      if (isTitle) {
        return <div class="card-text" style="font-weight:700;font-size:.95rem">{collapsedText}</div>;
      }
      if (hasChecks) {
        const lines = fullText.split('\n');
        const idx   = lines.findIndex(l => /^\s*\[[ x]\]/i.test(l));
        if (idx !== -1) {
          const checked = /^\s*\[x\]/i.test(lines[idx]);
          const label   = lines[idx].replace(/^\s*\[[ x]\]\s*/i, '');
          return (
            <div class="cb-line" onClick={e => toggleCheckbox(idx, e)}>
              <span class={`cb-box${checked ? ' checked' : ''}`}>{checked ? '☑' : '☐'}</span>
              <span class={`cb-label${checked ? ' done' : ''}`}>{label}</span>
            </div>
          );
        }
      }
      return <div class="card-text">{collapsedText}</div>;
    }
    if (!hasChecks) {
      return <div class="card-text full">{fullText}</div>;
    }
    return (
      <div class="card-text full">
        {isTitle && <div style="font-weight:700;font-size:.95rem;margin-bottom:6px">{titleText}</div>}
        <div class="cb-progress">{checkDone}/{checkTotal} done</div>
        {fullText.split('\n').map((line, i) => {
          if (i === 0 && isTitle) return null;
          const unchecked = /^\s*\[ \]/.test(line);
          const checked   = /^\s*\[x\]/i.test(line);
          if (unchecked || checked) {
            const label = line.replace(/^\s*\[[ x]\]\s*/i, '');
            return (
              <div key={i} class="cb-line" onClick={e => toggleCheckbox(i, e)}>
                <span class={`cb-box${checked ? ' checked' : ''}`}>{checked ? '☑' : '☐'}</span>
                <span class={`cb-label${checked ? ' done' : ''}`}>{label}</span>
              </div>
            );
          }
          return line.trim() ? <div key={i} class="cb-text">{line}</div> : null;
        })}
      </div>
    );
  }

  // ── Drag handlers ──────────────────────────────────────────────
  function handleDragStart(e) {
    e.dataTransfer.setData('application/json', JSON.stringify({ id: note.id, type: note.type }));
    e.dataTransfer.effectAllowed = 'move';
    setDragging(true);
    clearTimeout(hoverTimer.current);
    setHoverPreview(null);
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
        e.stopPropagation();
        onCardDrop(data.id, data.type, note.id);
      }
    } catch {}
  }

  return (
    <>
    <div
      class={`card${isPending ? ' pending' : ''}${isRemind ? ' remind' : ''}${isOverdue ? ' overdue' : ''}${expanded ? ' expanded' : ''}${dragging ? ' card-dragging' : ''}${dragOver ? ' card-drag-over' : ''}`}
      style={`border-color:${color}30`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div class="card-top" onClick={() => setExpanded(v => !v)}>
        <div class="card-top-row">
          <div class="drag-handle" onClick={e => e.stopPropagation()} title="Drag to reorder or move to another lane">⠿</div>
          <div class="card-badge" style={`color:${color};border-color:${color}40;background:${color}15`}>
            {note.type}
            {note.remind_num != null && <span style="margin-left:4px">#{note.remind_num}</span>}
            {note.loop_num != null && <span style="margin-left:4px">#{note.loop_num}</span>}
          </div>
          {hasChecks && !expanded && (
            <span class="cb-badge">{checkDone}/{checkTotal}</span>
          )}
        </div>
        {renderBody()}
        <div class="card-date" title={fullDate}>{date}</div>
      </div>

      {isRemind && (
        <div class="remind-due">🔔 {fmtDate(note.remind_at || note.created_at)}</div>
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
        <button class="card-btn-view" onClick={e => { e.stopPropagation(); setViewing(true); }} title="View">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
        <button class="card-btn-edit" onClick={e => { e.stopPropagation(); onClick('edit'); }} title="Edit">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="card-btn-del" onClick={handleDelete} title="Delete">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
    {viewing && (
      <div class="modal-backdrop" onClick={e => { e.stopPropagation(); setViewing(false); }}>
        <div class="modal" onClick={e => e.stopPropagation()}>
          <button class="modal-close" onClick={() => setViewing(false)}>✕</button>
          <div class="modal-meta">
            <span class="type-badge" style={`color:${color};border-color:${color}40;background:${color}15`}>
              {note.type}{note.remind_num != null && <span style="margin-left:4px">#{note.remind_num}</span>}
            </span>
            <span class="modal-date">{fullDate}</span>
          </div>
          {isRemind && (
            <div class="remind-due" style="margin-bottom:10px">🔔 {fmtDate(note.remind_at || note.created_at)}</div>
          )}
          {!hasChecks
            ? <div class="modal-text">{fullText}</div>
            : (
              <div class="modal-text" style="padding:12px">
                <div class="cb-progress" style="margin-bottom:8px">{checkDone}/{checkTotal} done</div>
                {fullText.split('\n').map((line, i) => {
                  const unchecked = /^\s*\[ \]/.test(line);
                  const checked   = /^\s*\[x\]/i.test(line);
                  if (unchecked || checked) {
                    const label = line.replace(/^\s*\[[ x]\]\s*/i, '');
                    return (
                      <div key={i} class="cb-line" onClick={e => toggleCheckbox(i, e)}>
                        <span class={`cb-box${checked ? ' checked' : ''}`}>{checked ? '☑' : '☐'}</span>
                        <span class={`cb-label${checked ? ' done' : ''}`}>{label}</span>
                      </div>
                    );
                  }
                  return line.trim() ? <div key={i} class="cb-text">{line}</div> : null;
                })}
              </div>
            )
          }
          {tags.length > 0 && (
            <div class="modal-tags" style="margin-top:10px">
              {tags.map(t => <span key={t} class="tag">{t}</span>)}
            </div>
          )}
          {attachments.length > 0 && (
            <div class="card-attachments" style="margin-top:12px">
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
          <div class="modal-actions">
            <button class="btn btn-primary" onClick={e => { e.stopPropagation(); setViewing(false); onClick(); }}>✏ Edit</button>
            <button class="btn btn-secondary" onClick={() => setViewing(false)}>Close</button>
          </div>
        </div>
      </div>
    )}
    {renderHoverPreview()}
    </>
  );
}

import { useState, useEffect, useCallback } from 'preact/hooks';
import { Header }    from './components/Header';
import { AddNote }   from './components/AddNote';
import { SyncQueue } from './components/SyncQueue';
import { AskAnchor } from './components/AskAnchor';
import { Commands }  from './components/Commands';
import { Weather }   from './components/Weather';
import { Board }            from './components/Board';
import { Modal }            from './components/Modal';
import { PrivateThoughts }  from './components/PrivateThoughts';

export function App() {
  const [notes,      setNotes]      = useState([]);
  const [status,     setStatus]     = useState({ pending: 0, lastSync: null, autoSync: false, engine: 'rooster' });
  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sort,       setSort]       = useState('newest');
  const [modal,      setModal]      = useState(null);
  const [loading,    setLoading]    = useState(true);

  const loadAll = useCallback(async () => {
    try {
      const [nr, sr] = await Promise.all([
        fetch(`/api/notes?sort=${sort}`).then(r => r.json()),
        fetch('/api/status').then(r => r.json()),
      ]);
      if (nr.ok) setNotes(nr.notes);
      if (sr.ok) setStatus(sr);
    } catch (e) { console.error('loadAll failed:', e); }
    setLoading(false);
  }, [sort]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refreshModal = useCallback((updatedNote) => {
    if (updatedNote) setModal(updatedNote);
    loadAll();
  }, [loadAll]);

  const closeModal = useCallback(() => setModal(null), []);

  if (loading) return (
    <div style="display:flex;align-items:center;justify-content:center;height:60vh;color:#475569;font-size:1rem">
      Loading Anchor 3…
    </div>
  );

  return (
    <div>
      <Header engine={status.engine} />
      <div class="main">
        <div class="panels">
          <AddNote onAdd={loadAll} />
          <Weather />
          <SyncQueue status={status} onSync={loadAll} />
          <div class="panel-stack">
            <AskAnchor />
            <Commands />
          </div>
        </div>
        <Board
          notes={notes}
          search={search}
          setSearch={setSearch}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          sort={sort}
          setSort={setSort}
          onCardClick={setModal}
          onDelete={loadAll}
        />
        <PrivateThoughts />
      </div>
      {modal && <Modal note={modal} onClose={closeModal} onMutate={refreshModal} />}
    </div>
  );
}

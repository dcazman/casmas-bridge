import { useState } from 'preact/hooks';
import { isLocal } from '../helpers';

export function SyncQueue({ status, onSync }) {
  const [open,    setOpen]    = useState(isLocal);
  const [syncing, setSyncing] = useState(false);
  const [msg,     setMsg]     = useState('');

  const { pending = 0, lastSync, autoSync } = status;
  const lastSyncStr = lastSync ? new Date(lastSync).toLocaleString() : 'Never';

  async function runSync() {
    setSyncing(true); setMsg('');
    try {
      const r = await fetch('/api/sync', { method: 'POST' });
      const d = await r.json();
      if (d.ok) {
        let m = `✓ Synced ${d.processed} notes`;
        if (d.splits  > 0) m += `, split ${d.splits}`;
        if (d.flagged > 0) m += `, ${d.flagged} flagged`;
        if (d.engine)      m += ` (${d.engine})`;
        setMsg(m);
        onSync();
      } else { setMsg('✗ ' + (d.error || 'Sync failed')); }
    } catch { setMsg('✗ Sync failed'); }
    setSyncing(false);
  }

  async function runRebuild() {
    if (!confirm('Full Docker rebuild — service will be down ~1-2 min. Continue?')) return;
    setMsg('⏳ Rebuilding…');
    try {
      const r = await fetch('/api/rebuild', { method: 'POST' });
      const d = await r.json();
      setMsg(d.ok ? '✓ Rebuild done — reloading in 5s…' : '✗ ' + (d.error || 'Rebuild failed'));
      if (d.ok) setTimeout(() => location.reload(), 5000);
    } catch { setMsg('✗ Request failed (reload manually)'); }
  }

  async function sendDigest() {
    setMsg('⏳ Sending digest…');
    try {
      const r = await fetch('/api/alert', { method: 'POST' });
      const d = await r.json();
      setMsg(d.ok ? '✓ Digest sent' : '✗ ' + (d.error || 'Failed'));
    } catch { setMsg('✗ Failed'); }
  }

  return (
    <div class="panel">
      <div class="panel-hdr" onClick={() => setOpen(o => !o)}>
        <span class="dot" style="background:#f59e0b"></span>
        ⚡ Sync Queue
        <span class={`chev${open ? ' open' : ''}`}>▼</span>
      </div>
      <div class={open ? '' : 'collapsed'}>
        <div class="sync-bar">
          <span class="sync-ct"><strong>{pending}</strong> pending</span>
          {autoSync && <span class="sync-auto">⚡ auto-sync recommended</span>}
          <span class="sync-last">Last: {lastSyncStr}</span>
          <button class="btn-sync" onClick={runSync} disabled={syncing || pending === 0}>
            {syncing ? '⏳ Syncing…' : 'Sync Now'}
          </button>
        </div>
        <div class="sync-actions">
          <button class="btn-rebuild" onClick={runRebuild}>🔨 Rebuild</button>
          <button class="btn-rebuild" style="background:#1e2d45;color:#fb923c;border-color:#fb923c40" onClick={sendDigest}>📋 Digest</button>
        </div>
        {msg && <div class={`status${msg.startsWith('✗') ? ' err' : ''}`} style="margin-top:8px">{msg}</div>}
      </div>
    </div>
  );
}

import { useState, useEffect } from 'preact/hooks';
import { isLocal } from '../helpers';

export function Weather() {
  const [open,    setOpen]    = useState(isLocal);
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/weather');
      const d = await r.json();
      if (d.ok) { setData(d); }
      else if (d.error === 'no_token') { setError('no_token'); }
      else { setError('unavailable'); }
    } catch { setError('unavailable'); }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  // auto-refresh every 10 minutes
  useEffect(() => {
    const t = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // Don't render at all if no token configured
  if (error === 'no_token') return null;

  const d = data;
  const feels = d && d.feelsF != null && d.feelsF !== d.tempF;
  const cond  = d && (d.forecastConditions || d.conditions);

  return (
    <div class="panel">
      <div class="panel-hdr" onClick={() => setOpen(o => !o)}>
        <span class="dot" style="background:#38bdf8"></span>
        🌤 Casmas Weather
        <button class="wx-refresh" onClick={e => { e.stopPropagation(); load(); }} title="Refresh">↻</button>
        <span class={`chev${open ? ' open' : ''}`}>▼</span>
      </div>
      <div class={open ? '' : 'collapsed'}>
        {loading && !d && <div class="wx-loading">Loading…</div>}
        {error === 'unavailable' && <div class="wx-error">Could not load weather</div>}
        {d && (
          <div class="wx-panel">
            <div class="wx-main">
              <div>
                <div class="wx-temp">{d.tempF != null ? d.tempF + '°' : '—'}</div>
                {feels && <div class="wx-feels">feels {d.feelsF}°F</div>}
              </div>
              {cond && <div style="font-size:.85rem;color:#94a3b8;margin-left:auto;text-align:right">{cond}</div>}
            </div>

            {d.forecast && d.forecast.length > 0 && (
              <div class="wx-fc">
                {d.forecast.map(f => {
                  const rc = f.precipChance > 60 ? '#f87171' : f.precipChance > 30 ? '#fbbf24' : '#60a5fa';
                  return (
                    <div key={f.dayName} class="wx-fday">
                      <span class="wx-fday-name">{f.dayName}</span>
                      <span class="wx-fday-icon">{f.emoji || ''}</span>
                      <span class="wx-fday-hl">{f.highF != null ? f.highF + '°' : '—'} / {f.lowF != null ? f.lowF + '°' : '—'}</span>
                      <span class="wx-fday-cond">{f.conditions || ''}</span>
                      <span class="wx-fday-rain" style={`color:${rc}`}>{f.precipChance}% rain</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div class="wx-time">Updated {d.time} · Casmas station</div>
          </div>
        )}
      </div>
    </div>
  );
}

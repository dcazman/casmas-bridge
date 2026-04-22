import { useState, useEffect } from 'preact/hooks';

export function Header({ engine }) {
  const [time,    setTime]    = useState('');
  const [weather, setWeather] = useState('');

  useEffect(() => {
    const fmt = () => new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    setTime(fmt());
    const t = setInterval(() => setTime(fmt()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    async function fetchWeather() {
      try {
        const r = await fetch('/api/weather');
        const d = await r.json();
        if (d.weather) setWeather(d.weather);
      } catch {}
    }
    fetchWeather();
    const t = setInterval(fetchWeather, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const engineLabel = engine === 'rooster' ? '🐓 Rooster' : '🤖 Anthropic API';

  return (
    <header class="hdr">
      <img src="/anchor-logo.png" alt="Anchor" class="hdr-logo" />
      <div class="hdr-text">
        <h1>Anchor <span class="hdr-ver">3</span></h1>
        <p>Dan's memory, context, and second brain</p>
      </div>
      <div class="hdr-right">
        <div class="hdr-time-block">
          <div class="hdr-time">{time}</div>
          {weather && <div class="hdr-weather">{weather}</div>}
        </div>
        <div class="engine-lbl">{engineLabel}</div>
      </div>
    </header>
  );
}

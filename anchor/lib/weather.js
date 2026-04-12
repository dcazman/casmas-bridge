'use strict';
/**
 * weather.js — Tempest weather integration for Anchor
 * Station: 192111 (Casmas weather, Lincolnton NC)
 *
 * Token stored in secrets table under key 'tempest_token' (encrypted).
 * All functions safe to call without a token — return null silently.
 *
 * Uses better_forecast endpoint which returns current_conditions + forecast.
 * Units requested in imperial directly — no manual conversion needed.
 * Observation endpoint kept as fallback reference only.
 */

const { db } = require('./db');
const { encrypt, decrypt } = require('./crypto');

const STATION_ID  = '192111';
const API_BASE    = 'https://swd.weatherflow.com/swd/rest';
const TIMEOUT_MS  = 6000;

// Unit params — request imperial directly from forecast API
const UNIT_PARAMS = 'units_temp=f&units_wind=mph&units_pressure=mb&units_precip=in&units_distance=mi';

// ── Token helpers ─────────────────────────────────────────────────────────────

function getTempestToken() {
  try {
    const r = db.prepare("SELECT value FROM secrets WHERE key='tempest_token'").get();
    return r ? decrypt(r.value) : null;
  } catch { return null; }
}

function setTempestToken(token) {
  db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('tempest_token',?)").run(encrypt(token));
}

// ── Fetch with timeout ────────────────────────────────────────────────────────

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

// ── Forecast fetcher ──────────────────────────────────────────────────────────

async function fetchForecast(token) {
  const url = `${API_BASE}/better_forecast?station_id=${STATION_ID}&${UNIT_PARAMS}&token=${token}`;
  const resp = await fetchWithTimeout(url, TIMEOUT_MS);
  if (!resp.ok) throw new Error(`Tempest forecast API HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.current_conditions) throw new Error('No current_conditions in forecast response');
  return data;
}

// ── Wind direction helper ─────────────────────────────────────────────────────

function windDir(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Structured data for UI panel ──────────────────────────────────────────────

async function getTempestRaw(token) {
  const data = await fetchForecast(token);
  const cc   = data.current_conditions;
  const tz   = { timeZone: 'America/New_York' };

  // Today's daily forecast (first entry)
  const today = data.forecast?.daily?.[0] || {};

  // Today's hourly — find remaining hours for max precip chance
  const nowEpoch = Math.floor(Date.now() / 1000);
  const hourly   = (data.forecast?.hourly || []).filter(h => h.time >= nowEpoch);
  const maxPrecipChance = hourly.length
    ? Math.max(...hourly.slice(0, 12).map(h => h.precip_probability || 0))
    : (today.precip_probability || 0);

  const time = cc.time
    ? new Date(cc.time * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz })
    : 'just now';

  return {
    time,
    // Current conditions (already in °F / mph from unit params)
    tempF:       cc.air_temperature       != null ? Math.round(cc.air_temperature)   : null,
    feelsF:      cc.feels_like            != null ? Math.round(cc.feels_like)         : null,
    humidity:    cc.relative_humidity     != null ? Math.round(cc.relative_humidity)  : null,
    windMph:     cc.wind_avg              != null ? Math.round(cc.wind_avg)           : null,
    gustMph:     cc.wind_gust            != null && cc.wind_gust > 0 ? Math.round(cc.wind_gust) : null,
    windDir:     windDir(cc.wind_direction),
    pressureMb:  cc.sea_level_pressure    != null ? cc.sea_level_pressure.toFixed(1)  : null,
    uv:          cc.uv                    != null ? cc.uv.toFixed(1)                  : null,
    rainToday:   cc.precip_accum_local_day != null && cc.precip_accum_local_day > 0
                 ? cc.precip_accum_local_day.toFixed(2) : null,
    lightning:   cc.lightning_strike_count_last_1hr != null && cc.lightning_strike_count_last_1hr > 0
                 ? cc.lightning_strike_count_last_1hr : null,
    conditions:  cc.conditions || null,
    // Today's forecast
    highF:       today.air_temp_high      != null ? Math.round(today.air_temp_high)   : null,
    lowF:        today.air_temp_low       != null ? Math.round(today.air_temp_low)    : null,
    precipChance: maxPrecipChance,
    precipType:  today.precip_type        || null,
    forecastConditions: today.conditions  || null,
  };
}

// ── Plain text block for digest email ────────────────────────────────────────

async function getTempestBlock() {
  try {
    const token = getTempestToken();
    if (!token) {
      console.log('[weather] no tempest_token in secrets — skipping');
      return null;
    }
    const d = await getTempestRaw(token);
    const tz = { timeZone: 'America/New_York' };

    const feels   = d.feelsF != null && d.feelsF !== d.tempF ? ` (feels ${d.feelsF}°F)` : '';
    const gust    = d.gustMph ? ` gusting ${d.gustMph} mph` : '';
    const rain    = d.rainToday ? `  🌧 ${d.rainToday}" today` : '';
    const hiLo    = (d.highF != null && d.lowF != null) ? `H:${d.highF}° L:${d.lowF}°` : '';
    const precip  = d.precipChance > 0 ? `🌧 ${d.precipChance}% chance of rain` : '☀️ No rain expected';
    const cond    = d.forecastConditions || d.conditions || '';

    let block = `🌤 Casmas Weather (as of ${d.time})\n`;
    block += `🌡  ${d.tempF != null ? d.tempF+'°F' : '—'}${feels}  💧 ${d.humidity != null ? d.humidity+'%' : '—'}\n`;
    block += `💨  ${d.windMph != null ? d.windMph+' mph' : '—'} ${d.windDir}${gust}\n`;
    block += `📊  ${d.pressureMb || '—'} mb  ☀️  UV ${d.uv || '—'}${rain}\n`;
    if (hiLo || cond) block += `📅  Today: ${[hiLo, cond].filter(Boolean).join(' · ')}\n`;
    block += `${precip}`;

    return block;
  } catch (e) {
    console.warn('[weather] getTempestBlock failed:', e.message, '— skipping weather in digest');
    return null;
  }
}

module.exports = { getTempestToken, setTempestToken, getTempestBlock, getTempestRaw };

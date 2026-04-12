'use strict';
/**
 * weather.js — Tempest weather integration for Anchor
 * Station: 192111 (Casmas weather, Lincolnton NC)
 *
 * Token stored in secrets table under key 'tempest_token' (encrypted).
 * All functions safe to call without a token — return null silently.
 *
 * IMPORTANT: API always returns metric units (C, m/s) regardless of
 * station_units setting — convert unconditionally to imperial for display.
 */

const { db } = require('./db');
const { encrypt, decrypt } = require('./crypto');

const STATION_ID = '192111';
const API_BASE   = 'https://swd.weatherflow.com/swd/rest';
const TIMEOUT_MS = 5000;

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

// ── Observation fetcher ───────────────────────────────────────────────────────

async function fetchObservation(token) {
  const url = `${API_BASE}/observations/station/${STATION_ID}?token=${token}`;
  const resp = await fetchWithTimeout(url, TIMEOUT_MS);
  if (!resp.ok) throw new Error(`Tempest API HTTP ${resp.status}`);
  const data = await resp.json();
  const obs = data?.obs?.[0];
  if (!obs) throw new Error('No observation data returned');
  return obs;
}

// ── Unit converters (API always returns metric) ───────────────────────────────

function toF(c)      { return c   != null ? Math.round(c * 9/5 + 32)     : null; }
function msToMph(ms) { return ms  != null ? Math.round(ms * 2.237)        : null; }

function windDir(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Format observation into a text block ──────────────────────────────────────

function formatObservation(obs) {
  const tempF      = obs.air_temperature    != null ? `${toF(obs.air_temperature)}°F`   : '—';
  const feelsF     = obs.feels_like         != null ? `${toF(obs.feels_like)}°F`         : null;
  const humidity   = obs.relative_humidity  != null ? `${Math.round(obs.relative_humidity)}%` : '—';
  const windAvg    = obs.wind_avg           != null ? `${msToMph(obs.wind_avg)} mph`     : '—';
  const windGust   = obs.wind_gust          != null && obs.wind_gust > 0
    ? `${msToMph(obs.wind_gust)} mph` : null;
  const windDirStr = windDir(obs.wind_direction);
  const pressure   = obs.sea_level_pressure != null ? `${obs.sea_level_pressure.toFixed(1)} mb` : '—';
  const uv         = obs.uv                 != null ? obs.uv.toFixed(1)                  : '—';
  const rain       = obs.precip_accum_local_day != null && obs.precip_accum_local_day > 0
    ? `${obs.precip_accum_local_day.toFixed(2)}"` : null;

  return [
    `🌡  ${tempF}${feelsF ? ` (feels ${feelsF})` : ''}  💧 ${humidity}`,
    `💨  ${windAvg} ${windDirStr}${windGust ? ` gusting ${windGust}` : ''}`,
    `📊  ${pressure}  ☀️  UV ${uv}${rain ? `  🌧 ${rain} rain today` : ''}`
  ].join('\n');
}

// ── Main export — safe, never throws ─────────────────────────────────────────

async function getTempestBlock() {
  try {
    const token = getTempestToken();
    if (!token) {
      console.log('[weather] no tempest_token in secrets — skipping');
      return null;
    }
    const obs   = await fetchObservation(token);
    const block = formatObservation(obs);
    const tz    = { timeZone: 'America/New_York' };
    const epoch = obs.timestamp || obs.epoch;
    const time  = epoch
      ? new Date(epoch * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz })
      : 'just now';
    return `🌤 Casmas Weather (as of ${time})\n${block}`;
  } catch (e) {
    console.warn('[weather] getTempestBlock failed:', e.message, '— skipping weather in digest');
    return null;
  }
}

module.exports = { getTempestToken, setTempestToken, getTempestBlock };

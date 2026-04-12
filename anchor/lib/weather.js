'use strict';
/**
 * weather.js — Tempest weather integration for Anchor
 * Station: 192111 (Casmas weather, Lincolnton NC)
 * API docs: https://apidocs.tempestwx.com/reference/quick-start
 *
 * Token stored in secrets table under key 'tempest_token' (encrypted).
 * All functions are safe to call without a token — they return null silently.
 * buildDigestEmail() calls getTempestBlock() and prepends if non-null.
 *
 * NOTE: /observations/station/{id} returns named fields in obs objects,
 * not positional arrays. Fields: air_temperature, relative_humidity,
 * wind_avg, wind_gust, wind_direction, sea_level_pressure, uv,
 * precip_accum_local_day, feels_like, epoch, etc.
 * Units depend on station_units in response — default is metric.
 * We convert as needed (C→F, m/s→mph, mb is already mb).
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
  // Return both the obs object and station_units for unit conversion
  return { obs, units: data.station_units || {} };
}

// ── Unit converters ───────────────────────────────────────────────────────────

function toF(c) { return c != null ? (c * 9/5 + 32) : null; }
function msToMph(ms) { return ms != null ? ms * 2.237 : null; }

function windDir(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Format observation into a text block ──────────────────────────────────────

function formatObservation(obs, units) {
  // Station endpoint returns named fields
  const tempUnit = units.units_temp || 'c';
  const windUnit = units.units_wind || 'mps';

  // Temperature — convert C→F if needed
  let tempRaw   = obs.air_temperature;
  let feelsRaw  = obs.feels_like;
  if (tempUnit === 'c' || tempUnit === 'metric') {
    tempRaw  = toF(tempRaw);
    feelsRaw = toF(feelsRaw);
  }

  // Wind — convert m/s→mph if needed
  let windAvgRaw  = obs.wind_avg;
  let windGustRaw = obs.wind_gust;
  if (windUnit === 'mps' || windUnit === 'metric') {
    windAvgRaw  = msToMph(windAvgRaw);
    windGustRaw = msToMph(windGustRaw);
  }

  const tempF      = tempRaw   != null ? `${Math.round(tempRaw)}°F`       : '—';
  const feelsLike  = feelsRaw  != null ? `${Math.round(feelsRaw)}°F`      : null;
  const humidity   = obs.relative_humidity != null ? `${Math.round(obs.relative_humidity)}%` : '—';
  const windAvg    = windAvgRaw  != null ? `${Math.round(windAvgRaw)} mph` : '—';
  const windGust   = windGustRaw != null ? `${Math.round(windGustRaw)} mph`: null;
  const windDirStr = windDir(obs.wind_direction);
  const pressure   = obs.sea_level_pressure != null ? `${obs.sea_level_pressure.toFixed(1)} mb` : '—';
  const uv         = obs.uv != null ? obs.uv.toFixed(1) : '—';
  const rain       = obs.precip_accum_local_day != null && obs.precip_accum_local_day > 0
    ? `${obs.precip_accum_local_day.toFixed(2)}"` : null;

  return [
    `🌡  ${tempF}${feelsLike ? ` (feels ${feelsLike})` : ''}  💧 ${humidity}`,
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
    const { obs, units } = await fetchObservation(token);
    const block = formatObservation(obs, units);
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

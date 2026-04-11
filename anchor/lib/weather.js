'use strict';
/**
 * weather.js — Tempest weather integration for Anchor
 * Station: 192111 (Casmas weather, Lincolnton NC)
 * API docs: https://apidocs.tempestwx.com/reference/quick-start
 *
 * Token stored in secrets table under key 'tempest_token' (encrypted).
 * All functions are safe to call without a token — they return null silently.
 * buildDigestEmail() should call getTempestBlock() and prepend if non-null.
 */

const { db } = require('./db');
const { encrypt, decrypt } = require('./crypto');

const STATION_ID  = '192111';
const API_BASE    = 'https://swd.weatherflow.com/swd/rest';
const TIMEOUT_MS  = 5000;

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
  // API returns obs array — first element is most recent
  const obs = data?.obs?.[0];
  if (!obs) throw new Error('No observation data returned');
  return obs;
}

// ── Wind direction helper ─────────────────────────────────────────────────────

function windDir(deg) {
  if (deg == null) return '';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ── Format observation into a text block ──────────────────────────────────────

function formatObservation(obs) {
  // Tempest obs fields (indices from API docs):
  // [0] epoch, [2] wind_avg mph, [3] wind_gust mph, [4] wind_dir deg
  // [6] pressure mb, [7] temp F (air_temperature), [8] humidity %
  // [9] lux, [10] uv, [11] solar_radiation, [12] rain_accumulated mm
  // [13] precip_type, [18] feels_like F, [19] dew_point F, [20] wet_bulb F

  const tempF       = obs[7]  != null ? `${Math.round(obs[7])}°F`          : '—';
  const feelsLike   = obs[18] != null ? `${Math.round(obs[18])}°F`         : null;
  const humidity    = obs[8]  != null ? `${Math.round(obs[8])}%`           : '—';
  const windAvg     = obs[2]  != null ? `${Math.round(obs[2])} mph`        : '—';
  const windGust    = obs[3]  != null ? `${Math.round(obs[3])} mph`        : null;
  const windDirStr  = obs[4]  != null ? windDir(obs[4])                    : '';
  const pressure    = obs[6]  != null ? `${obs[6].toFixed(1)} mb`          : '—';
  const uv          = obs[10] != null ? obs[10].toFixed(1)                 : '—';
  const rain        = obs[12] != null && obs[12] > 0 ? `${obs[12].toFixed(1)} mm` : null;

  let lines = [];
  lines.push(`🌡  ${tempF}${feelsLike ? ` (feels ${feelsLike})` : ''}  💧 ${humidity}`);
  lines.push(`💨  ${windAvg} ${windDirStr}${windGust ? ` gusting ${windGust}` : ''}`);
  lines.push(`📊  ${pressure}  ☀️  UV ${uv}${rain ? `  🌧 ${rain} rain` : ''}`);

  return lines.join('\n');
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
    const time  = new Date(obs[0] * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz });
    return `🌤 Casmas Weather (as of ${time})\n${block}`;
  } catch (e) {
    console.warn('[weather] getTempestBlock failed:', e.message, '— skipping weather in digest');
    return null;
  }
}

module.exports = { getTempestToken, setTempestToken, getTempestBlock };

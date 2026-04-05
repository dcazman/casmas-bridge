'use strict';
const { db } = require('./db');

const COST_IN  = 0.80 / 1_000_000;
const COST_OUT = 4.00 / 1_000_000;
const API_SPEND_LIMIT = parseFloat(process.env.API_SPEND_LIMIT || '40');

function logUsage(ti, to, model, op) {
  try { db.prepare('INSERT INTO usage_log (tokens_in,tokens_out,model,operation) VALUES (?,?,?,?)').run(ti||0, to||0, model, op); }
  catch (e) { console.error('usage log:', e.message); }
}

function getUsageStats() {
  const rows = db.prepare('SELECT tokens_in,tokens_out FROM usage_log').all();
  const ti = rows.reduce((s,r) => s + (r.tokens_in||0), 0);
  const to = rows.reduce((s,r) => s + (r.tokens_out||0), 0);
  const cost = ti * COST_IN + to * COST_OUT;
  return { cost: cost.toFixed(4), limit: API_SPEND_LIMIT, pct: Math.min(100, cost / API_SPEND_LIMIT * 100).toFixed(1) };
}

module.exports = { logUsage, getUsageStats };

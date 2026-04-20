'use strict';
const { db } = require('./db');

function logUsage(tokensIn, tokensOut, model, operation) {
  try {
    db.prepare('INSERT INTO usage_log (tokens_in,tokens_out,model,operation) VALUES (?,?,?,?)').run(
      tokensIn || 0, tokensOut || 0, model || '', operation || ''
    );
  } catch {}
}

function getUsageStats() {
  try {
    const total = db.prepare('SELECT SUM(tokens_in) as tin, SUM(tokens_out) as tout, COUNT(*) as calls FROM usage_log').get();
    const byModel = db.prepare('SELECT model, SUM(tokens_in) as tin, SUM(tokens_out) as tout, COUNT(*) as calls FROM usage_log GROUP BY model').all();
    return { total, byModel };
  } catch { return { total: {}, byModel: [] }; }
}

module.exports = { logUsage, getUsageStats };

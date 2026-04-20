'use strict';
const crypto = require('crypto');
const { db } = require('./db');

const PT_TTL = 30 * 60 * 1000;
const sessions = new Map();

function hash(pw, salt) {
  return crypto.createHash('sha256').update(pw + salt).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function validate(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || Date.now() > s.exp) { sessions.delete(token); return null; }
  s.exp = Date.now() + PT_TTL;
  return s;
}

function hasPassword() {
  return !!db.prepare("SELECT value FROM secrets WHERE key='pt_hash'").get();
}

function setup(password, currentPassword) {
  if (!password || password.length < 4) throw new Error('Password too short (min 4)');
  const existingHash = db.prepare("SELECT value FROM secrets WHERE key='pt_hash'").get();
  if (existingHash) {
    if (!currentPassword) throw new Error('Current password required');
    const saltRow = db.prepare("SELECT value FROM secrets WHERE key='pt_salt'").get();
    if (!saltRow || hash(currentPassword, saltRow.value) !== existingHash.value)
      throw new Error('Wrong password');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('pt_salt',?)").run(salt);
  db.prepare("INSERT OR REPLACE INTO secrets (key,value) VALUES ('pt_hash',?)").run(hash(password, salt));
  sessions.clear();
  const token = newToken();
  sessions.set(token, { exp: Date.now() + PT_TTL, aiEnabled: false });
  return token;
}

function unlock(password) {
  const hashRow = db.prepare("SELECT value FROM secrets WHERE key='pt_hash'").get();
  const saltRow = db.prepare("SELECT value FROM secrets WHERE key='pt_salt'").get();
  if (!hashRow || !saltRow) throw new Error('No password set');
  if (hash(password, saltRow.value) !== hashRow.value) throw new Error('Wrong password');
  const token = newToken();
  sessions.set(token, { exp: Date.now() + PT_TTL, aiEnabled: false });
  return token;
}

function lock(token) { sessions.delete(token); }

function toggleAI(token) {
  const s = validate(token);
  if (!s) throw new Error('Not unlocked');
  s.aiEnabled = !s.aiEnabled;
  return s.aiEnabled;
}

module.exports = { validate, hasPassword, setup, unlock, lock, toggleAI };

const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 7778;
const DB_PATH = '/data/notes.db';
const BRIDGE_PATH = '/bridge';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
const MODEL_OPUS  = 'claude-opus-4-5';
const COST_IN  = 0.80 / 1_000_000;
const COST_OUT = 4.00 / 1_000_000;
const API_SPEND_LIMIT   = parseFloat(process.env.API_SPEND_LIMIT || '40');
const PLAN_RENEWAL_DATE = process.env.PLAN_RENEWAL_DATE || '';
const SYNC_NOTE_THRESHOLD  = 20;
const SYNC_TOKEN_THRESHOLD = 10000;
const SYNC_AGE_HOURS = 24;

const SMTP_HOST   = process.env.SMTP_HOST  || '';
const SMTP_PORT   = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER   = process.env.SMTP_USER  || '';
const SMTP_PASS   = process.env.SMTP_PASS  || '';
const ALERT_EMAIL = process.env.ALERT_EMAIL || SMTP_USER;
const emailEnabled = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
let mailer = null;
if (emailEnabled) {
  mailer = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
}
async function sendEmail(subject, body) {
  if (!mailer) return { ok: false, error: 'Email not configured' };
  try { await mailer.sendMail({ from: SMTP_USER, to: ALERT_EMAIL, subject, text: body }); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

const ENC_KEY_RAW = process.env.ENCRYPTION_KEY;
if (!ENC_KEY_RAW) { console.error('FATAL: ENCRYPTION_KEY not set'); process.exit(1); }
const ENC_KEY = crypto.scryptSync(ENC_KEY_RAW, 'anchor-salt', 32);
function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + c.getAuthTag().toString('hex') + ':' + enc.toString('hex');
}
function decrypt(text) {
  if (!text) return text;
  try {
    const [ivH, tagH, encH] = text.split(':');
    if (!encH) return text;
    const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivH, 'hex'));
    d.setAuthTag(Buffer.from(tagH, 'hex'));
    return d.update(Buffer.from(encH, 'hex')) + d.final('utf8');
  } catch { return text; }
}

// [FULL v2.1 single-file server.js — restore point before modular refactor]
// Current production is the modular version in anchor/ folder
// To restore: cp casmas-bridge/archive/v2.1-server.js /srv/mergerfs/warehouse/anchor/server.js && docker restart anchor

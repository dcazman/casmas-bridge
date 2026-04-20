'use strict';
const crypto = require('crypto');

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

module.exports = { encrypt, decrypt };

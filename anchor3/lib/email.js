'use strict';
const nodemailer = require('nodemailer');

const SMTP_HOST  = process.env.SMTP_HOST;
const SMTP_PORT  = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER  = process.env.SMTP_USER;
const SMTP_PASS  = process.env.SMTP_PASS;
const ALERT_EMAIL  = process.env.ALERT_EMAIL;
const ALERT_EMAIL2 = process.env.ALERT_EMAIL2;

const emailEnabled = !!(SMTP_HOST && SMTP_USER && SMTP_PASS && ALERT_EMAIL);

let transporter = null;
if (emailEnabled) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function sendEmail(subject, body) {
  if (!transporter) return { ok: false, reason: 'email_not_configured' };
  const to = [ALERT_EMAIL, ALERT_EMAIL2].filter(Boolean).join(',');
  try {
    await transporter.sendMail({ from: SMTP_USER, to, subject, text: body });
    return { ok: true };
  } catch (e) {
    console.error('[email] send failed:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail, emailEnabled };

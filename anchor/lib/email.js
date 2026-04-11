'use strict';
const nodemailer = require('nodemailer');

const SMTP_HOST    = process.env.SMTP_HOST  || '';
const SMTP_PORT    = parseInt(process.env.SMTP_PORT || '587');
const SMTP_USER    = process.env.SMTP_USER  || '';
const SMTP_PASS    = process.env.SMTP_PASS  || '';
const ALERT_EMAIL  = process.env.ALERT_EMAIL || SMTP_USER;
const ALERT_EMAIL2 = process.env.ALERT_EMAIL2 || '';
const emailEnabled = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

const toList = [ALERT_EMAIL, ALERT_EMAIL2].filter(Boolean).join(', ');

async function sendEmail(subject, body) {
  if (!emailEnabled) return { ok: false, error: 'Email not configured' };
  try {
    const mailer = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await mailer.sendMail({ from: SMTP_USER, to: toList, subject, text: body });
    mailer.close();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { sendEmail, emailEnabled };

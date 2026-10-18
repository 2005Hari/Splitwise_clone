// Transactional email over plain SMTP — same pattern as YouPI-PG: the user
// supplies their own provider's credentials in .env (any SMTP host works:
// their own mail server, or a provider like Resend/Postmark/SES's SMTP
// endpoint); nothing is signed up for here, and sending no-ops cleanly
// (logged, never thrown) when it isn't configured, so the rest of the app
// never depends on email actually being set up.
import nodemailer from 'nodemailer';

let transporter;
let attempted = false;

function getTransporter() {
  if (attempted) return transporter;
  attempted = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[email not configured — skipped] to=${to} subject="${subject}"`);
    return { sent: false };
  }
  const from = process.env.SMTP_FROM || '"Splitwise Clone" <no-reply@example.com>';
  try {
    const info = await t.sendMail({ from, to, subject, text, html: html || `<p>${text}</p>` });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.warn('email send failed:', err.message);
    return { sent: false, error: err.message };
  }
}

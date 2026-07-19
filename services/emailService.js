// Email Service - sends emails via Resend HTTP API
const axios = require('axios');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'SSG Server <notifications@ssg-server.com>';

/**
 * Send an email via Resend API
 * @param {Object} options
 * @param {string|string[]} options.to - Recipient email address(es)
 * @param {string} options.subject - Email subject line
 * @param {string} options.text - Plain text body
 * @param {string} [options.html] - HTML body (optional, overrides text if provided)
 * @param {Array} [options.attachments] - Array of { filename, content } objects (content is base64 or string)
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendEmail({ to, subject, text, html, attachments }) {
  if (!RESEND_API_KEY) {
    console.log('[Email] Resend API key not configured — skipping send.');
    return { success: false, error: 'Resend API key not configured' };
  }

  if (!to || (Array.isArray(to) && to.length === 0) || (typeof to === 'string' && !to.trim())) {
    console.log('[Email] No recipients specified — skipping send.');
    return { success: false, error: 'No recipients specified' };
  }

  const payload = {
    from: FROM_EMAIL,
    to: Array.isArray(to) ? to : [to],
    subject,
  };

  // Prefer HTML over plain text if provided
  if (html) {
    payload.html = html;
  } else {
    payload.text = text;
  }

  // Add attachments if provided
  if (attachments && attachments.length > 0) {
    payload.attachments = attachments.map(att => ({
      filename: att.filename,
      content: Buffer.from(att.content).toString('base64')
    }));
  }

  try {
    const res = await axios.post('https://api.resend.com/emails', payload, {
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    console.log(`[Email] ✅ Sent successfully to ${Array.isArray(to) ? to.join(', ') : to} — ID: ${res.data.id}`);
    return { success: true, id: res.data.id };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.response?.data || err.message;
    console.error('[Email] ❌ Failed to send:', JSON.stringify(errorMsg));
    return { success: false, error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg) };
  }
}

module.exports = { sendEmail };
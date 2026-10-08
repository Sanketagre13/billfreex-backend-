/**
 * Transactional email bodies. Each returns { subject, html, text } — the text
 * part matters: some admins read mail in plain-text clients, and it's what
 * the dev console fallback in email/resend.js prints.
 */

const BRAND = '#fc6d27'

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

const istDateTime = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
})

/** Table-based and inline-styled on purpose: that's what email clients render reliably. */
function layout({ heading, paragraphs, button, footnote }) {
  const body = paragraphs
    .map((html) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151">${html}</p>`)
    .join('')
  const cta = button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(button.href)}" style="display:inline-block;background:${BRAND};color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:8px">${escapeHtml(button.label)}</a></p>`
    : ''

  return `<!doctype html>
<html><body style="margin:0;background:#f9fafb;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 16px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px">
<tr><td style="background:${BRAND};border-radius:12px 12px 0 0;padding:16px 28px;color:#ffffff;font-weight:700;font-size:18px">BillFreeX Admin</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#111827">${escapeHtml(heading)}</h1>
${body}${cta}
${footnote ? `<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b7280">${footnote}</p>` : ''}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

export function adminPasswordResetEmail({ name, resetUrl, ttlMinutes }) {
  return {
    subject: 'Reset your BillFreeX admin password',
    text:
      `Hi ${name},\n\n` +
      'We received a request to reset the password for your BillFreeX admin account. ' +
      `Open this link to choose a new one:\n\n${resetUrl}\n\n` +
      `The link works once and expires in ${ttlMinutes} minutes.\n\n` +
      "If you didn't ask for this, ignore this email. Your password won't change.\n\n— BillFreeX",
    html: layout({
      heading: 'Reset your password',
      paragraphs: [
        `Hi ${escapeHtml(name)},`,
        'We received a request to reset the password for your BillFreeX admin account. Use the button below to choose a new one.',
      ],
      button: { href: resetUrl, label: 'Choose a new password' },
      footnote:
        `The link works once and expires in ${ttlMinutes} minutes. If you didn't ask for this, ignore this email. ` +
        `Your password won't change.<br><br>Button not working? Paste this into your browser:<br>` +
        `<span style="word-break:break-all;color:#374151">${escapeHtml(resetUrl)}</span>`,
    }),
  }
}

/** Sent after every password change or reset, so an admin finds out if it wasn't them. */
export function adminPasswordChangedEmail({ name, changedAt, viaReset }) {
  const when = `${istDateTime.format(changedAt)} IST`
  const how = viaReset ? 'reset using an emailed link' : 'changed from the admin panel'
  return {
    subject: 'Your BillFreeX admin password was changed',
    text:
      `Hi ${name},\n\nThe password for your BillFreeX admin account was ${how} on ${when}. ` +
      `${viaReset ? 'All sessions' : 'All other sessions'} were signed out.\n\n` +
      "If this wasn't you, tell the BillFreeX team immediately so your access can be locked.\n\n— BillFreeX",
    html: layout({
      heading: 'Your password was changed',
      paragraphs: [
        `Hi ${escapeHtml(name)},`,
        `The password for your BillFreeX admin account was ${how} on <strong>${escapeHtml(when)}</strong>. ` +
          `${viaReset ? 'All sessions' : 'All other sessions'} were signed out.`,
      ],
      footnote: "If this wasn't you, tell the BillFreeX team immediately so your access can be locked.",
    }),
  }
}

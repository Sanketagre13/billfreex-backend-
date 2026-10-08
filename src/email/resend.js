import { config } from '../config.js'
import { logger } from '../lib/logger.js'

const ENDPOINT = 'https://api.resend.com/emails'

/**
 * Sends one transactional email through Resend's REST API — a single POST,
 * so plain fetch rather than an SDK, same as crif/client.js.
 *
 * Without RESEND_API_KEY outside production, the email is printed to the
 * console instead, so the password flows can be exercised locally with no
 * Resend account. In production a missing key is a hard failure.
 */
export async function sendEmail({ to, subject, html, text }) {
  if (!config.email.resendApiKey) {
    if (config.isProd) throw new Error('RESEND_API_KEY is not set, so no email can be sent')
    logger.info(`[email not sent: RESEND_API_KEY unset] to ${to} — ${subject}\n${text}`)
    return { id: null }
  }

  let response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.email.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(config.email.timeoutMs),
    })
  } catch (error) {
    throw new Error(`could not reach Resend (${error.name === 'TimeoutError' ? 'timed out' : error.message})`)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `Resend rejected the email (HTTP ${response.status}${body?.name ? ` ${body.name}` : ''}): ` +
        (body?.message ?? 'no message'),
    )
  }
  return { id: body?.id ?? null }
}

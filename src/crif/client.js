/**
 * The only module that talks to CRIF.
 *
 * The service key and access token live here and never leave the server — this
 * proxy exists precisely so the browser cannot see them. Everything the client
 * gets back is a normalised envelope.
 */
import { config } from '../config.js'
import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'

const ENDPOINTS = {
  consentOtp: '/crifService/crif/consent/otp',
  scoreFetch: '/crifService/crif/score/fetch',
}

function headers() {
  return {
    'Content-Type': 'application/json',
    'service-key': config.crif.serviceKey,
    Authorization: config.crif.authorization,
  }
}

/**
 * POSTs JSON and returns the parsed body.
 *
 * CRIF answers 200 with `{ status, message, data, code }`. A non-SUCCESS status
 * is a business failure (bad OTP, unknown PAN) and carries a message written for
 * the end user, so it is passed through. A transport failure is not, and gets a
 * generic message instead.
 */
async function post(path, payload, { label }) {
  const url = `${config.crif.baseUrl}${path}`
  const startedAt = Date.now()

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.crif.timeoutMs),
    })
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      logger.warn(`${label} timed out after ${Date.now() - startedAt}ms`)
      throw ApiError.timeout()
    }
    logger.error(`${label} transport failure`, error)
    throw ApiError.upstream(
      'We could not reach the credit bureau. Please try again in a moment.',
      error,
    )
  }

  const raw = await response.text()
  let body = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    // Not JSON — so this never reached the bureau's application. It is an edge
    // component talking: an API-gateway denial, a WAF block, a proxy error page.
    // The status line is worthless for telling those apart (AWS API Gateway will
    // answer "202 Accepted" while carrying a ForbiddenException), so the
    // content type, the gateway's error header and a snippet of the body all get
    // logged — that trio is what actually identifies the problem.
    const gatewayError = response.headers.get('x-amzn-errortype')
    logger.error(
      `${label} returned non-JSON (HTTP ${response.status}` +
        `, content-type ${response.headers.get('content-type') ?? 'none'}` +
        `${gatewayError ? `, gateway error ${gatewayError}` : ''}): ` +
        JSON.stringify(raw.replace(/\s+/g, ' ').trim().slice(0, 200)),
    )

    // A denial at the edge is almost always our IP, host or key — not anything
    // the customer can retry their way out of.
    if (/forbidden|denied|unauthor/i.test(`${gatewayError} ${raw}`)) {
      throw ApiError.upstream('Credit checks are temporarily unavailable. Please try again later.')
    }
    throw ApiError.upstream('The credit bureau returned an unexpected response. Please try again.')
  }

  const failed = !response.ok || body?.status !== 'SUCCESS'

  // On failure the bureau's own message is the only thing that says *why* —
  // "Invalid OTP" vs a named field. It describes the request, not the applicant,
  // so it is safe to log and is what makes a support call answerable.
  logger.info(
    `${label} → HTTP ${response.status} ${body?.status ?? '-'} in ${Date.now() - startedAt}ms` +
      (failed && body?.message ? ` — ${body.message}` : ''),
  )

  if (!response.ok) {
    // 401/403 here means our credentials are wrong — an operator problem, not
    // something the customer can act on, so it is logged loudly and generalised.
    if (response.status === 401 || response.status === 403) {
      logger.error(`${label} rejected our credentials (HTTP ${response.status}) — check CRIF keys`)
      throw ApiError.upstream('Credit checks are temporarily unavailable. Please try again later.')
    }

    // A 4xx is *usually* our problem, not the customer's. A genuine "we have no
    // file on you" comes back as a 200 with score "-1" (see the notHit path), so
    // the only 4xx a customer can actually act on is a bad or expired OTP.
    // Everything else — a schema rejection, "Service, Service not found" from an
    // unprovisioned key — is a bug or an ops issue, and echoing it into the UI
    // tells the user nothing while leaking our internals.
    if (response.status < 500) {
      const message = body?.message ?? ''
      if (/\botp\b/i.test(message)) {
        throw new ApiError(422, 'BUREAU_REJECTED', message)
      }

      logger.error(`${label} rejected our request (HTTP ${response.status}) — ${message || 'no message'}`)
      throw ApiError.upstream(
        'We could not complete your credit check right now. Please try again later.',
      )
    }

    throw ApiError.upstream(
      'The credit bureau could not process this request. Please try again in a moment.',
    )
  }

  if (body?.status !== 'SUCCESS') {
    throw new ApiError(422, 'BUREAU_REJECTED', body?.message || 'The credit bureau rejected this request.')
  }

  return body
}

/** Sends the consent OTP. Resolves when the bureau confirms dispatch. */
export async function sendConsentOtp({ mobileNumber }) {
  const body = await post(ENDPOINTS.consentOtp, { mobileNumber }, { label: 'consent/otp' })
  return {
    sent: body.data === true,
    message: body.message,
  }
}

/**
 * Pulls the CRIF score.
 *
 * `data` is forwarded exactly as the bureau returns it — score, status, file,
 * displayId and the full b2CReport — so the UI can render the real report
 * without this layer having to model it.
 */
export async function fetchScore(applicant) {
  const body = await post(ENDPOINTS.scoreFetch, applicant, { label: 'score/fetch' })
  return {
    message: body.message,
    data: body.data ?? null,
  }
}

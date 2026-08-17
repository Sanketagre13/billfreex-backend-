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

    const gatewayError = response.headers.get('x-amzn-errortype')
    logger.error(
      `${label} returned non-JSON (HTTP ${response.status}` +
      `, content-type ${response.headers.get('content-type') ?? 'none'}` +
      `${gatewayError ? `, gateway error ${gatewayError}` : ''}): ` +
      JSON.stringify(raw.replace(/\s+/g, ' ').trim().slice(0, 200)),
    )

    if (/forbidden|denied|unauthor/i.test(`${gatewayError} ${raw}`)) {
      throw ApiError.upstream('Credit checks are temporarily unavailable. Please try again later.')
    }
    throw ApiError.upstream('The credit bureau returned an unexpected response. Please try again.')
  }

  const failed = !response.ok || body?.status !== 'SUCCESS'

  logger.info(
    `${label} → HTTP ${response.status} ${body?.status ?? '-'} in ${Date.now() - startedAt}ms` +
    (failed && body?.message ? ` — ${body.message}` : ''),
  )

  if (!response.ok) {

    if (response.status === 401 || response.status === 403) {
      logger.error(`${label} rejected our credentials (HTTP ${response.status}) — check CRIF keys`)
      throw ApiError.upstream('Credit checks are temporarily unavailable. Please try again later.')
    }

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

export async function sendConsentOtp({ mobileNumber }) {
  const body = await post(ENDPOINTS.consentOtp, { mobileNumber }, { label: 'consent/otp' })
  return {
    sent: body.data === true,
    message: body.message,
  }
}


export async function fetchScore(applicant) {
  const body = await post(ENDPOINTS.scoreFetch, { ...applicant, customerConsent: 'Y' }, { label: 'score/fetch' })
  return {
    message: body.message,
    data: body.data ?? null,
  }
}

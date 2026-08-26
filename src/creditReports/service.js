import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'
import { sendConsentOtp, fetchScore } from '../crif/client.js'
import { insertCreditReport, findLatestReportRow, decryptReportData } from './repository.js'

const CACHE_MS = config.creditReport.cacheDays * 24 * 60 * 60 * 1000

/** Rolling 30 × 24h window from the last successful fetch, evaluated in UTC
 *  (fetchedAt is a real Date thanks to the pool's timezone:'Z' config) —
 *  not a calendar-month rule. */
const isFresh = (row) => Boolean(row) && Date.now() - row.fetchedAt.getTime() < CACHE_MS

function toResponse(row, cached) {
  return {
    message: 'Credit report retrieved.',
    data: decryptReportData(row),
    cached,
    fetchedAt: row.fetchedAt,
  }
}

export async function sendCreditReportOtp(user) {
  const result = await sendConsentOtp({ mobileNumber: user.mobileNumber })
  return { sent: result.sent, message: result.message ?? 'OTP sent successfully.' }
}

/**
 * Serves the cached report when it's less than 30 days old; otherwise pulls
 * a fresh one from CRIF. A per-user MySQL named lock protects the "otherwise"
 * branch: only the request that actually wins the lock talks to CRIF, and
 * everyone else re-checks freshness once they get the lock, so simultaneous
 * first-time requests result in exactly one bureau call.
 */
export async function fetchCreditReport(user, { panNumber, otp }) {
  const cached = await findLatestReportRow(user.id)
  if (isFresh(cached)) return toResponse(cached, true)

  const lockName = `credit_report:${user.id}`
  const lockTimeoutSeconds = Math.ceil(config.creditReport.lockTimeoutMs / 1000)

  const connection = await pool.getConnection()
  try {
    const [[lockResult]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [
      lockName,
      lockTimeoutSeconds,
    ])
    if (lockResult.acquired !== 1) {
      throw ApiError.upstream('We could not process your request right now. Please try again in a moment.')
    }

    try {
      // A concurrent request may have just inserted while we waited for the lock.
      const fresh = await findLatestReportRow(user.id, connection)
      if (isFresh(fresh)) return toResponse(fresh, true)

      const applicant = {
        panNumber,
        otp,
        fullName: user.fullName.replace(/\s+/g, ' ').trim().toUpperCase(),
        mobileNumber: user.mobileNumber,
        email: user.email,
        dob: user.dob,
        pincode: user.pincode,
        stateName: user.state,
        cityName: user.city,
        addressLine1: user.addressLine1,
        addressLine2: user.addressLine2 || '',
      }

      const result = await fetchScore(applicant)
      const fetchedAt = new Date()
      const score = Number(result.data?.score)

      await insertCreditReport(
        {
          userId: user.id,
          panNumber,
          reportData: result.data,
          score: Number.isFinite(score) ? score : null,
          bureauStatus: result.data?.status ?? null,
          displayId: result.data?.displayId ?? null,
          fetchedAt,
        },
        connection,
      )

      logger.info(`credit-report fetched for user ${user.id} (status: ${result.data?.status ?? '-'})`)
      return { message: result.message, data: result.data, cached: false, fetchedAt }
    } finally {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [lockName])
      } catch (error) {
        logger.error('Failed to release credit-report lock', error)
      }
    }
  } finally {
    connection.release()
  }
}

export async function getLatestCreditReport(user) {
  const row = await findLatestReportRow(user.id)
  return row ? toResponse(row, true) : null
}

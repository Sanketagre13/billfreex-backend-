import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'
import { sendConsentOtp, fetchScore } from '../crif/client.js'
import {
  insertCreditReport,
  findLatestReportRow,
  findReportRowsSince,
  decryptReportData,
  decryptPanNumber,
} from './repository.js'

const CACHE_MS = config.creditReport.cacheDays * 24 * 60 * 60 * 1000
const MIN_SCORE = 300

/** Only a real score is worth holding on to. A notHit (score "-1") usually
 *  means a PAN/name/DOB mismatch the user can correct, so caching it would
 *  block the exact retry the UI tells them to make. */
const isHit = (row) => row.bureauStatus !== 'notHit' && row.score != null && row.score >= MIN_SCORE

/**
 * The stored report a fetch for `panNumber` is served from instead of calling
 * CRIF, or null if the bureau has to be asked: a hit for that same PAN within
 * the rolling 30 × 24h window, evaluated in UTC (the pool's timezone:'Z'
 * config) — not a calendar-month rule.
 */
async function findCachedReportRow(userId, panNumber, conn) {
  const rows = await findReportRowsSince(userId, new Date(Date.now() - CACHE_MS), conn)
  return rows.find((row) => isHit(row) && decryptPanNumber(row) === panNumber) ?? null
}

function toResponse(row, cached) {
  return {
    message: 'Credit report retrieved.',
    data: decryptReportData(row),
    cached,
    fetchedAt: row.fetchedAt,
  }
}

/**
 * When the fetch would be served from cache anyway, returns that report
 * instead of sending an OTP — otherwise the user gets an SMS whose code is
 * never checked, and the bureau bills for a consent that leads nowhere.
 */
export async function sendCreditReportOtp(user, { panNumber }) {
  const cached = await findCachedReportRow(user.id, panNumber)
  if (cached) return { sent: false, cached: true, report: toResponse(cached, true) }

  const result = await sendConsentOtp({ mobileNumber: user.mobileNumber })
  return { sent: result.sent, cached: false, message: result.message ?? 'OTP sent successfully.' }
}

/**
 * Serves a cached hit for this PAN when it's less than 30 days old; otherwise
 * pulls a fresh one from CRIF. A per-user MySQL named lock protects the
 * "otherwise" branch: only the request that actually wins the lock talks to
 * CRIF, and everyone else re-checks the cache once they get the lock, so
 * simultaneous first-time requests result in exactly one bureau call.
 */
export async function fetchCreditReport(user, { panNumber, otp }) {
  const cached = await findCachedReportRow(user.id, panNumber)
  if (cached) return toResponse(cached, true)

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
      const fresh = await findCachedReportRow(user.id, panNumber, connection)
      if (fresh) return toResponse(fresh, true)

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

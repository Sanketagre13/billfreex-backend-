import { randomBytes, createHash } from 'node:crypto'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'
import { hashPassword, verifyPassword } from '../auth/passwords.js'
import { sendEmail } from '../email/resend.js'
import { adminPasswordResetEmail, adminPasswordChangedEmail } from '../email/templates.js'
import {
  findAdminByEmail,
  findAdminById,
  updateAdminPassword,
  insertPasswordReset,
  findPasswordResetByTokenHash,
  hasPasswordResetSince,
  consumePasswordReset,
  deletePasswordResets,
} from './repository.js'
import { revokeAllAdminSessions, revokeOtherAdminSessions } from './sessions.js'

/** Like session tokens, reset tokens are stored only as a SHA-256 hash: a
 *  database leak alone can't be turned into a working reset link. */
const hashToken = (token) => createHash('sha256').update(token).digest('hex')

/** One reset email per admin per minute, however often the form is submitted. */
const RESEND_COOLDOWN_MS = 60 * 1000

const invalidLink = () =>
  new ApiError(400, 'RESET_LINK_INVALID', 'This reset link is invalid or has expired. Request a new one.')

/** Email side effects never fail the request that caused them — the password
 *  change has already happened by then — but a failure is always logged. */
function sendInBackground(label, email) {
  sendEmail(email).catch((error) => logger.error(`${label} email failed`, error))
}

/**
 * Resolves identically whether or not `email` belongs to an admin, so the
 * response can't be used to discover admin addresses. The token and Resend
 * call run in the background for the same reason: awaiting them only for
 * real admins would make those requests measurably slower.
 */
export async function requestAdminPasswordReset(email) {
  const admin = await findAdminByEmail(email)
  if (!admin) return

  issuePasswordReset(admin).catch((error) =>
    logger.error(`admin password reset for admin ${admin.id} failed`, error),
  )
}

async function issuePasswordReset(admin) {
  const now = Date.now()
  if (await hasPasswordResetSince(admin.id, new Date(now - RESEND_COOLDOWN_MS))) {
    logger.info(`admin password reset: skipped for admin ${admin.id}, one was sent under a minute ago`)
    return
  }

  const token = randomBytes(32).toString('base64url')
  const ttlMinutes = config.admin.passwordResetTtlMinutes

  // Only the newest link works: issuing one retires any earlier unused ones.
  await deletePasswordResets(admin.id)
  await insertPasswordReset({
    adminId: admin.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + ttlMinutes * 60 * 1000),
    createdAt: new Date(now),
  })

  const resetUrl = `${config.admin.panelUrl}/reset-password?token=${token}`
  await sendEmail({ to: admin.email, ...adminPasswordResetEmail({ name: admin.fullName, resetUrl, ttlMinutes }) })
  logger.info(`admin password reset: link emailed to admin ${admin.id}`)
}

/** Completes a reset from an emailed link: single-use, and it signs the
 *  admin out of every session, since whoever held the old password might
 *  have been the reason for the reset. */
export async function resetAdminPassword({ token, password }) {
  const reset = await findPasswordResetByTokenHash(hashToken(token))
  if (!reset || reset.expiresAt.getTime() <= Date.now()) throw invalidLink()

  const admin = await findAdminById(reset.adminId)
  if (!admin) throw invalidLink()

  const passwordHash = await hashPassword(password)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (!(await consumePasswordReset(reset.id, connection))) throw invalidLink()
    await updateAdminPassword(admin.id, passwordHash, connection)
    await deletePasswordResets(admin.id, connection)
    await revokeAllAdminSessions(admin.id, connection)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  logger.info(`admin password reset: completed for admin ${admin.id}`)
  sendInBackground('admin password-changed', {
    to: admin.email,
    ...adminPasswordChangedEmail({ name: admin.fullName, changedAt: new Date(), viaReset: true }),
  })
}

/** Signed-in password change. Keeps the current session, signs out the rest. */
export async function changeAdminPassword(admin, sessionToken, { currentPassword, newPassword }) {
  const record = await findAdminById(admin.id)
  if (!record) throw ApiError.unauthorized('Please sign in to the admin panel.')

  if (!(await verifyPassword(currentPassword, record.passwordHash))) {
    throw ApiError.badRequest('Your current password is incorrect.', {
      currentPassword: 'Incorrect password.',
    })
  }
  if (await verifyPassword(newPassword, record.passwordHash)) {
    throw ApiError.badRequest('Choose a password you are not already using.', {
      newPassword: 'Must be different from your current password.',
    })
  }

  const passwordHash = await hashPassword(newPassword)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    await updateAdminPassword(admin.id, passwordHash, connection)
    // A reset link emailed before the change must not be able to undo it.
    await deletePasswordResets(admin.id, connection)
    await revokeOtherAdminSessions(admin.id, sessionToken, connection)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  logger.info(`admin password changed: admin ${admin.id}`)
  sendInBackground('admin password-changed', {
    to: record.email,
    ...adminPasswordChangedEmail({ name: record.fullName, changedAt: new Date(), viaReset: false }),
  })
}

// Used links are deleted on the spot; this reclaims expired, unused ones.
const SWEEP_MS = 60 * 60 * 1000
setInterval(() => {
  pool.execute('DELETE FROM admin_password_resets WHERE expires_at < NOW()').catch(() => {})
}, SWEEP_MS).unref()

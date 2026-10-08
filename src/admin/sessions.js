import { randomBytes, createHash } from 'node:crypto'
import { pool } from '../db/pool.js'
import { config } from '../config.js'

/**
 * Admin sessions mirror auth/sessions.js — raw token in an HttpOnly cookie,
 * only its SHA-256 hash stored — with two deliberate differences: they live
 * in their own table, and they have a fixed lifetime with no sliding renewal.
 * An admin session can read every user's personal data, so it ends on
 * schedule however active it is.
 */
const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const ttlMs = () => config.admin.sessionTtlHours * 60 * 60 * 1000

export async function createAdminSession(adminId, conn = pool) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlMs())
  await conn.execute(
    'INSERT INTO admin_sessions (admin_id, token_hash, expires_at, last_used_at) VALUES (?, ?, ?, ?)',
    [adminId, hashToken(token), expiresAt, new Date()],
  )
  return { token, expiresAt }
}

export async function findAdminSessionByToken(token) {
  const [rows] = await pool.execute(
    'SELECT id, admin_id AS adminId, expires_at AS expiresAt FROM admin_sessions WHERE token_hash = ? LIMIT 1',
    [hashToken(token)],
  )
  const session = rows[0] ?? null
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  return session
}

export async function touchAdminSession(session) {
  await pool.execute('UPDATE admin_sessions SET last_used_at = ? WHERE id = ?', [new Date(), session.id])
}

export async function revokeAdminSessionByToken(token) {
  await pool.execute('DELETE FROM admin_sessions WHERE token_hash = ?', [hashToken(token)])
}

/** Signs an admin out everywhere — used when their password is reset. */
export async function revokeAllAdminSessions(adminId, conn = pool) {
  await conn.execute('DELETE FROM admin_sessions WHERE admin_id = ?', [adminId])
}

/** Signs an admin out everywhere except the session making the request —
 *  used when they change their own password while signed in. */
export async function revokeOtherAdminSessions(adminId, keepToken, conn = pool) {
  await conn.execute('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash <> ?', [
    adminId,
    hashToken(keepToken),
  ])
}

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.cookieSameSite,
    path: config.admin.cookiePath,
    expires: expiresAt,
  }
}

export function setAdminSessionCookie(res, token, expiresAt) {
  res.cookie(config.admin.cookieName, token, cookieOptions(expiresAt))
}

export function clearAdminSessionCookie(res) {
  res.clearCookie(config.admin.cookieName, {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.cookieSameSite,
    path: config.admin.cookiePath,
  })
}

const SWEEP_MS = 60 * 60 * 1000
setInterval(() => {
  pool.execute('DELETE FROM admin_sessions WHERE expires_at < NOW()').catch(() => {})
}, SWEEP_MS).unref()

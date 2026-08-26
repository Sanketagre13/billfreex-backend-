import { randomBytes, createHash } from 'node:crypto'
import { pool } from '../db/pool.js'
import { config } from '../config.js'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')
const ttlMs = () => config.session.ttlDays * 24 * 60 * 60 * 1000

/**
 * The raw token goes in the HttpOnly cookie; only its SHA-256 hash is ever
 * stored, so a database leak alone can't be replayed as a live session.
 */
export async function createSession(userId, conn = pool) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + ttlMs())
  await conn.execute(
    'INSERT INTO sessions (user_id, token_hash, expires_at, last_used_at) VALUES (?, ?, ?, ?)',
    [userId, hashToken(token), expiresAt, new Date()],
  )
  return { token, expiresAt }
}

export async function findSessionByToken(token) {
  const [rows] = await pool.execute(
    'SELECT id, user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ? LIMIT 1',
    [hashToken(token)],
  )
  const session = rows[0] ?? null
  if (!session || session.expiresAt.getTime() <= Date.now()) return null
  return session
}

/** Sliding expiration: extend once more than half the TTL has elapsed. */
export async function touchSession(session) {
  const now = Date.now()
  const remainingMs = session.expiresAt.getTime() - now

  if (remainingMs < ttlMs() / 2) {
    await pool.execute('UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?', [
      new Date(now),
      new Date(now + ttlMs()),
      session.id,
    ])
  } else {
    await pool.execute('UPDATE sessions SET last_used_at = ? WHERE id = ?', [new Date(now), session.id])
  }
}

export async function revokeSessionByToken(token) {
  await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)])
}

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.cookieSameSite,
    path: '/',
    expires: expiresAt,
  }
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(config.session.cookieName, token, cookieOptions(expiresAt))
}

export function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, {
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: config.session.cookieSameSite,
    path: '/',
  })
}

// Expired sessions are already rejected at lookup time; this just reclaims
// space periodically, mirroring the unref()'d sweep in middleware/rateLimit.js.
const SWEEP_MS = 60 * 60 * 1000
setInterval(() => {
  pool.execute('DELETE FROM sessions WHERE expires_at < NOW()').catch(() => {})
}, SWEEP_MS).unref()

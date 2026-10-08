import { pool } from '../db/pool.js'

const COLUMNS = `
  id, email, full_name AS fullName, password_hash AS passwordHash,
  last_login_at AS lastLoginAt, created_at AS createdAt
`

export async function createAdmin({ email, fullName, passwordHash }, conn = pool) {
  const [result] = await conn.execute(
    'INSERT INTO admins (email, full_name, password_hash) VALUES (?, ?, ?)',
    [email, fullName, passwordHash],
  )
  return result.insertId
}

export async function findAdminByEmail(email, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM admins WHERE email = ? LIMIT 1`, [email])
  return rows[0] ?? null
}

export async function findAdminById(id, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM admins WHERE id = ? LIMIT 1`, [id])
  return rows[0] ?? null
}

export async function updateAdminPassword(id, passwordHash, conn = pool) {
  await conn.execute('UPDATE admins SET password_hash = ? WHERE id = ?', [passwordHash, id])
}

export async function recordAdminLogin(id, conn = pool) {
  await conn.execute('UPDATE admins SET last_login_at = ? WHERE id = ?', [new Date(), id])
}

export async function insertPasswordReset({ adminId, tokenHash, expiresAt, createdAt }, conn = pool) {
  await conn.execute(
    'INSERT INTO admin_password_resets (admin_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [adminId, tokenHash, expiresAt, createdAt],
  )
}

export async function findPasswordResetByTokenHash(tokenHash, conn = pool) {
  const [rows] = await conn.execute(
    `SELECT id, admin_id AS adminId, expires_at AS expiresAt
     FROM admin_password_resets WHERE token_hash = ? LIMIT 1`,
    [tokenHash],
  )
  return rows[0] ?? null
}

export async function hasPasswordResetSince(adminId, since, conn = pool) {
  const [rows] = await conn.execute(
    'SELECT 1 FROM admin_password_resets WHERE admin_id = ? AND created_at >= ? LIMIT 1',
    [adminId, since],
  )
  return rows.length > 0
}

/** Deletes one reset row; true only for the caller that actually removed it,
 *  so two simultaneous submissions of the same link can't both succeed. */
export async function consumePasswordReset(id, conn = pool) {
  const [result] = await conn.execute('DELETE FROM admin_password_resets WHERE id = ?', [id])
  return result.affectedRows === 1
}

export async function deletePasswordResets(adminId, conn = pool) {
  await conn.execute('DELETE FROM admin_password_resets WHERE admin_id = ?', [adminId])
}

/** Never send the hash to the client. */
export function toPublicAdmin(admin) {
  if (!admin) return null
  const { passwordHash, ...publicAdmin } = admin
  return publicAdmin
}

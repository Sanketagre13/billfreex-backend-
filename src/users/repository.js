import { pool } from '../db/pool.js'

const COLUMNS = `
  id, full_name AS fullName, email, mobile_number AS mobileNumber, password_hash AS passwordHash,
  dob, pincode, city, address_line1 AS addressLine1, address_line2 AS addressLine2, state,
  created_at AS createdAt, updated_at AS updatedAt
`

export async function createUser(user, conn = pool) {
  const [result] = await conn.execute(
    `INSERT INTO users
      (full_name, email, mobile_number, password_hash, dob, pincode, city, address_line1, address_line2, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.fullName,
      user.email,
      user.mobileNumber,
      user.passwordHash,
      user.dob,
      user.pincode,
      user.city,
      user.addressLine1,
      user.addressLine2 || null,
      user.state,
    ],
  )
  return result.insertId
}

export async function findUserByEmail(email, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM users WHERE email = ? LIMIT 1`, [email])
  return rows[0] ?? null
}

export async function findUserByMobile(mobileNumber, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM users WHERE mobile_number = ? LIMIT 1`, [
    mobileNumber,
  ])
  return rows[0] ?? null
}

export async function findUserById(id, conn = pool) {
  const [rows] = await conn.execute(`SELECT ${COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id])
  return rows[0] ?? null
}

/** Never send the hash to the client. */
export function toPublicUser(user) {
  if (!user) return null
  const { passwordHash, ...publicUser } = user
  return publicUser
}

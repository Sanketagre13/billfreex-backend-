import { pool } from '../db/pool.js'
import { ApiError } from '../lib/ApiError.js'
import { logger, mask } from '../lib/logger.js'
import {
  createUser,
  findUserByEmail,
  findUserByMobile,
  findUserById,
  toPublicUser,
} from '../users/repository.js'
import { hashPassword, verifyPassword } from './passwords.js'
import { createSession } from './sessions.js'

export async function signup(input) {
  if (await findUserByEmail(input.email)) {
    throw ApiError.conflict('An account with this email already exists.', {
      email: 'This email is already registered.',
    })
  }
  if (await findUserByMobile(input.mobileNumber)) {
    throw ApiError.conflict('An account with this mobile number already exists.', {
      mobileNumber: 'This mobile number is already registered.',
    })
  }

  const passwordHash = await hashPassword(input.password)

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()

    let userId
    try {
      userId = await createUser({ ...input, passwordHash }, connection)
    } catch (error) {
      // Belt-and-suspenders against a race between the pre-checks above and
      // a concurrent signup with the same email/mobile landing first.
      if (error.code === 'ER_DUP_ENTRY') {
        throw ApiError.conflict('An account with this email or mobile number already exists.')
      }
      throw error
    }

    const session = await createSession(userId, connection)
    await connection.commit()

    const user = await findUserById(userId)
    logger.info(`signup: new account for ${mask(input.mobileNumber)}`)
    return { user: toPublicUser(user), session }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

export async function signin({ identifier, isEmail, password }) {
  const user = isEmail ? await findUserByEmail(identifier) : await findUserByMobile(identifier)
  // verifyPassword always runs, and always against a real bcrypt hash (a
  // precomputed dummy one when there's no user) — see auth/passwords.js —
  // so "no such account" and "wrong password" take the same time and return
  // the same message, and neither leaks which identifiers are registered.
  const passwordOk = await verifyPassword(password, user?.passwordHash)

  if (!user || !passwordOk) {
    throw ApiError.unauthorized('Incorrect email/mobile number or password.')
  }

  const session = await createSession(user.id)
  logger.info(`signin: ${mask(user.mobileNumber)}`)
  return { user: toPublicUser(user), session }
}

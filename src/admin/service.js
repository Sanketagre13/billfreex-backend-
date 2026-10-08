import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'
import { verifyPassword } from '../auth/passwords.js'
import { findAdminByEmail, recordAdminLogin, toPublicAdmin } from './repository.js'
import { createAdminSession } from './sessions.js'

export async function signinAdmin({ email, password }) {
  const admin = await findAdminByEmail(email)
  // Same timing-parity rule as user signin (see auth/passwords.js): always
  // run a real bcrypt compare, so an unknown email can't be told apart.
  const passwordOk = await verifyPassword(password, admin?.passwordHash)

  if (!admin || !passwordOk) {
    throw ApiError.unauthorized('Incorrect email or password.')
  }

  const session = await createAdminSession(admin.id)
  await recordAdminLogin(admin.id)
  logger.info(`admin signin: admin ${admin.id}`)
  return { admin: toPublicAdmin(admin), session }
}

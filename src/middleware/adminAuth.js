import { ApiError } from '../lib/ApiError.js'
import { readCookie } from '../lib/cookies.js'
import { config } from '../config.js'
import { findAdminSessionByToken, touchAdminSession } from '../admin/sessions.js'
import { findAdminById, toPublicAdmin } from '../admin/repository.js'

/** Attaches req.admin and req.adminSessionToken, or rejects with 401.
 *  Completely separate from requireAuth: a user session never grants admin. */
export async function requireAdmin(req, _res, next) {
  try {
    const token = readCookie(req, config.admin.cookieName)
    if (!token) throw ApiError.unauthorized('Please sign in to the admin panel.')

    const session = await findAdminSessionByToken(token)
    if (!session) throw ApiError.unauthorized('Your admin session has ended. Please sign in again.')

    const admin = await findAdminById(session.adminId)
    if (!admin) throw ApiError.unauthorized('Please sign in to the admin panel.')

    await touchAdminSession(session)

    req.admin = toPublicAdmin(admin)
    req.adminSessionToken = token
    next()
  } catch (error) {
    next(error)
  }
}

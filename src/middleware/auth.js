import { ApiError } from '../lib/ApiError.js'
import { readCookie } from '../lib/cookies.js'
import { config } from '../config.js'
import { findSessionByToken, touchSession } from '../auth/sessions.js'
import { findUserById, toPublicUser } from '../users/repository.js'

/** Attaches req.user and req.sessionToken, or rejects with 401. */
export async function requireAuth(req, _res, next) {
  try {
    const token = readCookie(req, config.session.cookieName)
    if (!token) throw ApiError.unauthorized()

    const session = await findSessionByToken(token)
    if (!session) throw ApiError.unauthorized()

    const user = await findUserById(session.userId)
    if (!user) throw ApiError.unauthorized()

    await touchSession(session)

    req.user = toPublicUser(user)
    req.sessionToken = token
    next()
  } catch (error) {
    next(error)
  }
}

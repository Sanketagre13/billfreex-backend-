import { Router } from 'express'
import { config } from '../config.js'
import { validateSignupRequest, validateSigninRequest } from '../lib/validate.js'
import { signup, signin } from '../auth/service.js'
import { setSessionCookie, clearSessionCookie, revokeSessionByToken } from '../auth/sessions.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = Router()

router.post(
  '/signup',
  rateLimit({
    name: 'signup',
    max: config.rateLimit.authMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: () => '-',
    message: 'Too many signup attempts from this connection. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const input = validateSignupRequest(req.body)
    const { user, session } = await signup(input)
    setSessionCookie(res, session.token, session.expiresAt)
    res.status(201).json({ user })
  },
)

router.post(
  '/signin',
  rateLimit({
    name: 'signin',
    max: config.rateLimit.authMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: (req) => (typeof req.body?.identifier === 'string' ? req.body.identifier.slice(0, 64) : '-'),
    message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const input = validateSigninRequest(req.body)
    const { user, session } = await signin(input)
    setSessionCookie(res, session.token, session.expiresAt)
    res.json({ user })
  },
)

router.post('/logout', requireAuth, async (req, res) => {
  await revokeSessionByToken(req.sessionToken)
  clearSessionCookie(res)
  res.json({ message: 'Signed out.' })
})

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user })
})

export default router

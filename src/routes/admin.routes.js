import { Router } from 'express'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import {
  validateAdminSigninRequest,
  validateAdminUsersQuery,
  validateAdminListQuery,
  validateIdParam,
  validateAdminForgotPasswordRequest,
  validateAdminResetPasswordRequest,
  validateAdminChangePasswordRequest,
} from '../lib/validate.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { signinAdmin } from '../admin/service.js'
import { requestAdminPasswordReset, resetAdminPassword, changeAdminPassword } from '../admin/passwords.js'
import { setAdminSessionCookie, clearAdminSessionCookie, revokeAdminSessionByToken } from '../admin/sessions.js'
import { listUsers, exportUsersWorkbook, USER_SORT_KEYS } from '../admin/users.js'
import { getDashboard } from '../admin/dashboard.js'
import {
  listCreditReports,
  getCreditReport,
  exportCreditReportsWorkbook,
  REPORT_SORT_KEYS,
  REPORT_RESULT_FILTERS,
} from '../admin/creditReports.js'

const router = Router()

// Every admin response can carry personal data — keep it out of any cache.
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

router.post(
  '/auth/signin',
  rateLimit({
    name: 'admin-signin',
    max: config.rateLimit.authMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: (req) => (typeof req.body?.email === 'string' ? req.body.email.slice(0, 64) : '-'),
    message: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const input = validateAdminSigninRequest(req.body)
    const { admin, session } = await signinAdmin(input)
    setAdminSessionCookie(res, session.token, session.expiresAt)
    res.json({ admin })
  },
)

router.post('/auth/logout', requireAdmin, async (req, res) => {
  await revokeAdminSessionByToken(req.adminSessionToken)
  clearAdminSessionCookie(res)
  res.json({ message: 'Signed out.' })
})

router.get('/auth/me', requireAdmin, (req, res) => {
  res.json({ admin: req.admin })
})

router.post(
  '/auth/forgot-password',
  rateLimit({
    name: 'admin-forgot-password',
    max: 5,
    windowMs: config.rateLimit.windowMs,
    keyFn: (req) => (typeof req.body?.email === 'string' ? req.body.email.slice(0, 64) : '-'),
    message: 'Too many reset requests. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const { email } = validateAdminForgotPasswordRequest(req.body)
    await requestAdminPasswordReset(email)
    // Same answer whether or not the address is an admin's.
    res.json({
      message: 'If that email belongs to an admin account, a reset link is on its way.',
      expiresInMinutes: config.admin.passwordResetTtlMinutes,
    })
  },
)

router.post(
  '/auth/reset-password',
  rateLimit({
    name: 'admin-reset-password',
    max: config.rateLimit.authMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: () => '-',
    message: 'Too many attempts. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const input = validateAdminResetPasswordRequest(req.body)
    await resetAdminPassword(input)
    // Every session for this admin was revoked — including this browser's, if any.
    clearAdminSessionCookie(res)
    res.json({ message: 'Your password has been reset. Sign in with your new password.' })
  },
)

router.post(
  '/auth/change-password',
  requireAdmin,
  rateLimit({
    name: 'admin-change-password',
    max: config.rateLimit.authMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: (req) => String(req.admin.id),
    message: 'Too many attempts. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const input = validateAdminChangePasswordRequest(req.body)
    await changeAdminPassword(req.admin, req.adminSessionToken, input)
    res.json({ message: 'Password changed. Any other sessions were signed out.' })
  },
)

router.get('/users', requireAdmin, async (req, res) => {
  const query = validateAdminUsersQuery(req.query, USER_SORT_KEYS)
  res.json(await listUsers(query))
})

// Shared by both exports: one bucket per admin across users + credit reports.
const exportLimit = rateLimit({
  name: 'admin-export',
  max: 20,
  windowMs: config.rateLimit.windowMs,
  keyFn: (req) => String(req.admin.id),
  message: 'Too many exports. Please wait a few minutes and try again.',
})

function sendWorkbook(res, name, buffer) {
  const date = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="billfreex-${name}-${date}.xlsx"`)
  res.send(buffer)
}

router.get('/users/export', requireAdmin, exportLimit, async (req, res) => {
  const { search, sort, order } = validateAdminUsersQuery(req.query, USER_SORT_KEYS)
  const { buffer, count } = await exportUsersWorkbook({ search, sort, order })

  // A bulk export of personal data — always leave a trail of who took it.
  logger.info(`admin export: admin ${req.admin.id} downloaded ${count} user(s)${search ? ' (filtered)' : ''}`)
  sendWorkbook(res, 'users', buffer)
})

router.get('/dashboard', requireAdmin, async (_req, res) => {
  res.json(await getDashboard())
})

const reportQuery = (query) =>
  validateAdminListQuery(query, {
    sortKeys: REPORT_SORT_KEYS,
    defaultSort: 'fetchedAt',
    resultFilters: REPORT_RESULT_FILTERS,
  })

router.get('/credit-reports', requireAdmin, async (req, res) => {
  res.json(await listCreditReports(reportQuery(req.query)))
})

// Registered before /:id so "export" is never read as a report id.
router.get('/credit-reports/export', requireAdmin, exportLimit, async (req, res) => {
  const { search, result, userId, sort, order } = reportQuery(req.query)
  const { buffer, count } = await exportCreditReportsWorkbook({ search, result, userId, sort, order })

  logger.info(
    `admin export: admin ${req.admin.id} downloaded ${count} credit report(s)` +
      `${search || result || userId ? ' (filtered)' : ''}`,
  )
  sendWorkbook(res, 'credit-reports', buffer)
})

router.get('/credit-reports/:id', requireAdmin, async (req, res) => {
  const id = validateIdParam(req.params.id, 'Credit report not found.')
  const report = await getCreditReport(id)
  // A full bureau report is the most sensitive thing the panel shows.
  logger.info(`admin report view: admin ${req.admin.id} opened credit report ${id}`)
  res.json({ report })
})

export default router

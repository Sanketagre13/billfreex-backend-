import { Router } from 'express'
import { config } from '../config.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { validateGetCreditRequest } from '../lib/validate.js'
import { sendCreditReportOtp, fetchCreditReport, getLatestCreditReport } from '../creditReports/service.js'

const router = Router()
router.use(requireAuth)

const perUser = (req) => String(req.user.id)

router.post(
  '/otp',
  rateLimit({
    name: 'credit-report-otp',
    max: config.rateLimit.creditReportMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: perUser,
    message: 'Too many OTP requests. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const result = await sendCreditReportOtp(req.user)
    res.json(result)
  },
)

router.post(
  '/fetch',
  rateLimit({
    name: 'credit-report-fetch',
    max: config.rateLimit.creditReportMax,
    windowMs: config.rateLimit.windowMs,
    keyFn: perUser,
    message: 'Too many credit report requests. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const { panNumber, otp } = validateGetCreditRequest(req.body)
    const result = await fetchCreditReport(req.user, { panNumber, otp })
    res.json(result)
  },
)

router.get('/latest', async (req, res) => {
  const report = await getLatestCreditReport(req.user)
  res.json({ report })
})

export default router

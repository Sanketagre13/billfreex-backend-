/**
 * Credit-check routes — the two CRIF calls behind the "Get Credit" button.
 *
 *   POST /api/v1/credit/otp    send the consent OTP
 *   POST /api/v1/credit/score  verify the OTP and pull the score
 *
 * Both are thin: validate, forward, normalise. No persistence — a bureau report
 * is sensitive enough that not storing it is the safest default, and nothing in
 * the flow needs it after the response is rendered.
 */
import { Router } from 'express'
import { config } from '../config.js'
import { sendConsentOtp, fetchScore } from '../crif/client.js'
import { validateOtpRequest, validateScoreRequest } from '../lib/validate.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { logger, mask } from '../lib/logger.js'

const router = Router()

/** Bare async handlers reject into Express 5's error pipeline automatically. */
router.post(
  '/otp',
  rateLimit({
    name: 'otp',
    max: config.rateLimit.otpMax,
    windowMs: config.rateLimit.windowMs,
    message: 'Too many OTP requests for this number. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const { mobileNumber } = validateOtpRequest(req.body)
    logger.info(`consent OTP requested for ${mask(mobileNumber)}`)

    const result = await sendConsentOtp({ mobileNumber })
    res.json({ sent: result.sent, message: result.message ?? 'OTP sent successfully.' })
  },
)

router.post(
  '/score',
  rateLimit({
    name: 'score',
    max: config.rateLimit.scoreMax,
    windowMs: config.rateLimit.windowMs,
    message: 'Too many score checks for this number. Please wait a few minutes and try again.',
  }),
  async (req, res) => {
    const applicant = validateScoreRequest(req.body)
    logger.info(`score fetch for ${mask(applicant.mobileNumber)}`)

    const result = await fetchScore(applicant)
    res.json({ message: result.message, data: result.data })
  },
)

export default router

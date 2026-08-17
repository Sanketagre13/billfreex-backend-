import { join } from 'node:path'

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'))
} catch (error) {

  if (error.code !== 'ENOENT') throw error
}

const required = ['CRIF_BASE_URL', 'CRIF_SERVICE_KEY', 'CRIF_AUTHORIZATION']

const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}. ` +
    'Copy backend/.env.example to backend/.env and fill it in.',
  )
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  env: process.env.NODE_ENV ?? 'development',

  crif: {
    baseUrl: process.env.CRIF_BASE_URL.replace(/\/+$/, ''),
    serviceKey: process.env.CRIF_SERVICE_KEY,
    authorization: process.env.CRIF_AUTHORIZATION,
    timeoutMs: Number(process.env.CRIF_TIMEOUT_MS ?? 45_000),
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    otpMax: Number(process.env.RATE_LIMIT_OTP_MAX ?? 5),
    scoreMax: Number(process.env.RATE_LIMIT_SCORE_MAX ?? 10),
  },
}

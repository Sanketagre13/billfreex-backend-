import { join } from 'node:path'

try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'))
} catch (error) {

  if (error.code !== 'ENOENT') throw error
}

const required = [
  'CRIF_BASE_URL',
  'CRIF_SERVICE_KEY',
  'CRIF_AUTHORIZATION',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'DATA_ENCRYPTION_KEY',
]

const missing = required.filter((key) => !process.env[key])
if (missing.length > 0) {
  throw new Error(
    `Missing required environment variable(s): ${missing.join(', ')}. ` +
    'Copy backend/.env.example to backend/.env and fill it in.',
  )
}

const isProd = (process.env.NODE_ENV ?? 'development') === 'production'
const crifTimeoutMs = Number(process.env.CRIF_TIMEOUT_MS ?? 45_000)

const encryptionKey = Buffer.from(process.env.DATA_ENCRYPTION_KEY, 'base64')
if (encryptionKey.length !== 32) {
  throw new Error(
    'DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  )
}

export const config = {
  port: Number(process.env.PORT ?? 5000),
  env: process.env.NODE_ENV ?? 'development',
  isProd,

  crif: {
    baseUrl: process.env.CRIF_BASE_URL.replace(/\/+$/, ''),
    serviceKey: process.env.CRIF_SERVICE_KEY,
    authorization: process.env.CRIF_AUTHORIZATION,
    timeoutMs: crifTimeoutMs,
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    otpMax: Number(process.env.RATE_LIMIT_OTP_MAX ?? 5),
    scoreMax: Number(process.env.RATE_LIMIT_SCORE_MAX ?? 10),
    authMax: Number(process.env.RATE_LIMIT_AUTH_MAX ?? 10),
    creditReportMax: Number(process.env.RATE_LIMIT_CREDIT_REPORT_MAX ?? 10),
  },

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT ?? 10),
  },

  encryptionKey,

  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'bfx_session',
    ttlDays: Number(process.env.SESSION_TTL_DAYS ?? 7),
    cookieSecure: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : isProd,
    cookieSameSite: process.env.COOKIE_SAMESITE ?? (isProd ? 'None' : 'Lax'),
  },

  creditReport: {
    cacheDays: 30,
    // Must comfortably exceed crif.timeoutMs, so a request waiting on the
    // per-user lock never gives up while the lock holder is still
    // legitimately mid-flight talking to the real bureau.
    lockTimeoutMs: Number(process.env.CREDIT_REPORT_LOCK_TIMEOUT_MS ?? crifTimeoutMs + 15_000),
  },
}

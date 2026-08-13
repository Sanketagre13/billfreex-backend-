/**
 * Environment configuration, validated once at boot.
 *
 * Failing here — loudly, before the server binds a port — is much better than
 * discovering a missing key on the first customer request, where it surfaces as
 * an opaque 401 from the bureau.
 */
import { join } from 'node:path'

/**
 * Load .env ourselves rather than depending on `node --env-file`.
 *
 * That flag only applies when the process is started through our own npm
 * script; `nodemon index.js`, `node index.js`, pm2 and IDE debuggers all launch
 * without it and the server dies on the check below. Doing it here means every
 * launcher behaves the same.
 *
 * The path is resolved from this file, not the working directory, so it is
 * found whether the server is started from backend/ or the repo root. Values
 * already present in the real environment win, which is what makes
 * `CRIF_BASE_URL=... node index.js` work for a one-off override — and what keeps
 * a production deployment's real config from being shadowed by a stray .env.
 */
try {
  process.loadEnvFile(join(import.meta.dirname, '..', '.env'))
} catch (error) {
  // Absent .env is fine: in production the variables come from the environment.
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
    // Trailing slashes would produce `//crifService/...` on join.
    baseUrl: process.env.CRIF_BASE_URL.replace(/\/+$/, ''),
    serviceKey: process.env.CRIF_SERVICE_KEY,
    authorization: process.env.CRIF_AUTHORIZATION,
    // The bureau pull routinely takes 10s+; the OTP send is fast. A single
    // generous ceiling is simpler than two, and the client shows a spinner.
    timeoutMs: Number(process.env.CRIF_TIMEOUT_MS ?? 45_000),
  },

  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    otpMax: Number(process.env.RATE_LIMIT_OTP_MAX ?? 5),
    scoreMax: Number(process.env.RATE_LIMIT_SCORE_MAX ?? 10),
  },
}

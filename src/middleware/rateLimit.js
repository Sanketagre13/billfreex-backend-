import { ApiError } from '../lib/ApiError.js'

const buckets = new Map()

const SWEEP_MS = 60_000
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}, SWEEP_MS).unref()

const defaultKeyFn = (req) =>
  typeof req.body?.mobileNumber === 'string' ? req.body.mobileNumber.slice(-10) : '-'

export function rateLimit({ name, max, windowMs, message, keyFn = defaultKeyFn }) {
  return (req, _res, next) => {

    const subject = keyFn(req) ?? '-'
    const key = `${name}:${req.ip}:${subject}`
    const now = Date.now()

    let bucket = buckets.get(key)
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs }
      buckets.set(key, bucket)
    }

    bucket.count += 1
    if (bucket.count > max) {
      const minutes = Math.max(1, Math.ceil((bucket.resetAt - now) / 60_000))
      return next(
        ApiError.tooManyRequests(message ?? `Too many attempts. Please try again in ${minutes} minute(s).`),
      )
    }

    next()
  }
}

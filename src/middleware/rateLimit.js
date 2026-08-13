/**
 * In-memory fixed-window rate limiter.
 *
 * Enough for a single-instance deployment, and the point is not DDoS defence —
 * it is that every OTP send costs money and every bureau pull is a hard credit
 * enquiry. Behind more than one instance, swap the Map for Redis; the interface
 * is one `hit()` call.
 */
import { ApiError } from '../lib/ApiError.js'

const buckets = new Map()

// Windows are short and traffic is low, so a periodic sweep is cheaper than
// tracking expiry per key. unref() so this timer never holds the process open.
const SWEEP_MS = 60_000
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}, SWEEP_MS).unref()

export function rateLimit({ name, max, windowMs, message }) {
  return (req, _res, next) => {
    // Key on the caller *and* the mobile number, so one IP cannot burn through
    // OTPs for many numbers, and one number cannot be targeted from many IPs.
    const subject = typeof req.body?.mobileNumber === 'string' ? req.body.mobileNumber.slice(-10) : '-'
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

/**
 * Request validation for the credit-check endpoints.
 *
 * The browser validates the same rules for fast feedback, but that copy is a
 * convenience — this one is the boundary. Anything reaching the bureau has been
 * through here.
 */
import { ApiError } from './ApiError.js'

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const MOBILE = /^[6-9]\d{9}$/
const PINCODE = /^[1-9]\d{5}$/
const OTP = /^\d{6}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
// Bureau name matching is on letters only; digits and symbols are a sure reject.
const NAME = /^[A-Za-z][A-Za-z .'-]{1,99}$/

const str = (value) => (typeof value === 'string' ? value.trim() : '')

/** Collects every field failure so the form can highlight them all at once. */
class Checker {
  #fields = {}
  #body

  constructor(body) {
    this.#body = body && typeof body === 'object' ? body : {}
  }

  /** @returns the cleaned value, or '' when the field failed. */
  check(name, { required = true, transform, pattern, message, validate } = {}) {
    let value = str(this.#body[name])

    if (!value) {
      if (required) this.#fields[name] = 'This field is required.'
      return ''
    }

    if (transform) value = transform(value)
    if (pattern && !pattern.test(value)) {
      this.#fields[name] = message
      return ''
    }
    const custom = validate?.(value)
    if (custom) {
      this.#fields[name] = custom
      return ''
    }

    return value
  }

  settle(result) {
    const failed = Object.keys(this.#fields)
    if (failed.length > 0) {
      throw ApiError.badRequest('Please correct the highlighted fields.', this.#fields)
    }
    return result
  }
}

const upper = (v) => v.toUpperCase()
const collapseSpaces = (v) => v.replace(/\s+/g, ' ')

/** A date that is real (not 2024-02-31), in the past, and 18–100 years ago. */
function validateDob(value) {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return 'Enter a valid date.'
  }

  const now = new Date()
  let age = now.getUTCFullYear() - y
  // Not yet had this year's birthday.
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1

  if (age < 18) return 'You must be at least 18 years old.'
  if (age > 100) return 'Enter a valid date of birth.'
  return null
}

export function validateOtpRequest(body) {
  const checker = new Checker(body)
  const mobileNumber = checker.check('mobileNumber', {
    transform: (v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)/, ''),
    pattern: MOBILE,
    message: 'Enter a valid 10-digit Indian mobile number.',
  })

  return checker.settle({ mobileNumber })
}

export function validateScoreRequest(body) {
  const checker = new Checker(body)

  const result = {
    panNumber: checker.check('panNumber', {
      transform: upper,
      pattern: PAN,
      message: 'Enter a valid PAN, e.g. ABCDE1234F.',
    }),
    fullName: checker.check('fullName', {
      transform: (v) => collapseSpaces(v).toUpperCase(),
      pattern: NAME,
      message: 'Enter your name as printed on your PAN card.',
    }),
    mobileNumber: checker.check('mobileNumber', {
      transform: (v) => v.replace(/[\s-]/g, '').replace(/^(\+91|91|0)/, ''),
      pattern: MOBILE,
      message: 'Enter a valid 10-digit Indian mobile number.',
    }),
    email: checker.check('email', {
      transform: (v) => v.toLowerCase(),
      pattern: EMAIL,
      message: 'Enter a valid email address.',
    }),
    dob: checker.check('dob', {
      pattern: ISO_DATE,
      message: 'Enter your date of birth.',
      validate: validateDob,
    }),
    pincode: checker.check('pincode', {
      pattern: PINCODE,
      message: 'Enter a valid 6-digit PIN code.',
    }),
    stateName: checker.check('stateName', {
      transform: (v) => collapseSpaces(v).toUpperCase(),
      validate: (v) => (v.length < 2 ? 'Select your state.' : null),
    }),
    cityName: checker.check('cityName', {
      transform: collapseSpaces,
      validate: (v) => (v.length < 2 ? 'Enter your city.' : null),
    }),
    addressLine1: checker.check('addressLine1', {
      transform: collapseSpaces,
      validate: (v) => (v.length < 3 ? 'Enter your address.' : null),
    }),
    // The bureau requires the key to be present; an empty second line is normal.
    addressLine2: checker.check('addressLine2', {
      required: false,
      transform: collapseSpaces,
    }),
    otp: checker.check('otp', {
      transform: (v) => v.replace(/\s/g, ''),
      pattern: OTP,
      message: 'Enter the OTP sent to your mobile.',
    }),
  }

  // Consent is a regulatory gate, not a form field: without an explicit yes we
  // must not call the bureau at all.
  if (body?.customerConsent !== 'Y' && body?.customerConsent !== true) {
    throw ApiError.badRequest(
      'We need your consent before we can check your credit score.',
      { customerConsent: 'Please accept the consent declaration to continue.' },
    )
  }

  return checker.settle(result)
}

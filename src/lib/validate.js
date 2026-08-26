import { ApiError } from './ApiError.js'
import { INDIAN_STATES_SET } from './states.js'

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const MOBILE = /^[6-9]\d{9}$/
const PINCODE = /^[1-9]\d{5}$/
const OTP = /^\d{6}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const NAME = /^[A-Za-z][A-Za-z .'-]{1,99}$/

const PASSWORD_MIN_LENGTH = 8
// bcrypt silently ignores bytes past 72 — anything longer would validate
// locally but never actually be checked in full, so reject it up front.
const PASSWORD_MAX_BYTES = 72
const HAS_LETTER = /[A-Za-z]/
const HAS_DIGIT = /\d/

const str = (value) => (typeof value === 'string' ? value.trim() : '')

class Checker {
  #fields = {}
  #body

  constructor(body) {
    this.#body = body && typeof body === 'object' ? body : {}
  }

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

  /** Records a field error computed outside check() (e.g. password — see
   *  validatePassword's own comment on why it can't go through check()). */
  fail(name, message) {
    this.#fields[name] = message
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

/**
 * Strips a "+91"/"91" country code or a leading trunk "0" — but only when the
 * digit count proves one is actually present (12 digits for a 91-prefixed
 * number, 11 for a 0-prefixed one). A naive `replace(/^(91|0)/, '')` would
 * also mangle any genuine 10-digit number that happens to start with "91"
 * (e.g. 9123456780 — a real, valid range) into an 8-digit fragment.
 */
function normalizeMobile(value) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1)
  return digits
}

function validateDob(value) {
  const [y, m, d] = value.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return 'Enter a valid date.'
  }

  const now = new Date()
  let age = now.getUTCFullYear() - y
  if (now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d)) age -= 1

  if (age < 18) return 'You must be at least 18 years old.'
  if (age > 100) return 'Enter a valid date of birth.'
  return null
}

/**
 * Validated outside the Checker deliberately: Checker's str() unconditionally
 * trims every field, which is wrong for a password (a leading/trailing space
 * a user actually typed would silently stop being reproducible).
 */
function validatePassword(value) {
  if (typeof value !== 'string' || value.length === 0) return 'Enter a password.'
  if (Buffer.byteLength(value, 'utf8') > PASSWORD_MAX_BYTES) return 'Password is too long.'
  if (value.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
  if (!HAS_LETTER.test(value) || !HAS_DIGIT.test(value)) {
    return 'Password must include at least one letter and one number.'
  }
  return null
}

export function validateSignupRequest(body) {
  const checker = new Checker(body)

  const result = {
    fullName: checker.check('fullName', {
      transform: collapseSpaces,
      pattern: NAME,
      message: 'Enter your full name.',
    }),
    email: checker.check('email', {
      transform: (v) => v.toLowerCase(),
      pattern: EMAIL,
      message: 'Enter a valid email address.',
    }),
    mobileNumber: checker.check('mobileNumber', {
      transform: normalizeMobile,
      pattern: MOBILE,
      message: 'Enter a valid 10-digit Indian mobile number.',
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
    city: checker.check('city', {
      transform: collapseSpaces,
      validate: (v) => (v.length < 2 ? 'Enter your city.' : null),
    }),
    state: checker.check('state', {
      transform: upper,
      validate: (v) => (INDIAN_STATES_SET.has(v) ? null : 'Select a valid state.'),
    }),
    addressLine1: checker.check('addressLine1', {
      transform: collapseSpaces,
      validate: (v) => (v.length < 3 ? 'Enter your address.' : null),
    }),
    addressLine2: checker.check('addressLine2', {
      required: false,
      transform: collapseSpaces,
    }),
  }

  const passwordError = validatePassword(body?.password)
  if (passwordError) checker.fail('password', passwordError)

  return checker.settle({ ...result, password: body.password })
}

export function validateSigninRequest(body) {
  const identifier = str(body?.identifier)
  const password = typeof body?.password === 'string' ? body.password : ''

  const fields = {}
  if (!identifier) fields.identifier = 'Enter your email or mobile number.'
  if (!password) fields.password = 'Enter your password.'
  if (Object.keys(fields).length > 0) {
    throw ApiError.badRequest('Please correct the highlighted fields.', fields)
  }

  const isEmail = identifier.includes('@')
  return {
    identifier: isEmail ? identifier.toLowerCase() : normalizeMobile(identifier),
    isEmail,
    password,
  }
}

export function validateGetCreditRequest(body) {
  const checker = new Checker(body)

  const result = {
    panNumber: checker.check('panNumber', {
      transform: upper,
      pattern: PAN,
      message: 'Enter a valid PAN, e.g. ABCDE1234F.',
    }),
    otp: checker.check('otp', {
      transform: (v) => v.replace(/\s/g, ''),
      pattern: OTP,
      message: 'Enter the OTP sent to your mobile.',
    }),
  }

  if (body?.consent !== true) {
    throw ApiError.badRequest(
      'We need your consent before we can fetch your credit report.',
      { consent: 'Please accept the authorization to continue.' },
    )
  }

  return checker.settle(result)
}

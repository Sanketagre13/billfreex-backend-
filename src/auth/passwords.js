import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 12

/**
 * A precomputed hash of no real password, compared against on the "no such
 * user" path of signin. Without this, "identifier not found" returns
 * immediately while "wrong password" waits on a real bcrypt.compare (tens of
 * milliseconds) — that timing gap alone would leak which identifiers exist,
 * even though both paths return the same error message.
 */
const DUMMY_HASH = bcrypt.hashSync('billfreex-dummy-password-for-timing-parity', SALT_ROUNDS)

export function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash ?? DUMMY_HASH)
}

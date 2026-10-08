/**
 * Creates an admin panel account, or resets an existing admin's password.
 * There is deliberately no HTTP route for this — only someone with shell
 * access to the backend (and its .env) can mint admins.
 *
 *   npm run create-admin -- <email> "<Full name>"   create a new admin
 *   npm run create-admin -- <email> --reset         new password, sign out everywhere
 *
 * The password is generated, not chosen, and printed exactly once. The admin
 * can replace it after signing in (Change password), and an admin who still
 * has their mailbox can recover access themselves via "Forgot password?" —
 * --reset is the fallback for when email isn't an option.
 */
import { randomBytes } from 'node:crypto'
import '../src/config.js'
import { runMigrations } from '../src/db/migrate.js'
import { pool } from '../src/db/pool.js'
import { hashPassword } from '../src/auth/passwords.js'
import {
  createAdmin,
  findAdminByEmail,
  updateAdminPassword,
  deletePasswordResets,
} from '../src/admin/repository.js'
import { revokeAllAdminSessions } from '../src/admin/sessions.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const USAGE =
  'Usage:\n' +
  '  npm run create-admin -- <email> "<Full name>"   create a new admin\n' +
  '  npm run create-admin -- <email> --reset         reset an admin\'s password'

const [rawEmail, second] = process.argv.slice(2)
const email = rawEmail?.trim().toLowerCase()
const reset = second === '--reset'
const fullName = reset ? null : second?.replace(/\s+/g, ' ').trim()

function fail(message) {
  console.error(`${message}\n\n${USAGE}`)
  process.exitCode = 1
}

async function main() {
  if (!email || !EMAIL.test(email)) return fail('A valid email is required.')
  if (!reset && !fullName) return fail('A full name is required when creating an admin.')

  await runMigrations()

  // 18 random bytes → 24 base64url characters (~144 bits).
  const password = randomBytes(18).toString('base64url')
  const passwordHash = await hashPassword(password)
  const existing = await findAdminByEmail(email)

  if (reset) {
    if (!existing) return fail(`No admin with email ${email}.`)
    await updateAdminPassword(existing.id, passwordHash)
    await deletePasswordResets(existing.id)
    await revokeAllAdminSessions(existing.id)
    console.log(`Password reset for ${email}. All of their admin sessions were signed out.`)
  } else {
    if (existing) return fail(`An admin with email ${email} already exists. Use --reset to change the password.`)
    await createAdmin({ email, fullName, passwordHash })
    console.log(`Admin created: ${fullName} <${email}>`)
  }

  console.log(`\n  Password: ${password}\n\nStore it in a password manager now — it will not be shown again.`)
}

try {
  await main()
} catch (error) {
  console.error(`Failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}

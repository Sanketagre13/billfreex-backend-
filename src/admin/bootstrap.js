import { config } from '../config.js'
import { logger } from '../lib/logger.js'
import { isValidEmail, adminPasswordError } from '../lib/validate.js'
import { hashPassword } from '../auth/passwords.js'
import { createAdmin, findAdminByEmail } from './repository.js'

/**
 * Creates the admin named by ADMIN_EMAIL / ADMIN_PASSWORD on startup, if no
 * admin with that email exists yet. It only ever creates — it never updates
 * an existing admin — because the password may since have been changed in
 * the panel or reset by email, and a restart must not silently undo that.
 *
 * Never fatal: a bad value here is logged, and the API (customer site
 * included) still starts.
 */
export async function ensureBootstrapAdmin() {
  const { bootstrapEmail: email, bootstrapPassword: password, bootstrapName: fullName } = config.admin
  if (!email && !password) return

  if (!email || !password) {
    logger.warn('Admin bootstrap skipped: set both ADMIN_EMAIL and ADMIN_PASSWORD in .env')
    return
  }
  if (!isValidEmail(email)) {
    logger.error('Admin bootstrap skipped: ADMIN_EMAIL is not a valid email address')
    return
  }

  const existing = await findAdminByEmail(email)
  if (existing) {
    logger.warn(
      `Admin bootstrap: admin ${existing.id} (ADMIN_EMAIL) already exists, so ADMIN_PASSWORD is ignored. ` +
        'Remove ADMIN_PASSWORD from .env; change the password from the admin panel instead.',
    )
    return
  }

  const passwordError = adminPasswordError(password)
  if (passwordError) {
    logger.error(`Admin bootstrap skipped: ADMIN_PASSWORD is too weak — ${passwordError}`)
    return
  }

  try {
    await createAdmin({ email, fullName, passwordHash: await hashPassword(password) })
  } catch (error) {
    // Another instance starting at the same moment created it first.
    if (error.code === 'ER_DUP_ENTRY') return
    throw error
  }
  logger.info(
    'Admin bootstrap: created the admin from ADMIN_EMAIL. Sign in, change the password, ' +
      'then remove ADMIN_PASSWORD from .env.',
  )
}

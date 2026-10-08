import { createApp } from './src/app.js'
import { config } from './src/config.js'
import { logger } from './src/lib/logger.js'
import { runMigrations } from './src/db/migrate.js'
import { ensureBootstrapAdmin } from './src/admin/bootstrap.js'

try {
  await runMigrations()
} catch (error) {
  // Idempotent by design (see src/db/migrate.js) — a failure here means the
  // schema is genuinely broken, so refuse to serve traffic against it.
  logger.error('Startup migrations failed — refusing to start', error)
  process.exit(1)
}

try {
  await ensureBootstrapAdmin()
} catch (error) {
  logger.error('Admin bootstrap from ADMIN_EMAIL/ADMIN_PASSWORD failed', error)
}

const server = createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`Server running on port ${config.port}`)
  logger.info(`CRIF upstream: ${config.crif.baseUrl}`)
  if (!config.email.resendApiKey) {
    if (config.isProd) logger.error('RESEND_API_KEY is not set — admin password reset emails will fail')
    else logger.warn('RESEND_API_KEY is not set — emails will be printed to this console instead of sent')
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info(`${signal} received — shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}

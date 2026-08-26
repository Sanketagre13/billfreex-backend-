import { createApp } from './src/app.js'
import { config } from './src/config.js'
import { logger } from './src/lib/logger.js'
import { runMigrations } from './src/db/migrate.js'

try {
  await runMigrations()
} catch (error) {
  // Idempotent by design (see src/db/migrate.js) — a failure here means the
  // schema is genuinely broken, so refuse to serve traffic against it.
  logger.error('Startup migrations failed — refusing to start', error)
  process.exit(1)
}

const server = createApp().listen(config.port, '0.0.0.0', () => {
  console.log(`Server running on port ${config.port}`)
  logger.info(`CRIF upstream: ${config.crif.baseUrl}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info(`${signal} received — shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}

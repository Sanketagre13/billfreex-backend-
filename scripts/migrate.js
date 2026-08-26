import '../src/config.js'
import { runMigrations } from '../src/db/migrate.js'
import { logger } from '../src/lib/logger.js'
import { pool } from '../src/db/pool.js'

try {
  await runMigrations()
  logger.info('Migrations complete.')
} catch (error) {
  logger.error('Migration failed', error)
  process.exitCode = 1
} finally {
  await pool.end()
}

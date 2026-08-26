import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pool } from './pool.js'
import { logger } from '../lib/logger.js'

const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'migrations')
const LOCK_NAME = 'billfreex_migrations'
const LOCK_TIMEOUT_SECONDS = 30

async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_schema_migrations_filename (filename)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
}

/**
 * Applies every .sql file in migrations/ not yet recorded in
 * schema_migrations, in filename order. Idempotent: safe to call on every
 * boot and from concurrent instances, since a MySQL named lock (tied to this
 * connection's session) serializes runners and each file is only ever
 * applied once.
 *
 * DDL statements (CREATE TABLE, etc.) implicitly commit in MySQL, so a
 * migration file is not a real transaction boundary — keep one logical
 * change per file, same as any MySQL migration tool.
 */
export async function runMigrations() {
  const connection = await pool.getConnection()
  try {
    const [[lockResult]] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [
      LOCK_NAME,
      LOCK_TIMEOUT_SECONDS,
    ])
    if (lockResult.acquired !== 1) {
      throw new Error('Could not acquire migration lock — another instance may be migrating.')
    }

    try {
      await ensureMigrationsTable(connection)

      const [rows] = await connection.query('SELECT filename FROM schema_migrations')
      const applied = new Set(rows.map((row) => row.filename))

      const files = (await readdir(MIGRATIONS_DIR))
        .filter((name) => name.endsWith('.sql'))
        .sort()

      for (const file of files) {
        if (applied.has(file)) continue

        const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
        logger.info(`Applying migration ${file}`)
        await connection.query(sql)
        await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [file])
      }
    } finally {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME])
      } catch (error) {
        logger.error('Failed to release migration lock', error)
      }
    }
  } finally {
    connection.release()
  }
}

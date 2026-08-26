import mysql from 'mysql2/promise'
import { config } from '../config.js'
import { logger } from '../lib/logger.js'

/**
 * timezone: 'Z' forces DATETIME/TIMESTAMP to be read and written as UTC on
 * the *driver* side, regardless of the MySQL server's own session timezone.
 * dateStrings: ['DATE'] keeps DATE columns (dob) as plain 'YYYY-MM-DD'
 * strings instead of being parsed into a JS Date — a calendar date has no
 * timezone, so letting the driver round-trip it through Date would risk
 * shifting it by a day.
 */
export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: ['DATE'],
})

/**
 * `timezone: 'Z'` above only controls how the driver interprets values
 * *coming back* from MySQL — it does nothing to what MySQL itself computes
 * for NOW() / CURRENT_TIMESTAMP. If the server's own session timezone isn't
 * UTC (e.g. a `time_zone=SYSTEM` server running on an IST host), every
 * `DEFAULT CURRENT_TIMESTAMP` column — created_at, updated_at — gets written
 * as local wall-clock time and then misread as if it already were UTC.
 * Setting the session's own time_zone here, once per physical connection,
 * makes MySQL's clock genuinely UTC too, so both sides agree.
 */
pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'", (error) => {
    if (error) logger.error('Failed to set UTC session time zone on new DB connection', error)
  })
})

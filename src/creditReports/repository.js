import { pool } from '../db/pool.js'
import { encrypt, decrypt } from '../lib/crypto.js'

export async function insertCreditReport(
  { userId, panNumber, reportData, score, bureauStatus, displayId, fetchedAt },
  conn = pool,
) {
  await conn.execute(
    `INSERT INTO credit_reports
      (user_id, pan_number_encrypted, report_data_encrypted, score, bureau_status, crif_display_id, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      encrypt(panNumber),
      encrypt(JSON.stringify(reportData ?? null)),
      Number.isFinite(score) ? score : null,
      bureauStatus ?? null,
      displayId ?? null,
      fetchedAt,
    ],
  )
}

/** Most recent report for a user, or null. Pass a checked-out connection to
 *  read inside a lock/transaction; otherwise reads from the pool. */
export async function findLatestReportRow(userId, conn = pool) {
  const [rows] = await conn.execute(
    `SELECT report_data_encrypted AS reportDataEncrypted, score, bureau_status AS bureauStatus,
            crif_display_id AS crifDisplayId, fetched_at AS fetchedAt
     FROM credit_reports WHERE user_id = ? ORDER BY fetched_at DESC LIMIT 1`,
    [userId],
  )
  return rows[0] ?? null
}

export function decryptReportData(row) {
  return JSON.parse(decrypt(row.reportDataEncrypted))
}

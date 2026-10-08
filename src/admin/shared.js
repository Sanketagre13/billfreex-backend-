/**
 * Pieces every admin data view shares, so "Score found" means exactly the
 * same thing on the dashboard, in the users table, in the credit reports
 * table and in both spreadsheet exports.
 */

export const MIN_SCORE = 300

/** CRIF stores a notHit with score "-1" — that's a sentinel, not a score. */
export const hasScore = (score, bureauStatus) => score != null && score >= MIN_SCORE && bureauStatus !== 'notHit'

/** The bureau's raw status, as the sentence an admin needs. */
export function creditResult(score, bureauStatus) {
  if (hasScore(score, bureauStatus)) return 'Score found'
  if (bureauStatus === 'notHit') return 'No credit history'
  return bureauStatus ?? 'Unknown'
}

/** SQL for the same rule, against a table aliased `alias`. */
export const hitSql = (alias) =>
  `(${alias}.score >= ${MIN_SCORE} AND (${alias}.bureau_status IS NULL OR ${alias}.bureau_status <> 'notHit'))`

/** A LIKE pattern matching `search` anywhere, with LIKE's own wildcards escaped. */
export const likePattern = (search) => `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

// --- Spreadsheet cells (write-excel-file) ----------------------------------

// Excel dates carry no time zone. Shift UTC instants to India wall-clock time
// so a timestamp reads the same in the sheet as it does in the admin panel.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000

export const cells = {
  header: (value) => ({ value, fontWeight: 'bold', backgroundColor: '#FFE4D4' }),

  // '@' marks the cell as Text, so Excel doesn't reformat mobile numbers or
  // PIN codes as numbers. Every user-entered value is written as a string
  // cell, never a formula, so a value like "=HYPERLINK(...)" can't execute.
  text: (value) => (value ? { value: String(value), type: String, format: '@' } : null),

  number: (value) => (value == null ? null : { value, type: Number }),

  rupees: (value) => (value == null ? null : { value, type: Number, format: '[$₹-4009]#,##,##0' }),

  istDateTime: (date) =>
    date ? { value: new Date(date.getTime() + IST_OFFSET_MS), type: Date, format: 'dd-mmm-yyyy hh:mm' } : null,

  calendarDate(isoDate) {
    if (!isoDate) return null
    const [year, month, day] = isoDate.split('-').map(Number)
    return { value: new Date(Date.UTC(year, month - 1, day)), type: Date, format: 'dd-mmm-yyyy' }
  },
}

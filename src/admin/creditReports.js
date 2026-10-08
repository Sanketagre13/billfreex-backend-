import writeExcelFile from 'write-excel-file/node'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'
import { decryptReportData } from '../creditReports/repository.js'
import { cells, creditResult, hasScore, hitSql, likePattern } from './shared.js'

/**
 * Every credit report ever pulled from CRIF, with who pulled it.
 *
 * Report bodies are encrypted at rest, so anything inside the bureau payload
 * (report ID, accounts, balances…) can't be searched or sorted in SQL — only
 * the plaintext columns can: user fields, score, status, display ID, date.
 * Bodies are decrypted per row only for the rows actually returned.
 */

const SORTS = {
  id: 'cr.id',
  fetchedAt: 'cr.fetched_at',
  score: 'cr.score',
  name: 'u.full_name',
}
export const REPORT_SORT_KEYS = Object.keys(SORTS)

const RESULT_FILTERS = {
  scoreFound: hitSql('cr'),
  noHistory: "cr.bureau_status = 'notHit'",
}
export const REPORT_RESULT_FILTERS = Object.keys(RESULT_FILTERS)

const COLUMNS = `
  cr.id, cr.user_id AS userId, u.full_name AS fullName, u.email, u.mobile_number AS mobileNumber,
  cr.score, cr.bureau_status AS bureauStatus, cr.crif_display_id AS displayId,
  cr.fetched_at AS fetchedAt, cr.report_data_encrypted AS reportDataEncrypted
`
const FROM = 'FROM credit_reports cr JOIN users u ON u.id = cr.user_id'

function whereClause({ search, result, userId }) {
  const conditions = []
  const params = []
  if (search) {
    const like = likePattern(search)
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.mobile_number LIKE ? OR cr.crif_display_id LIKE ?)')
    params.push(like, like, like, like)
  }
  if (result) conditions.push(RESULT_FILTERS[result])
  if (userId) {
    conditions.push('cr.user_id = ?')
    params.push(userId)
  }
  return { sql: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const orderBy = (sort, order) => `ORDER BY ${SORTS[sort]} ${order}, cr.id ${order}`

const clean = (value) => (typeof value === 'string' ? value.trim() : value) || null
const count = (value) => (Number.isFinite(Number(value)) && value !== '' && value != null ? Number(value) : null)
const amount = (value) => count(typeof value === 'string' ? value.replace(/,/g, '') : value)
const normaliseName = (name) => (name ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

/** The handful of figures an admin scans for, pulled out of the bureau
 *  payload — the shape shown in CRIF's score/fetch response:
 *  { score, status, displayId, data: { b2CReport: { header, request, accountsSummary, … } } } */
export function summarizeReport(payload) {
  const report = payload?.data?.b2CReport ?? {}
  const header = report.header ?? {}
  const derived = report.accountsSummary?.derivedAttributes ?? {}
  const primary = report.accountsSummary?.primaryAccountsSummary ?? {}

  return {
    reportId: clean(header.reportId),
    bureauDate: clean(header.dateOfIssue) ?? clean(header.dateOfRequest),
    nameOnReport: clean(report.request?.name),
    totalAccounts: count(primary.primaryNumberOfAccounts),
    activeAccounts: count(primary.primaryActiveNumberOfAccounts),
    overdueAccounts: count(primary.primaryOverdueNumberOfAccounts),
    currentBalance: amount(primary.primaryCurrentBalance),
    sanctionedAmount: amount(primary.primarySanctionedAmount),
    enquiries6m: count(derived.inquriesInLastSixMonths),
    historyYears: count(derived.lengthOfCreditHistoryYear),
    historyMonths: count(derived.lengthOfCreditHistoryMonth),
  }
}

function readPayload(row, reportDataEncrypted) {
  try {
    return decryptReportData({ reportDataEncrypted })
  } catch (error) {
    // One unreadable row (e.g. written under a rotated key) shouldn't take the
    // whole table down — it just shows up without bureau details.
    logger.error(`credit report ${row.id} could not be decrypted`, error)
    return null
  }
}

function present({ reportDataEncrypted, ...row }) {
  const payload = readPayload(row, reportDataEncrypted)
  const summary = summarizeReport(payload)
  return {
    ...row,
    score: hasScore(row.score, row.bureauStatus) ? row.score : null,
    creditResult: creditResult(row.score, row.bureauStatus),
    ...summary,
    // The bureau matched the file by PAN; a different name on it is worth a
    // second look (and is how CRIF's staging fixture gives itself away).
    nameMismatch: Boolean(summary.nameOnReport) && normaliseName(summary.nameOnReport) !== normaliseName(row.fullName),
    payload,
  }
}

const withoutPayload = ({ payload, ...row }) => row

export async function listCreditReports({ search, result, userId, sort, order, page, pageSize }) {
  const where = whereClause({ search, result, userId })
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${FROM} ${where.sql}`, where.params)
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} ${FROM} ${where.sql} ${orderBy(sort, order)} LIMIT ? OFFSET ?`,
    [...where.params, pageSize, (page - 1) * pageSize],
  )
  return { reports: rows.map((row) => withoutPayload(present(row))), total, page, pageSize }
}

/** A printable report can be a large base64 document; it isn't rendered in
 *  the panel, so it's replaced by its size rather than shipped. */
function withoutPrintableContent(payload) {
  const report = payload?.data?.b2CReport
  const content = report?.printableReport?.content
  if (!content) return payload
  return {
    ...payload,
    data: {
      ...payload.data,
      b2CReport: {
        ...report,
        printableReport: { ...report.printableReport, content: `[${content.length.toLocaleString('en-IN')} characters omitted]` },
      },
    },
  }
}

export async function getCreditReport(id) {
  const [rows] = await pool.query(
    `SELECT ${COLUMNS}, u.dob, u.city, u.state, u.pincode ${FROM} WHERE cr.id = ? LIMIT 1`,
    [id],
  )
  if (rows.length === 0) throw ApiError.notFound('Credit report not found.')

  const { dob, city, state, pincode, ...row } = rows[0]
  const report = present(row)
  return {
    ...report,
    user: { id: row.userId, fullName: row.fullName, email: row.email, mobileNumber: row.mobileNumber, dob, city, state, pincode },
    payload: withoutPrintableContent(report.payload),
  }
}

const { header, text, number, rupees, istDateTime } = cells
const history = (r) =>
  r.historyYears == null && r.historyMonths == null ? null : `${r.historyYears ?? 0}y ${r.historyMonths ?? 0}m`

const EXPORT_COLUMNS = [
  { header: header('Report #'), cell: (r) => number(r.id), width: 10 },
  { header: header('Fetched (IST)'), cell: (r) => istDateTime(r.fetchedAt), width: 19 },
  { header: header('User ID'), cell: (r) => number(r.userId), width: 9 },
  { header: header('Full name'), cell: (r) => text(r.fullName), width: 24 },
  { header: header('Email'), cell: (r) => text(r.email), width: 30 },
  { header: header('Mobile'), cell: (r) => text(r.mobileNumber), width: 13 },
  { header: header('Credit result'), cell: (r) => text(r.creditResult), width: 18 },
  { header: header('Score'), cell: (r) => number(r.score), width: 9 },
  { header: header('Name on report'), cell: (r) => text(r.nameOnReport), width: 24 },
  { header: header('Name differs from profile'), cell: (r) => text(r.nameMismatch ? 'Yes' : 'No'), width: 14 },
  { header: header('Total accounts'), cell: (r) => number(r.totalAccounts), width: 10 },
  { header: header('Active accounts'), cell: (r) => number(r.activeAccounts), width: 10 },
  { header: header('Overdue accounts'), cell: (r) => number(r.overdueAccounts), width: 10 },
  { header: header('Current balance'), cell: (r) => rupees(r.currentBalance), width: 16 },
  { header: header('Sanctioned amount'), cell: (r) => rupees(r.sanctionedAmount), width: 16 },
  { header: header('Enquiries (6 mo)'), cell: (r) => number(r.enquiries6m), width: 10 },
  { header: header('Credit history'), cell: (r) => text(history(r)), width: 12 },
  { header: header('CRIF display ID'), cell: (r) => text(r.displayId), width: 28 },
  { header: header('CRIF report ID'), cell: (r) => text(r.reportId), width: 24 },
  { header: header('Bureau date'), cell: (r) => text(r.bureauDate), width: 19 },
]

export async function exportCreditReportsWorkbook({ search, result, userId, sort, order }) {
  const where = whereClause({ search, result, userId })
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} ${FROM} ${where.sql} ${orderBy(sort, order)} LIMIT ?`,
    [...where.params, config.admin.exportMaxRows],
  )
  const reports = rows.map(present)

  const buffer = await writeExcelFile(reports, {
    columns: EXPORT_COLUMNS,
    sheet: 'Credit reports',
    stickyRowsCount: 1,
  }).toBuffer()

  return { buffer, count: reports.length }
}

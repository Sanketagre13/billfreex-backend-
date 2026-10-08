import writeExcelFile from 'write-excel-file/node'
import { pool } from '../db/pool.js'
import { config } from '../config.js'
import { cells, creditResult, hasScore, likePattern } from './shared.js'

/** Sort keys the admin table may ask for, mapped to trusted SQL. Anything
 *  not listed here never reaches the ORDER BY. */
const SORTS = {
  id: 'u.id',
  name: 'u.full_name',
  email: 'u.email',
  city: 'u.city',
  state: 'u.state',
  joined: 'u.created_at',
  score: 'cr.score',
  lastReport: 'cr.fetched_at',
}
export const USER_SORT_KEYS = Object.keys(SORTS)

// Each user's latest credit report, plus how many they've pulled in total.
const LATEST_REPORT_JOIN = `
  LEFT JOIN (
    SELECT user_id, score, bureau_status, fetched_at,
           COUNT(*) OVER (PARTITION BY user_id) AS report_count,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY fetched_at DESC, id DESC) AS rn
    FROM credit_reports
  ) cr ON cr.user_id = u.id AND cr.rn = 1
`

// PAN is deliberately absent: it's encrypted at rest and stays out of both
// the admin table and the spreadsheet export.
const COLUMNS = `
  u.id, u.full_name AS fullName, u.email, u.mobile_number AS mobileNumber, u.dob,
  u.address_line1 AS addressLine1, u.address_line2 AS addressLine2,
  u.city, u.state, u.pincode, u.created_at AS createdAt,
  COALESCE(cr.report_count, 0) AS reportCount, cr.score AS latestScore,
  cr.bureau_status AS latestBureauStatus, cr.fetched_at AS lastReportAt
`

function whereClause(search) {
  if (!search) return { sql: '', params: [] }
  const like = likePattern(search)
  const fields = ['u.full_name', 'u.email', 'u.mobile_number', 'u.city', 'u.state', 'u.pincode']
  return {
    sql: `WHERE (${fields.map((field) => `${field} LIKE ?`).join(' OR ')})`,
    params: fields.map(() => like),
  }
}

const orderBy = (sort, order) => `ORDER BY ${SORTS[sort]} ${order}, u.id ${order}`

function present({ latestBureauStatus, ...row }) {
  return {
    ...row,
    latestScore: hasScore(row.latestScore, latestBureauStatus) ? row.latestScore : null,
    creditResult: row.reportCount === 0 ? 'Not checked' : creditResult(row.latestScore, latestBureauStatus),
  }
}

export async function listUsers({ search, sort, order, page, pageSize }) {
  const where = whereClause(search)
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${where.sql}`, where.params)
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM users u ${LATEST_REPORT_JOIN} ${where.sql} ${orderBy(sort, order)} LIMIT ? OFFSET ?`,
    [...where.params, pageSize, (page - 1) * pageSize],
  )
  return { users: rows.map(present), total, page, pageSize }
}

const { header, text, number, istDateTime, calendarDate } = cells

const EXPORT_COLUMNS = [
  { header: header('User ID'), cell: (u) => number(u.id), width: 9 },
  { header: header('Full name'), cell: (u) => text(u.fullName), width: 24 },
  { header: header('Email'), cell: (u) => text(u.email), width: 30 },
  { header: header('Mobile'), cell: (u) => text(u.mobileNumber), width: 13 },
  { header: header('Date of birth'), cell: (u) => calendarDate(u.dob), width: 14 },
  { header: header('Address line 1'), cell: (u) => text(u.addressLine1), width: 32 },
  { header: header('Address line 2'), cell: (u) => text(u.addressLine2), width: 24 },
  { header: header('City'), cell: (u) => text(u.city), width: 16 },
  { header: header('State'), cell: (u) => text(u.state), width: 18 },
  { header: header('PIN code'), cell: (u) => text(u.pincode), width: 10 },
  { header: header('Signed up (IST)'), cell: (u) => istDateTime(u.createdAt), width: 19 },
  { header: header('Credit reports'), cell: (u) => number(u.reportCount), width: 14 },
  { header: header('Credit result'), cell: (u) => text(u.creditResult), width: 18 },
  { header: header('Latest score'), cell: (u) => number(u.latestScore), width: 13 },
  { header: header('Last report (IST)'), cell: (u) => istDateTime(u.lastReportAt), width: 19 },
]

/** Every user matching the filter (not just one page), as an .xlsx Buffer.
 *  Built fully in memory before anything is sent, so a failure surfaces as a
 *  normal JSON error instead of a truncated download. */
export async function exportUsersWorkbook({ search, sort, order }) {
  const where = whereClause(search)
  const [rows] = await pool.query(
    `SELECT ${COLUMNS} FROM users u ${LATEST_REPORT_JOIN} ${where.sql} ${orderBy(sort, order)} LIMIT ?`,
    [...where.params, config.admin.exportMaxRows],
  )
  const users = rows.map(present)

  const buffer = await writeExcelFile(users, {
    columns: EXPORT_COLUMNS,
    sheet: 'Users',
    stickyRowsCount: 1,
  }).toBuffer()

  return { buffer, count: users.length }
}

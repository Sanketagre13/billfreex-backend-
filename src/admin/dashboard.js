import { pool } from '../db/pool.js'
import { creditResult, hasScore } from './shared.js'

const DAY_MS = 24 * 60 * 60 * 1000
const IST_OFFSET_MINUTES = 5 * 60 + 30
const SERIES_DAYS = 30

/** CRIF's score bands, same cut-offs as the customer-facing score dial. */
const SCORE_BANDS = [
  { label: 'Needs work', from: 300, to: 649 },
  { label: 'Fair', from: 650, to: 699 },
  { label: 'Good', from: 700, to: 749 },
  { label: 'Very good', from: 750, to: 799 },
  { label: 'Excellent', from: 800, to: 900 },
]

/** The India calendar date (YYYY-MM-DD) an instant falls on. */
const istDate = (ms) => new Date(ms + IST_OFFSET_MINUTES * 60 * 1000).toISOString().slice(0, 10)

/** The last `SERIES_DAYS` India calendar days, oldest first, and the UTC
 *  instant the first of them starts at. */
function seriesWindow(now) {
  const days = Array.from({ length: SERIES_DAYS }, (_, i) => istDate(now - (SERIES_DAYS - 1 - i) * DAY_MS))
  const [year, month, day] = days[0].split('-').map(Number)
  const since = new Date(Date.UTC(year, month - 1, day) - IST_OFFSET_MINUTES * 60 * 1000)
  return { days, since }
}

/** Per-India-day counts of `column` since `since`, as a Map of date → n. */
async function countPerDay(table, column, since) {
  const [rows] = await pool.query(
    `SELECT DATE(${column} + INTERVAL ${IST_OFFSET_MINUTES} MINUTE) AS day, COUNT(*) AS n
     FROM ${table} WHERE ${column} >= ? GROUP BY day`,
    [since],
  )
  return new Map(rows.map((row) => [row.day, row.n]))
}

export async function getDashboard() {
  const now = Date.now()
  const weekAgo = new Date(now - 7 * DAY_MS)
  const { days, since } = seriesWindow(now)

  const [[totals]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM users) AS totalUsers,
       (SELECT COUNT(*) FROM users WHERE created_at >= ?) AS newUsers7d,
       (SELECT COUNT(*) FROM credit_reports) AS totalReports,
       (SELECT COUNT(*) FROM credit_reports WHERE fetched_at >= ?) AS reports7d,
       (SELECT COUNT(DISTINCT user_id) FROM credit_reports) AS usersChecked`,
    [weekAgo, weekAgo],
  )

  // Each user's latest report — the same "current result" the users table shows.
  const [latest] = await pool.query(
    `SELECT score, bureau_status AS bureauStatus FROM (
       SELECT score, bureau_status,
              ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY fetched_at DESC, id DESC) AS rn
       FROM credit_reports
     ) r WHERE rn = 1`,
  )

  const results = { scoreFound: 0, noHistory: 0, other: 0 }
  const bands = SCORE_BANDS.map((band) => ({ ...band, count: 0 }))
  let scoreSum = 0
  for (const { score, bureauStatus } of latest) {
    if (hasScore(score, bureauStatus)) {
      results.scoreFound += 1
      scoreSum += score
      const band = bands.findLast((b) => score >= b.from)
      if (band) band.count += 1
    } else if (bureauStatus === 'notHit') results.noHistory += 1
    else results.other += 1
  }

  const [signups, checks] = await Promise.all([
    countPerDay('users', 'created_at', since),
    countPerDay('credit_reports', 'fetched_at', since),
  ])

  const [recent] = await pool.query(
    `SELECT cr.id, cr.user_id AS userId, u.full_name AS fullName, cr.score,
            cr.bureau_status AS bureauStatus, cr.fetched_at AS fetchedAt
     FROM credit_reports cr JOIN users u ON u.id = cr.user_id
     ORDER BY cr.fetched_at DESC, cr.id DESC LIMIT 6`,
  )

  return {
    generatedAt: new Date(now),
    totals: { ...totals, usersNotChecked: totals.totalUsers - totals.usersChecked },
    results,
    averageScore: results.scoreFound > 0 ? Math.round(scoreSum / results.scoreFound) : null,
    scoreBands: bands,
    daily: days.map((date) => ({ date, signups: signups.get(date) ?? 0, checks: checks.get(date) ?? 0 })),
    recentReports: recent.map(({ score, bureauStatus, ...row }) => ({
      ...row,
      score: hasScore(score, bureauStatus) ? score : null,
      creditResult: creditResult(score, bureauStatus),
    })),
  }
}

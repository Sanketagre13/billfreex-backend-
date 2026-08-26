/**
 * A ~5-line manual cookie reader — the backend only ever reads one cookie
 * (the session token), so a full cookie-parsing dependency isn't warranted.
 * Setting cookies uses Express's own built-in res.cookie(), which needs no
 * parser.
 */
export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null

  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex === -1) continue
    const key = part.slice(0, separatorIndex).trim()
    if (key !== name) continue
    return decodeURIComponent(part.slice(separatorIndex + 1).trim())
  }
  return null
}

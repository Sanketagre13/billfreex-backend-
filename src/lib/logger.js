/**
 * Minimal structured-ish logger.
 *
 * Deliberately dumb: no transports, no request bodies. Credit applications carry
 * PAN, DOB and OTPs — none of it belongs in a log file, so nothing here ever
 * accepts a payload. Use `mask` when an identifier genuinely aids support.
 */
const stamp = () => new Date().toISOString()

export const logger = {
  info: (message) => console.log(`${stamp()} INFO  ${message}`),
  warn: (message) => console.warn(`${stamp()} WARN  ${message}`),
  error: (message, error) =>
    console.error(`${stamp()} ERROR ${message}${error ? ` — ${error.message}` : ''}`),
}

/** `9876543210` → `98XXXXX210`, matching how the bureau prints it. */
export const mask = (value) =>
  typeof value === 'string' && value.length > 5
    ? `${value.slice(0, 2)}${'X'.repeat(value.length - 5)}${value.slice(-3)}`
    : 'XXXX'

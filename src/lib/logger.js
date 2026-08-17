const stamp = () => new Date().toISOString()

export const logger = {
  info: (message) => console.log(`${stamp()} INFO  ${message}`),
  warn: (message) => console.warn(`${stamp()} WARN  ${message}`),
  error: (message, error) =>
    console.error(`${stamp()} ERROR ${message}${error ? ` — ${error.message}` : ''}`),
}


export const mask = (value) =>
  typeof value === 'string' && value.length > 5
    ? `${value.slice(0, 2)}${'X'.repeat(value.length - 5)}${value.slice(-3)}`
    : 'XXXX'

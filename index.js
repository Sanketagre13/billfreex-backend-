import { createApp } from './src/app.js'
import { config } from './src/config.js'
import { logger } from './src/lib/logger.js'

const server = createApp().listen(config.port, () => {
  logger.info(`BillFreeX API listening on http://localhost:${config.port} (${config.env})`)
  logger.info(`CRIF upstream: ${config.crif.baseUrl}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info(`${signal} received — shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}

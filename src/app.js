import express from 'express'
import { config } from './config.js'
import creditRoutes from './routes/credit.routes.js'
import { errorHandler, notFound } from './middleware/errors.js'

export function createApp() {
  const app = express()


  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1)
  app.disable('x-powered-by')

  app.use(express.json({ limit: '32kb' }))

  const origins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  if (origins.length > 0) {
    app.use((req, res, next) => {
      const origin = req.headers.origin
      if (origin && origins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        res.setHeader('Vary', 'Origin')
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204)
      next()
    })
  }

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', env: config.env, uptime: Math.round(process.uptime()) })
  })

  app.use('/api/v1/credit', creditRoutes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}

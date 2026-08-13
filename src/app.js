import express from 'express'
import { config } from './config.js'
import creditRoutes from './routes/credit.routes.js'
import { errorHandler, notFound } from './middleware/errors.js'

export function createApp() {
  const app = express()

  // Rate limiting keys on req.ip, which is the proxy's address unless Express
  // is told to read X-Forwarded-For. Behind nginx/a load balancer, set
  // TRUST_PROXY=1 or the limiter buckets every visitor together.
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1)
  app.disable('x-powered-by')

  // A credit application is a handful of fields; anything larger is not one.
  app.use(express.json({ limit: '32kb' }))

  // In development Vite proxies /api to this server, so requests are
  // same-origin and CORS never applies. This exists for a split deployment.
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

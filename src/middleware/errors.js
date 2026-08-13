/**
 * The single place an error becomes a response.
 *
 * Shape is fixed at `{ error: { code, message, fields? } }` because the frontend
 * reads exactly that (see billfreex/src/lib/api.js).
 */
import { ApiError } from '../lib/ApiError.js'
import { logger } from '../lib/logger.js'

export function notFound(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` },
  })
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
export function errorHandler(error, req, res, next) {
  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, ...(error.fields && { fields: error.fields }) },
    })
  }

  // express.json() rejects malformed bodies before any route runs.
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'The request body was not valid JSON.' },
    })
  }

  logger.error(`Unhandled error on ${req.method} ${req.path}`, error)
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on our side. Please try again.' },
  })
}

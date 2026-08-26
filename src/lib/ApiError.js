
export class ApiError extends Error {
  constructor(status, code, message, { fields, cause } = {}) {
    super(message, { cause })
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }

  static badRequest(message, fields) {
    return new ApiError(400, 'VALIDATION_ERROR', message, { fields })
  }

  static upstream(message, cause) {
    return new ApiError(502, 'UPSTREAM_ERROR', message, { cause })
  }

  static timeout() {
    return new ApiError(
      504,
      'UPSTREAM_TIMEOUT',
      'The credit bureau took too long to respond. Please try again in a moment.',
    )
  }

  static tooManyRequests(message) {
    return new ApiError(429, 'RATE_LIMITED', message)
  }

  static unauthorized(message = 'Please sign in to continue.') {
    return new ApiError(401, 'UNAUTHORIZED', message)
  }

  static conflict(message, fields) {
    return new ApiError(409, 'CONFLICT', message, { fields })
  }

  static notFound(message) {
    return new ApiError(404, 'NOT_FOUND', message)
  }
}

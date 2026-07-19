import { describe, test, expect, beforeEach } from 'bun:test'
import {
  SecureErrorHandler,
  createSecureErrorHandler,
} from '../../src/security/error-handler'
import type { ErrorHandlerConfig } from '../../src/security/config'

describe('SecureErrorHandler', () => {
  describe('constructor and factory', () => {
    test('should create SecureErrorHandler instance', () => {
      const handler = new SecureErrorHandler()
      expect(handler).toBeDefined()
    })

    test('should create SecureErrorHandler via factory function', () => {
      const handler = createSecureErrorHandler()
      expect(handler).toBeDefined()
      expect(handler).toBeInstanceOf(SecureErrorHandler)
    })

    test('should accept custom configuration', () => {
      const config: ErrorHandlerConfig = {
        production: true,
        includeStackTrace: false,
        logErrors: false,
      }
      const handler = new SecureErrorHandler(config)
      expect(handler).toBeDefined()
    })

    test('should default to production mode based on NODE_ENV', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const handler = new SecureErrorHandler()
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')
      const response = handler.handleError(error, req)

      response.json().then((body: any) => {
        expect(body.error.stack).toBeUndefined()
      })

      process.env.NODE_ENV = originalEnv
    })
  })

  describe('production error sanitization', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({ production: true, logErrors: false })
    })

    test('should sanitize error messages in production', () => {
      const error = new Error(
        'Internal database connection failed at 192.168.1.100',
      )
      const safeError = handler.sanitizeError(error)

      expect(safeError.message).not.toContain('database')
      expect(safeError.message).not.toContain('192.168.1.100')
      expect(safeError.message).toBe('Internal Server Error')
    })

    test('should return generic message for 500 errors', () => {
      const error = new Error('Sensitive internal error')
      ;(error as any).statusCode = 500

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(500)
      expect(safeError.message).toBe('Internal Server Error')
    })

    test('should sanitize backend errors', () => {
      const error = new Error(
        'Backend service at http://internal-api:3000 failed',
      )
      ;(error as any).statusCode = 502

      const safeError = handler.sanitizeError(error)
      expect(safeError.message).not.toContain('internal-api')
      expect(safeError.message).not.toContain('3000')
      expect(safeError.message).toBe('The service is temporarily unavailable')
    })

    test('should not include stack traces in production', () => {
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')
      const response = handler.handleError(error, req)

      response.json().then((body: any) => {
        expect(body.error.stack).toBeUndefined()
      })
    })

    test('should use custom error messages when provided', () => {
      const customHandler = new SecureErrorHandler({
        production: true,
        logErrors: false,
        customMessages: {
          404: 'The resource you requested could not be found',
        },
      })

      const error = new Error('Not found')
      ;(error as any).statusCode = 404

      const safeError = customHandler.sanitizeError(error)
      expect(safeError.message).toBe(
        'The resource you requested could not be found',
      )
    })
  })

  describe('development error details', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({
        production: false,
        includeStackTrace: true,
        logErrors: false,
      })
    })

    test('should include actual error message in development', () => {
      const error = new Error('Detailed error message with context')
      const safeError = handler.sanitizeError(error)

      expect(safeError.message).toBe('Detailed error message with context')
    })

    test('should include stack trace in development when enabled', async () => {
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')
      const response = handler.handleError(error, req)

      const body: any = await response.json()
      expect(body.error.stack).toBeDefined()
      expect(body.error.stack).toContain('Error: Test error')
    })

    test('should include error details in development', async () => {
      const error = new Error('Test error') as any
      error.details = { field: 'username', reason: 'invalid format' }

      const req = new Request('http://localhost/test')
      const response = handler.handleError(error, req)

      const body: any = await response.json()
      expect(body.error.details).toBeDefined()
      expect(body.error.details.field).toBe('username')
    })
  })

  describe('error logging', () => {
    test('should log errors when enabled', () => {
      const logs: any[] = []
      const logger = {
        error: (entry: any) => logs.push(entry),
        warn: (entry: any) => logs.push(entry),
        info: (entry: any) => logs.push(entry),
      }

      const handler = new SecureErrorHandler({
        logErrors: true,
        production: false,
        logger,
      })
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')

      handler.handleError(error, req)

      expect(logs.length).toBeGreaterThan(0)
    })

    test('should not log errors when disabled', () => {
      const logs: any[] = []
      const logger = {
        error: (entry: any) => logs.push(entry),
        warn: (entry: any) => logs.push(entry),
        info: (entry: any) => logs.push(entry),
      }

      const handler = new SecureErrorHandler({ logErrors: false, logger })
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')

      handler.handleError(error, req)

      expect(logs.length).toBe(0)
    })

    test('should include request context in logs', () => {
      const logs: any[] = []
      const logger = {
        error: (entry: any) => logs.push(entry),
        warn: (entry: any) => logs.push(entry),
        info: (entry: any) => logs.push(entry),
      }

      const handler = new SecureErrorHandler({
        logErrors: true,
        production: false,
        logger,
      })
      const error = new Error('Test error')
      const req = new Request('http://localhost/test?param=value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      handler.handleError(error, req)

      expect(logs.length).toBeGreaterThan(0)
      const logEntry = logs[0]
      expect(logEntry.request.method).toBe('POST')
      expect(logEntry.request.url).toContain('/test')
    })

    test('should redact sensitive headers in production logs', () => {
      const logs: any[] = []
      const logger = {
        error: (entry: any) => logs.push(entry),
        warn: (entry: any) => logs.push(entry),
        info: (entry: any) => logs.push(entry),
      }

      const handler = new SecureErrorHandler({
        logErrors: true,
        production: true,
        logger,
      })
      const error = new Error('Test error')
      const req = new Request('http://localhost/test', {
        headers: {
          Authorization: 'Bearer secret-token',
          'X-API-Key': 'secret-key',
        },
      })

      handler.handleError(error, req)

      expect(logs.length).toBeGreaterThan(0)
      const logEntry = logs[0]
      expect(logEntry.request.headers.authorization).toBe('[REDACTED]')
      expect(logEntry.request.headers['x-api-key']).toBe('[REDACTED]')
    })
  })

  describe('backend error sanitization', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({
        production: true,
        sanitizeBackendErrors: true,
        logErrors: false,
      })
    })

    test('should sanitize backend connection errors', () => {
      const error = new Error(
        'ECONNREFUSED: Connection refused to http://backend:8080',
      )
      const safeError = handler.sanitizeBackendServiceError(error)

      expect(safeError.message).not.toContain('backend')
      expect(safeError.message).not.toContain('8080')
      expect(safeError.message).not.toContain('ECONNREFUSED')
    })

    test('should sanitize backend timeout errors', () => {
      const error = new Error('ETIMEDOUT: Request timeout')
      ;(error as any).statusCode = 504

      const safeError = handler.sanitizeBackendServiceError(error)
      expect(safeError.statusCode).toBe(504)
      expect(safeError.message).toBe('The service took too long to respond')
    })

    test('should sanitize 502 Bad Gateway errors', () => {
      const error = new Error('Bad Gateway')
      ;(error as any).statusCode = 502

      const safeError = handler.sanitizeBackendServiceError(error)
      expect(safeError.statusCode).toBe(502)
      expect(safeError.message).toBe('The service is temporarily unavailable')
    })

    test('should include backend info in development mode', () => {
      const devHandler = new SecureErrorHandler({
        production: false,
        sanitizeBackendErrors: false,
        logErrors: false,
      })

      const error = new Error('Connection failed')
      const backendUrl = 'http://backend-service:3000/api'

      const safeError = devHandler.sanitizeBackendServiceError(
        error,
        backendUrl,
      )
      expect(safeError.message).toContain('backend-service')
    })
  })

  describe('circuit breaker error sanitization', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({ production: true, logErrors: false })
    })

    test('should sanitize circuit breaker errors in production', () => {
      const error = new Error('Circuit breaker is open for service-a')
      const safeError = handler.sanitizeCircuitBreakerError(error)

      expect(safeError.statusCode).toBe(503)
      expect(safeError.message).not.toContain('service-a')
      expect(safeError.message).toBe(
        'The service is temporarily unavailable. Please try again later.',
      )
    })

    test('should include circuit breaker details in development', () => {
      const devHandler = new SecureErrorHandler({
        production: false,
        logErrors: false,
      })
      const error = new Error('Circuit breaker is open')

      const safeError = devHandler.sanitizeCircuitBreakerError(error)
      expect(safeError.message).toContain('Circuit breaker')
    })
  })

  describe('status code detection', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({ production: false, logErrors: false })
    })

    test('should detect status code from error.statusCode', () => {
      const error = new Error('Not found') as any
      error.statusCode = 404

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(404)
    })

    test('should detect status code from error.status', () => {
      const error = new Error('Unauthorized') as any
      error.status = 401

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(401)
    })

    test('should infer 400 from validation errors', () => {
      const error = new Error('Validation failed')
      error.name = 'ValidationError'

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(400)
    })

    test('should infer 401 from authentication errors', () => {
      const error = new Error('Authentication required')
      error.name = 'AuthenticationError'

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(401)
    })

    test('should infer 404 from not found errors', () => {
      const error = new Error('Resource not found')
      error.name = 'NotFoundError'

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(404)
    })

    test('should default to 500 for unknown errors', () => {
      const error = new Error('Unknown error')

      const safeError = handler.sanitizeError(error)
      expect(safeError.statusCode).toBe(500)
    })
  })

  describe('request ID handling', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({ production: false, logErrors: false })
    })

    test('should generate request ID if not provided', () => {
      const error = new Error('Test error')
      const safeError = handler.sanitizeError(error)

      expect(safeError.requestId).toBeDefined()
      expect(safeError.requestId).toMatch(/^req_/)
    })

    test('should use existing request ID from headers', async () => {
      const error = new Error('Test error')
      const req = new Request('http://localhost/test', {
        headers: { 'X-Request-ID': 'existing-request-id' },
      })

      const response = handler.handleError(error, req)
      const body: any = await response.json()

      expect(body.error.requestId).toBe('existing-request-id')
    })

    test('should include request ID in response headers', async () => {
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')

      const response = handler.handleError(error, req)

      expect(response.headers.get('X-Request-ID')).toBeDefined()
    })
  })

  describe('error response format', () => {
    let handler: SecureErrorHandler

    beforeEach(() => {
      handler = new SecureErrorHandler({ production: false, logErrors: false })
    })

    test('should return JSON response', async () => {
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')

      const response = handler.handleError(error, req)

      expect(response.headers.get('Content-Type')).toBe('application/json')
      const body = await response.json()
      expect(body).toBeDefined()
    })

    test('should include error code', async () => {
      const error = new Error('Test error') as any
      error.code = 'CUSTOM_ERROR'

      const req = new Request('http://localhost/test')
      const response = handler.handleError(error, req)
      const body: any = await response.json()

      expect(body.error.code).toBe('CUSTOM_ERROR')
    })

    test('should include timestamp', async () => {
      const error = new Error('Test error')
      const req = new Request('http://localhost/test')

      const response = handler.handleError(error, req)
      const body: any = await response.json()

      expect(body.error.timestamp).toBeDefined()
      expect(typeof body.error.timestamp).toBe('number')
    })
  })
})

import { describe, test, expect } from 'bun:test'
import {
  createErrorHandlerMiddleware,
  errorHandlerMiddleware,
  createProductionErrorHandler,
  createDevelopmentErrorHandler,
} from '../../src/security/error-handler-middleware'

describe('ErrorHandlerMiddleware', () => {
  describe('factory functions', () => {
    test('should create error handler middleware', () => {
      const middleware = createErrorHandlerMiddleware()
      expect(middleware).toBeDefined()
      expect(typeof middleware).toBe('function')
    })

    test('should create default middleware instance', () => {
      expect(errorHandlerMiddleware).toBeDefined()
      expect(typeof errorHandlerMiddleware).toBe('function')
    })

    test('should create production error handler', () => {
      const middleware = createProductionErrorHandler()
      expect(middleware).toBeDefined()
      expect(typeof middleware).toBe('function')
    })

    test('should create development error handler', () => {
      const middleware = createDevelopmentErrorHandler()
      expect(middleware).toBeDefined()
      expect(typeof middleware).toBe('function')
    })
  })

  describe('error catching', () => {
    test('should catch errors from next middleware', async () => {
      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw new Error('Test error')
      }

      const response = await middleware(req, next)

      expect(response).toBeInstanceOf(Response)
      expect(response!.status).toBe(500)
    })

    test('should pass through when no error occurs', async () => {
      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      let nextCalled = false
      const next = async (): Promise<Response> => {
        nextCalled = true
        return new Response('OK')
      }

      await middleware(req, next)

      expect(nextCalled).toBe(true)
    })

    test('should handle non-Error objects', async () => {
      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw 'String error'
      }

      const response = await middleware(req, next)

      expect(response).toBeInstanceOf(Response)
      expect(response!.status).toBe(500)
    })
  })

  describe('circuit breaker error handling', () => {
    test('should detect circuit breaker errors', async () => {
      const middleware = createErrorHandlerMiddleware({
        production: true,
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('Circuit breaker is open')
        error.name = 'CircuitBreakerError'
        throw error
      }

      const response = await middleware(req, next)

      expect(response!.status).toBe(503)
      const body: any = await response!.json()
      expect(body.error.code).toBe('CIRCUIT_BREAKER_OPEN')
      expect(response!.headers.get('Retry-After')).toBe('60')
    })

    test('should sanitize circuit breaker error messages in production', async () => {
      const middleware = createProductionErrorHandler()
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('Circuit breaker open for service-internal-api')
        ;(error as any).circuitBreaker = true
        throw error
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.message).not.toContain('service-internal-api')
      expect(body.error.message).toContain('temporarily unavailable')
    })

    test('should include circuit breaker details in development', async () => {
      const middleware = createDevelopmentErrorHandler()
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('Circuit breaker is open')
        ;(error as any).circuitBreaker = true
        throw error
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.message).toContain('Circuit breaker')
    })
  })

  describe('backend service error handling', () => {
    test('should detect backend service errors', async () => {
      const middleware = createErrorHandlerMiddleware({
        production: true,
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('Backend service unavailable')
        error.name = 'BackendError'
        throw error
      }

      const response = await middleware(req, next)

      expect(response!.status).toBeGreaterThanOrEqual(500)
      const body: any = await response!.json()
      expect(body.error.code).toBe('BACKEND_ERROR')
    })

    test('should sanitize backend URLs in production', async () => {
      const middleware = createProductionErrorHandler()
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('Connection failed') as any
        error.backend = true
        error.backendUrl = 'http://internal-service:8080/api'
        throw error
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.message).not.toContain('internal-service')
      expect(body.error.message).not.toContain('8080')
    })

    test('should detect ECONNREFUSED errors', async () => {
      const middleware = createErrorHandlerMiddleware({
        production: true,
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('ECONNREFUSED: Connection refused')
        throw error
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.code).toBe('BACKEND_ERROR')
    })

    test('should detect ETIMEDOUT errors', async () => {
      const middleware = createErrorHandlerMiddleware({
        production: true,
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        const error = new Error('ETIMEDOUT: Request timeout')
        throw error
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.code).toBe('BACKEND_ERROR')
    })
  })

  describe('custom error handler callback', () => {
    test('should call onError callback when error occurs', async () => {
      let callbackCalled = false
      let capturedError: Error | null = null

      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
        onError: (error: any, req: any) => {
          callbackCalled = true
          capturedError = error
        },
      } as any)

      const req = new Request('http://localhost/test') as any
      const next = async () => {
        throw new Error('Test error')
      }

      await middleware(req, next)

      expect(callbackCalled).toBe(true)
      expect(capturedError).toBeDefined()
      expect(capturedError!.message).toBe('Test error')
    })

    test('should handle errors in onError callback gracefully', async () => {
      const logs: any[] = []
      const originalError = console.error
      console.error = (...args: any[]) => logs.push(args)

      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
        onError: () => {
          throw new Error('Callback error')
        },
      } as any)

      const req = new Request('http://localhost/test') as any
      const next = async () => {
        throw new Error('Test error')
      }

      const response = await middleware(req, next)

      // Should still return error response despite callback error
      expect(response).toBeInstanceOf(Response)
      expect(response!.status).toBe(500)

      // Should log callback error
      expect(logs.length).toBeGreaterThan(0)

      console.error = originalError
    })
  })

  describe('response format', () => {
    test('should return JSON response', async () => {
      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw new Error('Test error')
      }

      const response = await middleware(req, next)

      expect(response!.headers.get('Content-Type')).toBe('application/json')
      const body: any = await response!.json()
      expect(body.error).toBeDefined()
    })

    test('should include request ID in response', async () => {
      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw new Error('Test error')
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.requestId).toBeDefined()
      expect(response!.headers.get('X-Request-ID')).toBeDefined()
    })

    test('should include timestamp in response', async () => {
      const middleware = createErrorHandlerMiddleware({
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw new Error('Test error')
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.timestamp).toBeDefined()
      expect(typeof body.error.timestamp).toBe('number')
    })
  })

  describe('production vs development mode', () => {
    test('should sanitize errors in production mode', async () => {
      const middleware = createProductionErrorHandler()
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw new Error('Sensitive internal error with database credentials')
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.message).not.toContain('database')
      expect(body.error.message).not.toContain('credentials')
      expect(body.error.stack).toBeUndefined()
    })

    test('should include details in development mode', async () => {
      const middleware = createDevelopmentErrorHandler()
      const req = new Request('http://localhost/test') as any

      const next = async () => {
        throw new Error('Detailed error message')
      }

      const response = await middleware(req, next)
      const body: any = await response!.json()

      expect(body.error.message).toBe('Detailed error message')
      expect(body.error.stack).toBeDefined()
    })
  })

  describe('catchAll configuration', () => {
    test('should not catch errors when catchAll is false', async () => {
      const middleware = createErrorHandlerMiddleware({
        catchAll: false,
        logErrors: false,
      } as any)
      const req = new Request('http://localhost/test') as any

      let nextCalled = false
      const next = async (): Promise<Response> => {
        nextCalled = true
        return new Response('OK')
      }

      await middleware(req, next)

      expect(nextCalled).toBe(true)
    })
  })
})

describe('Extract URL from errors', () => {
  test('should extract URL from error.url when no backendUrl', () => {
    const err = new Error('Connection failed to http://test.internal:8080/path')
    ;(err as any).url = 'http://override.url'
    const middleware = createErrorHandlerMiddleware({ production: false })
    expect(err.message).toContain('http://')
    expect((err as any).url).toBe('http://override.url')
  })
})

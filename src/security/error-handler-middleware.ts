/**
 * Error Handler Middleware
 *
 * Middleware that wraps gateway error handling to provide secure error responses
 * with sanitization for circuit breaker and backend service errors.
 */

import type { RequestHandler } from '../interfaces/middleware'
import type { ErrorHandlerConfig } from './config'
import { SecureErrorHandler, createSecureErrorHandler } from './error-handler'

/**
 * Error handler middleware configuration
 */
export interface ErrorHandlerMiddlewareConfig extends ErrorHandlerConfig {
  /**
   * Whether to catch and handle all errors
   * @default true
   */
  catchAll?: boolean

  /**
   * Custom error handler function
   */
  onError?: (error: Error, req: Request) => void
}

/**
 * Creates error handler middleware
 *
 * This middleware wraps request handling and catches any errors,
 * sanitizing them appropriately based on the configuration.
 *
 * @param config - Error handler configuration
 * @returns Middleware function
 */
export function createErrorHandlerMiddleware(
  config?: ErrorHandlerMiddlewareConfig,
): RequestHandler {
  const errorHandler = createSecureErrorHandler(config)
  const catchAll = config?.catchAll ?? true
  const onError = config?.onError

  return async (req: any, next: any): Promise<Response> => {
    if (!catchAll) {
      // If not catching all errors, just pass through
      return next()
    }

    try {
      // Continue to next middleware
      return await next()
    } catch (error) {
      // Handle the error
      const err = error instanceof Error ? error : new Error(String(error))

      // Call custom error handler if provided
      if (onError) {
        try {
          onError(err, req)
        } catch (callbackError) {
          console.error(
            '[ErrorHandlerMiddleware] Error in onError callback:',
            callbackError,
          )
        }
      }

      // Check if this is a circuit breaker error
      if (isCircuitBreakerError(err)) {
        const safeError = errorHandler.sanitizeCircuitBreakerError(err)
        return new Response(
          JSON.stringify({
            error: {
              code: 'CIRCUIT_BREAKER_OPEN',
              message: safeError.message,
              requestId: safeError.requestId,
              timestamp: safeError.timestamp,
            },
          }),
          {
            status: safeError.statusCode,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-ID': safeError.requestId || '',
              'Retry-After': '60', // Suggest retry after 60 seconds
            },
          },
        )
      }

      // Check if this is a backend service error
      if (isBackendServiceError(err)) {
        const backendUrl = extractBackendUrl(err)
        const safeError = errorHandler.sanitizeBackendServiceError(
          err,
          backendUrl,
        )
        return new Response(
          JSON.stringify({
            error: {
              code: 'BACKEND_ERROR',
              message: safeError.message,
              requestId: safeError.requestId,
              timestamp: safeError.timestamp,
            },
          }),
          {
            status: safeError.statusCode,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-ID': safeError.requestId || '',
            },
          },
        )
      }

      // Handle generic error
      return errorHandler.handleError(err, req)
    }
  }
}

/**
 * Checks if error is a circuit breaker error
 */
function isCircuitBreakerError(error: Error): boolean {
  const errorName = error.name.toLowerCase()
  const errorMessage = error.message.toLowerCase()

  return (
    errorName.includes('circuitbreaker') ||
    errorName.includes('circuit') ||
    errorMessage.includes('circuit breaker') ||
    errorMessage.includes('circuit is open') ||
    errorMessage.includes('breaker open') ||
    (error as any).circuitBreaker === true
  )
}

/**
 * Checks if error is a backend service error
 */
function isBackendServiceError(error: Error): boolean {
  const errorName = error.name.toLowerCase()
  const errorMessage = error.message.toLowerCase()

  return (
    errorName.includes('backend') ||
    errorName.includes('upstream') ||
    errorName.includes('proxy') ||
    errorName.includes('fetch') ||
    errorMessage.includes('backend') ||
    errorMessage.includes('upstream') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('econnreset') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('connection refused') ||
    errorMessage.includes('connection reset') ||
    (error as any).backend === true
  )
}

/**
 * Extracts backend URL from error if available
 */
function extractBackendUrl(error: Error): string | undefined {
  // Check for explicit backend URL property
  if ((error as any).backendUrl) {
    return (error as any).backendUrl
  }

  if ((error as any).url) {
    return (error as any).url
  }

  // Try to extract from error message
  const urlMatch = error.message.match(/https?:\/\/[^\s]+/)
  if (urlMatch) {
    return urlMatch[0]
  }

  return undefined
}

/**
 * Default error handler middleware instance
 *
 * Can be used directly without configuration for basic error handling
 */
export const errorHandlerMiddleware = createErrorHandlerMiddleware()

/**
 * Creates a production-ready error handler middleware
 *
 * This is a convenience function that creates middleware with
 * production-safe defaults.
 */
export function createProductionErrorHandler(): RequestHandler {
  return createErrorHandlerMiddleware({
    production: true,
    includeStackTrace: false,
    logErrors: true,
    sanitizeBackendErrors: true,
  })
}

/**
 * Creates a development error handler middleware
 *
 * This is a convenience function that creates middleware with
 * development-friendly defaults. Stack traces are still excluded from HTTP
 * responses by default; set includeStackTrace to true explicitly when needed.
 */
export function createDevelopmentErrorHandler(): RequestHandler {
  return createErrorHandlerMiddleware({
    production: false,
    includeStackTrace: false,
    logErrors: true,
    sanitizeBackendErrors: false,
  })
}

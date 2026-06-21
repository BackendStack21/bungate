/**
 * Size limiter middleware
 * Validates request sizes and rejects oversized requests early
 */

import type { RequestHandler, ZeroRequest } from '../interfaces/middleware'
import type { SizeLimits } from './config'
import { SizeLimiter } from './size-limiter'
import { generateRequestId } from './utils'
import { defaultLogger } from '../logger/pino-logger'

/**
 * Configuration for size limiter middleware
 */
export interface SizeLimiterMiddlewareConfig {
  /**
   * Size limits to enforce
   */
  limits?: Partial<SizeLimits>

  /**
   * Custom error handler for size limit violations
   */
  onSizeExceeded?: (
    errors: string[],
    req: ZeroRequest,
    statusCode: number,
  ) => Response
}

/**
 * Determines the appropriate HTTP status code based on the error type
 */
function getStatusCodeForError(error: string): number {
  if (error.includes('body size')) {
    return 413 // Payload Too Large
  }
  if (error.includes('URL length')) {
    return 414 // URI Too Long
  }
  if (error.includes('header')) {
    return 431 // Request Header Fields Too Large
  }
  if (error.includes('Query parameter')) {
    return 414 // URI Too Long (query params are part of URI)
  }
  return 400 // Bad Request (fallback)
}

/**
 * Creates size limiter middleware
 * Validates request sizes and rejects oversized requests with appropriate HTTP status codes
 */
export function createSizeLimiterMiddleware(
  config: SizeLimiterMiddlewareConfig = {},
): RequestHandler {
  const { limits, onSizeExceeded } = config
  const limiter = new SizeLimiter(limits)

  return async (req: ZeroRequest, next): Promise<Response> => {
    const requestId = generateRequestId()

    try {
      // Validate all request size constraints
      const result = await limiter.validateRequest(req)

      // If validation failed, reject the request
      if (!result.valid && result.errors) {
        // Determine the most appropriate status code
        // Use the first error to determine status code
        const statusCode = getStatusCodeForError(result.errors[0] ?? '')

        // Use custom error handler if provided
        if (onSizeExceeded) {
          return onSizeExceeded(result.errors, req, statusCode)
        }

        // Default error response
        const errorCode =
          statusCode === 413
            ? 'PAYLOAD_TOO_LARGE'
            : statusCode === 414
              ? 'URI_TOO_LONG'
              : statusCode === 431
                ? 'HEADERS_TOO_LARGE'
                : 'SIZE_LIMIT_EXCEEDED'

        return new Response(
          JSON.stringify({
            error: {
              code: errorCode,
              message: 'Request size limit exceeded',
              requestId,
              timestamp: Date.now(),
              details: result.errors,
            },
          }),
          {
            status: statusCode,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-ID': requestId,
            },
          },
        )
      }

      // Validation passed, continue to next middleware
      return next()
    } catch (error) {
      // Handle unexpected errors during validation
      defaultLogger.error('Size limiter middleware error', error as Error)

      return new Response(
        JSON.stringify({
          error: {
            code: 'SIZE_VALIDATION_ERROR',
            message: 'An error occurred during size validation',
            requestId,
            timestamp: Date.now(),
          },
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'X-Request-ID': requestId,
          },
        },
      )
    }
  }
}

/**
 * Creates a simple size limiter middleware with default configuration
 */
export function sizeLimiterMiddleware(): RequestHandler {
  return createSizeLimiterMiddleware()
}

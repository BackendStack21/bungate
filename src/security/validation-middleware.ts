/**
 * Input validation middleware
 * Validates all incoming requests and rejects invalid inputs early
 */

import type { RequestHandler, ZeroRequest } from '../interfaces/middleware'
import type { ValidationRules } from './types'
import { InputValidator } from './input-validator'
import { generateRequestId } from './utils'
import { defaultLogger } from '../logger/pino-logger'

/**
 * Configuration for validation middleware
 */
export interface ValidationMiddlewareConfig {
  /**
   * Validation rules to apply
   */
  rules?: Partial<ValidationRules>

  /**
   * Whether to validate paths
   */
  validatePaths?: boolean

  /**
   * Whether to validate headers
   */
  validateHeaders?: boolean

  /**
   * Whether to validate query parameters
   */
  validateQueryParams?: boolean

  /**
   * Custom error handler for validation failures
   */
  onValidationError?: (errors: string[], req: ZeroRequest) => Response
}

/**
 * Creates input validation middleware
 * Validates incoming requests and rejects invalid inputs with 400 status
 */
export function createValidationMiddleware(
  config: ValidationMiddlewareConfig = {},
): RequestHandler {
  const {
    rules,
    validatePaths = true,
    validateHeaders: validateHeadersEnabled = true,
    validateQueryParams: validateQueryParamsEnabled = true,
    onValidationError,
  } = config

  const validator = new InputValidator(rules)

  return async (req: ZeroRequest, next): Promise<Response> => {
    const allErrors: string[] = []
    const requestId = generateRequestId()

    try {
      const url = new URL(req.url)

      // Validate path
      if (validatePaths) {
        const pathResult = validator.validatePath(url.pathname)
        if (!pathResult.valid && pathResult.errors) {
          allErrors.push(...pathResult.errors)
        }
      }

      // Validate headers
      if (validateHeadersEnabled) {
        const headersResult = validator.validateHeaders(req.headers)
        if (!headersResult.valid && headersResult.errors) {
          allErrors.push(...headersResult.errors)
        }
      }

      // Validate query parameters
      if (validateQueryParamsEnabled && url.search) {
        const queryResult = validator.validateQueryParams(url.searchParams)
        if (!queryResult.valid && queryResult.errors) {
          allErrors.push(...queryResult.errors)
        }
      }

      // If validation failed, reject the request
      if (allErrors.length > 0) {
        // Use custom error handler if provided
        if (onValidationError) {
          return onValidationError(allErrors, req)
        }

        // Default error response
        return new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              requestId,
              timestamp: Date.now(),
              details: allErrors,
            },
          }),
          {
            status: 400,
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
      defaultLogger.error('Validation middleware error', error as Error)

      const message =
        error instanceof Error
          ? error.message
          : 'An error occurred during request validation'

      const isClientEncodingError =
        message.includes('Non-canonical percent encoding') ||
        message.includes('incompletely decoded percent encoding')

      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message: isClientEncodingError
              ? 'Invalid request encoding'
              : 'An error occurred during request validation',
            requestId,
            timestamp: Date.now(),
            ...(isClientEncodingError ? { details: [message] } : {}),
          },
        }),
        {
          status: isClientEncodingError ? 400 : 500,
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
 * Creates a simple validation middleware with default configuration
 */
export function validationMiddleware(): RequestHandler {
  return createValidationMiddleware()
}

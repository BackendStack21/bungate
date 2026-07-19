/**
 * Secure Error Handler Module
 *
 * Provides secure error handling with sanitization for production environments
 * to prevent information disclosure while maintaining detailed logging.
 */

import type { ErrorContext, SafeError } from './types'
import type { ErrorHandlerConfig } from './config'
import {
  sanitizeErrorMessage,
  generateRequestId,
  redactSensitiveData,
} from './utils'
import { defaultLogger } from '../logger/pino-logger'

/**
 * Default error messages for common HTTP status codes
 */
const DEFAULT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  413: 'Payload Too Large',
  414: 'URI Too Long',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  431: 'Request Header Fields Too Large',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

/**
 * SecureErrorHandler class
 *
 * Handles errors securely by sanitizing error messages in production
 * and providing detailed error information in development.
 */
export class SecureErrorHandler {
  private config: Required<ErrorHandlerConfig>

  constructor(config?: ErrorHandlerConfig) {
    // Merge with defaults
    this.config = {
      production: config?.production ?? process.env.NODE_ENV === 'production',
      includeStackTrace: config?.includeStackTrace ?? false,
      logErrors: config?.logErrors ?? true,
      customMessages: config?.customMessages ?? {},
      sanitizeBackendErrors: config?.sanitizeBackendErrors ?? true,
      logger: config?.logger ?? defaultLogger,
    }

    // In production, never include stack traces
    if (this.config.production) {
      this.config.includeStackTrace = false
    }
  }

  /**
   * Handles an error and returns a safe Response
   */
  handleError(error: Error, req: Request): Response {
    const context = this.createErrorContext(req)
    const safeError = this.sanitizeError(error, context)

    // Log the full error internally
    if (this.config.logErrors) {
      this.logError(error, context)
    }

    // Create response body
    const responseBody: any = {
      error: {
        code: this.getErrorCode(error),
        message: safeError.message,
        requestId: safeError.requestId,
        timestamp: safeError.timestamp,
      },
    }

    // Include stack trace only in development
    if (
      !this.config.production &&
      this.config.includeStackTrace &&
      error.stack
    ) {
      responseBody.error.stack = error.stack
    }

    // Include additional details in development
    if (!this.config.production && (error as any).details) {
      responseBody.error.details = (error as any).details
    }

    return new Response(JSON.stringify(responseBody), {
      status: safeError.statusCode,
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': safeError.requestId ?? '',
      },
    })
  }

  /**
   * Sanitizes an error for safe client exposure
   */
  sanitizeError(error: Error, context?: ErrorContext): SafeError {
    const statusCode = this.getStatusCode(error)
    const requestId = context?.requestId || generateRequestId()
    const timestamp = Date.now()

    let message: string

    if (this.config.production) {
      // In production, use generic messages
      message = this.getGenericMessage(statusCode, error)
    } else {
      // In development, include actual error message
      message =
        error.message ||
        DEFAULT_ERROR_MESSAGES[statusCode] ||
        'An error occurred'
    }

    return {
      statusCode,
      message,
      requestId,
      timestamp,
    }
  }

  /**
   * Logs error with full context
   */
  logError(error: Error, context: ErrorContext): void {
    const logEntry = {
      timestamp: context.timestamp,
      requestId: context.requestId,
      level: this.getLogLevel(error),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
        statusCode: this.getStatusCode(error),
      },
      request: {
        method: context.method,
        url: context.url,
        clientIP: context.clientIP,
        headers: redactSensitiveData(context.headers || {}),
      },
    }

    // Route through the configured logger so redaction and transport settings
    // are respected (V-23). Fallback to console only if the logger rejects.
    const logLevel = logEntry.level
    const logger = this.config.logger ?? defaultLogger
    try {
      if (logLevel === 'critical' || logLevel === 'error') {
        logger.error(logEntry, 'SecureErrorHandler error')
      } else if (logLevel === 'warn') {
        logger.warn(logEntry, 'SecureErrorHandler warning')
      } else {
        logger.info(logEntry, 'SecureErrorHandler info')
      }
    } catch {
      if (logLevel === 'critical' || logLevel === 'error') {
        console.error('[SecureErrorHandler]', JSON.stringify(logEntry, null, 2))
      } else if (logLevel === 'warn') {
        console.warn('[SecureErrorHandler]', JSON.stringify(logEntry, null, 2))
      } else {
        console.log('[SecureErrorHandler]', JSON.stringify(logEntry, null, 2))
      }
    }
  }

  /**
   * Creates error context from request
   */
  private createErrorContext(req: Request): ErrorContext {
    const url = new URL(req.url)
    const headers: Record<string, string> = {}

    req.headers.forEach((value, key) => {
      headers[key] = value
    })

    return {
      requestId: req.headers.get('X-Request-ID') || generateRequestId(),
      clientIP: this.extractClientIP(req),
      method: req.method,
      url: url.pathname + url.search,
      headers,
      timestamp: Date.now(),
    }
  }

  /**
   * Extracts client IP from request
   */
  private extractClientIP(req: Request): string {
    // Try X-Forwarded-For first (will be validated by trusted proxy middleware)
    const forwarded = req.headers.get('X-Forwarded-For')
    if (forwarded) {
      const ips = forwarded.split(',').map((ip) => ip.trim())
      return ips[0] || 'unknown'
    }

    // Try X-Real-IP
    const realIP = req.headers.get('X-Real-IP')
    if (realIP) {
      return realIP
    }

    // Fallback to connection IP (not available in standard Request)
    return 'unknown'
  }

  /**
   * Gets HTTP status code from error
   */
  private getStatusCode(error: Error): number {
    // Check for explicit status code
    if ((error as any).statusCode) {
      return (error as any).statusCode
    }

    if ((error as any).status) {
      return (error as any).status
    }

    // Check error name for common patterns
    const errorName = error.name.toLowerCase()

    if (errorName.includes('validation')) return 400
    if (
      errorName.includes('unauthorized') ||
      errorName.includes('authentication')
    )
      return 401
    if (errorName.includes('forbidden') || errorName.includes('permission'))
      return 403
    if (errorName.includes('notfound') || errorName.includes('not found'))
      return 404
    if (errorName.includes('timeout')) return 504
    if (errorName.includes('toolarge') || errorName.includes('too large'))
      return 413

    // Check error message for patterns
    const errorMessage = error.message.toLowerCase()

    if (errorMessage.includes('not found')) return 404
    if (errorMessage.includes('unauthorized')) return 401
    if (errorMessage.includes('forbidden')) return 403
    if (errorMessage.includes('invalid')) return 400
    if (errorMessage.includes('timeout')) return 504
    if (errorMessage.includes('too large') || errorMessage.includes('payload'))
      return 413

    // Default to 500
    return 500
  }

  /**
   * Gets generic error message for status code
   */
  private getGenericMessage(statusCode: number, error: Error): string {
    // Check for custom message
    if (this.config.customMessages[statusCode]) {
      return this.config.customMessages[statusCode]
    }

    // Check for backend error that should be sanitized
    if (this.config.sanitizeBackendErrors && this.isBackendError(error)) {
      return this.sanitizeBackendError(statusCode)
    }

    // Use default message
    return (
      DEFAULT_ERROR_MESSAGES[statusCode] ||
      'An error occurred while processing your request'
    )
  }

  /**
   * Checks if error is from backend service
   */
  private isBackendError(error: Error): boolean {
    const errorName = error.name.toLowerCase()
    const errorMessage = error.message.toLowerCase()

    return (
      errorName.includes('backend') ||
      errorName.includes('upstream') ||
      errorName.includes('proxy') ||
      errorMessage.includes('backend') ||
      errorMessage.includes('upstream') ||
      errorMessage.includes('econnrefused') ||
      errorMessage.includes('econnreset') ||
      errorMessage.includes('etimedout')
    )
  }

  /**
   * Sanitizes backend error messages
   */
  private sanitizeBackendError(statusCode: number): string {
    if (statusCode === 502) {
      return 'The service is temporarily unavailable'
    }
    if (statusCode === 503) {
      return 'The service is currently unavailable'
    }
    if (statusCode === 504) {
      return 'The service took too long to respond'
    }
    return 'An error occurred while processing your request'
  }

  /**
   * Gets error code for categorization
   */
  private getErrorCode(error: Error): string {
    if ((error as any).code) {
      return String((error as any).code)
    }

    const statusCode = this.getStatusCode(error)
    return `ERR_${statusCode}`
  }

  /**
   * Determines log level based on error
   */
  private getLogLevel(error: Error): 'info' | 'warn' | 'error' | 'critical' {
    const statusCode = this.getStatusCode(error)

    // 5xx errors are critical/error
    if (statusCode >= 500) {
      return statusCode === 500 ? 'critical' : 'error'
    }

    // 4xx errors are warnings (except 401/403 which might be attacks)
    if (statusCode >= 400) {
      if (statusCode === 401 || statusCode === 403) {
        return 'warn'
      }
      return 'info'
    }

    return 'info'
  }

  /**
   * Sanitizes circuit breaker errors
   */
  sanitizeCircuitBreakerError(error: Error): SafeError {
    const statusCode = 503
    const requestId = generateRequestId()
    const timestamp = Date.now()

    let message: string
    if (this.config.production) {
      message =
        'The service is temporarily unavailable. Please try again later.'
    } else {
      message = error.message || 'Circuit breaker is open'
    }

    return {
      statusCode,
      message,
      requestId,
      timestamp,
    }
  }

  /**
   * Sanitizes backend service errors
   */
  sanitizeBackendServiceError(error: Error, backendUrl?: string): SafeError {
    const statusCode = this.getStatusCode(error)
    const requestId = generateRequestId()
    const timestamp = Date.now()

    let message: string
    if (this.config.production) {
      // Never expose backend URLs in production
      message = this.sanitizeBackendError(statusCode)
    } else {
      // In development, include backend info but sanitize sensitive data
      const sanitizedUrl = backendUrl ? new URL(backendUrl).origin : 'backend'
      message = `Backend service error: ${error.message} (${sanitizedUrl})`
    }

    return {
      statusCode,
      message,
      requestId,
      timestamp,
    }
  }
}

/**
 * Factory function to create SecureErrorHandler
 */
export function createSecureErrorHandler(
  config?: ErrorHandlerConfig,
): SecureErrorHandler {
  return new SecureErrorHandler(config)
}

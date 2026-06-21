/**
 * Production-Grade Pino Logger Implementation for Bungate
 *
 * A high-performance, structured logging solution built on Pino with gateway-specific
 * enhancements for request tracing, performance monitoring, and operational visibility.
 *
 * Features:
 * - Ultra-fast JSON logging with minimal overhead
 * - Structured request/response logging with correlation IDs
 * - Performance metrics and timing information
 * - Configurable log levels and output formats
 * - Support for file, console, and custom output destinations
 * - Child logger creation for contextual logging
 * - Health check and load balancing event logging
 * - Integration with monitoring and alerting systems
 *
 * @example
 * ```ts
 * const logger = new BunGateLogger({
 *   level: 'info',
 *   format: 'json',
 *   enableRequestLogging: true,
 *   enableMetrics: true
 * })
 *
 * logger.info('Gateway started', { port: 3000, version: '1.0.0' })
 * logger.logRequest(request, response, 150)
 * ```
 */
import pino from 'pino'
import type { LoggerOptions, Logger as PinoLogger } from 'pino'
import type { Logger, LoggerConfig } from '../interfaces/logger'
import { safeMerge } from '../security/utils'

/**
 * Enhanced Pino logger with gateway-specific functionality
 *
 * Provides structured logging, request tracing, and performance monitoring
 * optimized for high-throughput API gateway operations.
 */
export class BunGateLogger implements Logger {
  /** Direct access to underlying Pino logger for advanced usage */
  readonly pino: PinoLogger
  /** Logger configuration with gateway-specific options */
  private config: LoggerConfig

  /**
   * Initialize the logger with comprehensive configuration
   *
   * @param config - Logger configuration including level, format, and output options
   */
  constructor(config: LoggerConfig = {}) {
    this.config = safeMerge(
      {
        level: 'info',
        format: 'json',
        enableRequestLogging: true,
        enableMetrics: true,
      } as LoggerConfig,
      config,
    )

    // Configure Pino logger with gateway-optimized settings
    const pinoConfig: any = {
      level: this.config.level,
      ...config,
      // Redact sensitive information from logs
      redact: {
        paths: [
          // API Keys
          'apiKey',
          'api_key',
          '*.apiKey',
          '*.api_key',
          'headers.apiKey',
          'headers.api_key',
          'headers["x-api-key"]',
          'headers["X-API-Key"]',
          'headers["X-Api-Key"]',
          'headers.authorization',
          'headers.Authorization',
          // JWT tokens
          'token',
          'accessToken',
          'access_token',
          'refreshToken',
          'refresh_token',
          'jwt',
          '*.token',
          '*.jwt',
          // Passwords and secrets
          'password',
          'passwd',
          'secret',
          'privateKey',
          'private_key',
          '*.password',
          '*.secret',
          // Credit card data
          'creditCard',
          'cardNumber',
          'cvv',
          'ccv',
          // Other sensitive fields
          'ssn',
          'social_security',
        ],
        censor: '[REDACTED]',
      },
    }

    // Configure pretty printing for development
    if (this.config.format === 'pretty') {
      pinoConfig.transport = {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    }

    // Configure file output for production logging
    if (this.config.output === 'file' && this.config.filePath) {
      pinoConfig.transport = {
        target: 'pino/file',
        options: {
          destination: this.config.filePath,
        },
      }
    }

    this.pino = pino(pinoConfig)
  }

  /**
   * Sanitizes sensitive data from objects before logging
   * Provides an additional layer of protection beyond Pino's redaction
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data
    }

    // Create a shallow copy to avoid mutating the original
    const sanitized = Array.isArray(data) ? [...data] : { ...data }

    // List of sensitive field names (case-insensitive patterns)
    const sensitiveKeys = [
      'apikey',
      'api_key',
      'x-api-key',
      'authorization',
      'token',
      'accesstoken',
      'access_token',
      'refreshtoken',
      'refresh_token',
      'jwt',
      'password',
      'passwd',
      'secret',
      'privatekey',
      'private_key',
      'creditcard',
      'cardnumber',
      'cvv',
      'ccv',
      'ssn',
      'social_security',
    ]

    for (const key in sanitized) {
      if (Object.prototype.hasOwnProperty.call(sanitized, key)) {
        const lowerKey = key.toLowerCase()

        // Check if key matches sensitive patterns
        if (sensitiveKeys.some((pattern) => lowerKey.includes(pattern))) {
          sanitized[key] = '[REDACTED]'
        }
        // Recursively sanitize nested objects
        else if (
          typeof sanitized[key] === 'object' &&
          sanitized[key] !== null
        ) {
          sanitized[key] = this.sanitizeData(sanitized[key])
        }
      }
    }

    return sanitized
  }

  /**
   * Sanitizes message strings that might contain sensitive information
   * Looks for common patterns of exposed secrets in log messages
   */
  private sanitizeMessage(message: string | undefined): string | undefined {
    if (!message || typeof message !== 'string') {
      return message
    }

    // Pattern to match common API key/token formats in strings
    // This catches patterns like: "apiKey: abc123", "token=xyz", "Bearer token123", etc.
    const sensitivePatterns = [
      // API keys with various formats
      /\b(api[_-]?key|apikey)[\s:=]+[^\s,}\]]+/gi,
      // Bearer tokens
      /\bBearer\s+[^\s,}\]]+/gi,
      // Token assignments
      /\b(token|jwt|access[_-]?token|refresh[_-]?token)[\s:=]+[^\s,}\]]+/gi,
      // Password assignments
      /\b(password|passwd|pwd)[\s:=]+[^\s,}\]]+/gi,
      // Secret assignments
      /\b(secret|private[_-]?key)[\s:=]+[^\s,}\]]+/gi,
      // Generic key-value patterns with sensitive keys
      /["']?(apiKey|api_key|token|password|secret)["']?\s*[:=]\s*["']?[^"',}\]\s]+/gi,
    ]

    let sanitized = message
    for (const pattern of sensitivePatterns) {
      sanitized = sanitized.replace(pattern, (match) => {
        // Keep the key name but redact the value
        const colonIndex = match.search(/[:=]/)
        if (colonIndex !== -1) {
          return match.substring(0, colonIndex + 1) + ' [REDACTED]'
        }
        return '[REDACTED]'
      })
    }

    return sanitized
  }

  getSerializers(): LoggerOptions['serializers'] | undefined {
    return this.config.serializers
  }

  info(message: string, data?: Record<string, any>): void
  info(obj: object, message?: string): void
  info(
    msgOrObj: string | object,
    dataOrMsg?: Record<string, any> | string,
  ): void {
    if (typeof msgOrObj === 'string') {
      const sanitizedData = this.sanitizeData(dataOrMsg || {})
      const sanitizedMsg = this.sanitizeMessage(msgOrObj)
      this.pino.info(sanitizedData, sanitizedMsg)
    } else {
      const sanitizedObj = this.sanitizeData(msgOrObj)
      const sanitizedMsg = this.sanitizeMessage(dataOrMsg as string)
      this.pino.info(sanitizedObj, sanitizedMsg)
    }
  }

  debug(message: string, data?: Record<string, any>): void
  debug(obj: object, message?: string): void
  debug(
    msgOrObj: string | object,
    dataOrMsg?: Record<string, any> | string,
  ): void {
    if (typeof msgOrObj === 'string') {
      const sanitizedData = this.sanitizeData(dataOrMsg || {})
      const sanitizedMsg = this.sanitizeMessage(msgOrObj)
      this.pino.debug(sanitizedData, sanitizedMsg)
    } else {
      const sanitizedObj = this.sanitizeData(msgOrObj)
      const sanitizedMsg = this.sanitizeMessage(dataOrMsg as string)
      this.pino.debug(sanitizedObj, sanitizedMsg)
    }
  }

  warn(message: string, data?: Record<string, any>): void
  warn(obj: object, message?: string): void
  warn(
    msgOrObj: string | object,
    dataOrMsg?: Record<string, any> | string,
  ): void {
    if (typeof msgOrObj === 'string') {
      const sanitizedData = this.sanitizeData(dataOrMsg || {})
      const sanitizedMsg = this.sanitizeMessage(msgOrObj)
      this.pino.warn(sanitizedData, sanitizedMsg)
    } else {
      const sanitizedObj = this.sanitizeData(msgOrObj)
      const sanitizedMsg = this.sanitizeMessage(dataOrMsg as string)
      this.pino.warn(sanitizedObj, sanitizedMsg)
    }
  }

  error(message: string, error?: Error, data?: Record<string, any>): void
  error(obj: object, message?: string): void
  error(
    msgOrObj: string | object,
    errorOrMsg?: Error | string,
    data?: Record<string, any>,
  ): void {
    if (typeof msgOrObj === 'string') {
      const errorData = {
        ...data,
        ...(errorOrMsg instanceof Error
          ? {
              error: {
                name: errorOrMsg.name,
                message: errorOrMsg.message,
                stack: errorOrMsg.stack,
              },
            }
          : {}),
      }
      const sanitizedData = this.sanitizeData(errorData)
      const sanitizedMsg = this.sanitizeMessage(msgOrObj)
      this.pino.error(sanitizedData, sanitizedMsg)
    } else {
      const sanitizedObj = this.sanitizeData(msgOrObj)
      const sanitizedMsg = this.sanitizeMessage(errorOrMsg as string)
      this.pino.error(sanitizedObj, sanitizedMsg)
    }
  }

  logRequest(request: Request, response?: Response, duration?: number): void {
    if (!this.config.enableRequestLogging) return

    const url = new URL(request.url)
    const requestData: any = {
      request: {
        method: request.method,
        url: request.url,
        path: url.pathname,
        userAgent: request.headers.get('user-agent'),
        contentLength: request.headers.get('content-length'),
      },
    }

    if (this.config.includeHeaders) {
      requestData.request.headers = Object.fromEntries(
        request.headers.entries(),
      )
    }

    if (response) {
      requestData.response = {
        status: response.status,
        contentLength: response.headers.get('content-length'),
        contentType: response.headers.get('content-type'),
      }

      if (this.config.includeHeaders) {
        requestData.response.headers = Object.fromEntries(
          response.headers.entries(),
        )
      }

      if (duration !== undefined) {
        requestData.response.duration = duration
      }
    }

    this.pino.info(requestData, `${request.method} ${url.pathname}`)
  }

  child(context: Record<string, any>): Logger {
    const childPino = this.pino.child(context)
    const childLogger = Object.create(this)
    childLogger.pino = childPino
    return childLogger as Logger
  }

  setLevel(level: LoggerConfig['level']): void {
    if (level) {
      this.pino.level = level
      this.config.level = level
    }
  }

  getLevel(): LoggerConfig['level'] {
    return this.config.level
  }

  logMetrics(
    component: string,
    operation: string,
    duration: number,
    metadata?: Record<string, any>,
  ): void {
    if (!this.config.enableMetrics) return

    this.pino.info(
      {
        metrics: {
          component,
          operation,
          duration,
          ...metadata,
        },
      },
      `${component}.${operation} completed in ${duration}ms`,
    )
  }

  logHealthCheck(
    target: string,
    healthy: boolean,
    duration: number,
    error?: Error,
  ): void {
    const logData: any = {
      healthCheck: {
        target,
        healthy,
        duration,
      },
    }

    if (error) {
      logData.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      }
    }

    const message = `Health check for ${target}: ${healthy ? 'healthy' : 'unhealthy'} (${duration}ms)`

    if (healthy) {
      this.pino.debug(logData, message)
    } else {
      this.pino.warn(logData, message)
    }
  }

  logLoadBalancing(
    strategy: string,
    targetUrl: string,
    metadata?: Record<string, any>,
  ): void {
    this.pino.debug(
      {
        loadBalancer: {
          strategy,
          selectedTarget: targetUrl,
          ...metadata,
        },
      },
      `Load balancer selected target using ${strategy} strategy`,
    )
  }
}

/**
 * Factory function to create a logger instance
 */
export function createLogger(config?: LoggerConfig): Logger {
  return new BunGateLogger(config)
}

/**
 * Default logger instance
 */
export const defaultLogger = createLogger({
  level: 'info',
  format: 'pretty',
})

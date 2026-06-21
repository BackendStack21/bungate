/**
 * Security Headers Module
 *
 * Provides middleware for adding security headers to HTTP responses
 */

import type { SecurityHeadersConfig } from './config'
import type { ValidationResult } from './types'

/**
 * Security Headers Middleware Class
 * Manages and applies security headers to responses
 */
export class SecurityHeadersMiddleware {
  private config: Required<SecurityHeadersConfig>

  constructor(config: Partial<SecurityHeadersConfig> = {}) {
    // Set defaults - merge with provided config
    this.config = {
      enabled: config.enabled ?? true,
      hsts: config.hsts
        ? {
            maxAge: config.hsts.maxAge ?? 31536000, // 1 year
            includeSubDomains: config.hsts.includeSubDomains ?? true,
            preload: config.hsts.preload ?? false,
          }
        : {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: false,
          },
      contentSecurityPolicy: config.contentSecurityPolicy,
      xFrameOptions: config.xFrameOptions ?? 'DENY',
      xContentTypeOptions: config.xContentTypeOptions ?? true,
      referrerPolicy:
        config.referrerPolicy ?? 'strict-origin-when-cross-origin',
      permissionsPolicy: config.permissionsPolicy,
      customHeaders: config.customHeaders ?? {},
    } as Required<SecurityHeadersConfig>
  }

  /**
   * Apply security headers to a response
   */
  applyHeaders(response: Response, isHttps: boolean = false): Response {
    if (!this.config.enabled) {
      return response
    }

    const headers = new Headers(response.headers)

    // Add HSTS header (only for HTTPS)
    if (isHttps && this.config.hsts) {
      const hstsValue = this.generateHSTSHeader()
      headers.set('Strict-Transport-Security', hstsValue)
    }

    // Add X-Content-Type-Options header
    if (this.config.xContentTypeOptions) {
      headers.set('X-Content-Type-Options', 'nosniff')
    }

    // Add X-Frame-Options header
    if (this.config.xFrameOptions) {
      headers.set('X-Frame-Options', this.config.xFrameOptions)
    }

    // Add Referrer-Policy header
    if (this.config.referrerPolicy) {
      headers.set('Referrer-Policy', this.config.referrerPolicy)
    }

    // Add Permissions-Policy header
    if (this.config.permissionsPolicy) {
      const permissionsPolicyValue = this.generatePermissionsPolicyHeader()
      if (permissionsPolicyValue) {
        headers.set('Permissions-Policy', permissionsPolicyValue)
      }
    }

    // Add Content-Security-Policy header
    if (this.config.contentSecurityPolicy) {
      const cspValue = this.generateCSPHeader()
      const headerName = this.config.contentSecurityPolicy.reportOnly
        ? 'Content-Security-Policy-Report-Only'
        : 'Content-Security-Policy'
      headers.set(headerName, cspValue)
    }

    // Add custom headers
    if (this.config.customHeaders) {
      for (const [name, value] of Object.entries(this.config.customHeaders)) {
        if (value === undefined || value === null) continue
        // Validate header name and value to prevent injection / header smuggling
        if (!this.isValidHeaderName(name)) {
          continue
        }
        const sanitizedValue = this.sanitizeHeaderValue(String(value))
        if (sanitizedValue === null) {
          continue
        }
        // Merge with existing headers (custom headers take precedence)
        headers.set(name, sanitizedValue)
      }
    }

    // Create new response with updated headers
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }

  /**
   * Generate HSTS header value
   */
  private generateHSTSHeader(): string {
    const parts: string[] = [`max-age=${this.config.hsts.maxAge}`]

    if (this.config.hsts.includeSubDomains) {
      parts.push('includeSubDomains')
    }

    if (this.config.hsts.preload) {
      parts.push('preload')
    }

    return parts.join('; ')
  }

  /**
   * Generate Content-Security-Policy header value
   */
  private generateCSPHeader(): string {
    if (!this.config.contentSecurityPolicy?.directives) {
      // Default CSP if no directives specified
      return "default-src 'self'"
    }

    const directives: string[] = []
    for (const [directive, values] of Object.entries(
      this.config.contentSecurityPolicy.directives,
    )) {
      if (values && values.length > 0) {
        directives.push(`${directive} ${values.join(' ')}`)
      }
    }

    return directives.join('; ')
  }

  /**
   * Generate Permissions-Policy header value
   */
  private generatePermissionsPolicyHeader(): string {
    if (!this.config.permissionsPolicy) {
      return ''
    }

    const policies: string[] = []
    for (const [feature, allowlist] of Object.entries(
      this.config.permissionsPolicy,
    )) {
      if (allowlist && allowlist.length > 0) {
        const origins = allowlist.join(' ')
        policies.push(`${feature}=(${origins})`)
      } else {
        // Empty allowlist means feature is disabled
        policies.push(`${feature}=()`)
      }
    }

    return policies.join(', ')
  }

  /**
   * Validates a header name against RFC 7230 token syntax.
   */
  private isValidHeaderName(name: string): boolean {
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
  }

  /**
   * Sanitizes a header value, returning null if it contains forbidden characters.
   */
  private sanitizeHeaderValue(value: string): string | null {
    // Allow RFC 7230 field-vchar (visible ASCII / obs-text) plus HTAB
    if (!/[\t\x20-\x7E\x80-\xFF]*$/.test(value)) {
      return null
    }
    // Remove control characters except HTAB and DEL
    return value.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '')
  }

  /**
   * Validate CSP configuration
   */
  validateCSPConfig(): ValidationResult {
    const errors: string[] = []

    if (!this.config.contentSecurityPolicy?.directives) {
      return { valid: true }
    }

    const directives = this.config.contentSecurityPolicy.directives

    // Check for unsafe directives
    for (const [directive, values] of Object.entries(directives)) {
      if (!values || values.length === 0) continue

      // Validate directive name
      if (!this.isValidCSPDirective(directive)) {
        errors.push(`Unknown CSP directive: '${directive}'`)
      }

      // Warn about unsafe-inline and unsafe-eval
      if (values.includes("'unsafe-inline'")) {
        errors.push(
          `CSP directive '${directive}' contains 'unsafe-inline' which reduces security`,
        )
      }
      if (values.includes("'unsafe-eval'")) {
        errors.push(
          `CSP directive '${directive}' contains 'unsafe-eval' which reduces security`,
        )
      }

      // Warn about wildcard sources
      if (values.includes('*')) {
        errors.push(
          `CSP directive '${directive}' contains wildcard '*' which is overly permissive`,
        )
      }

      // Validate source values
      for (const value of values) {
        if (!this.isValidCSPSource(value)) {
          errors.push(
            `Invalid CSP source value '${value}' in directive '${directive}'`,
          )
        }
      }
    }

    // Check for missing default-src
    if (!directives['default-src']) {
      errors.push(
        "CSP missing 'default-src' directive - recommended for fallback",
      )
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Check if a CSP directive name is valid
   */
  private isValidCSPDirective(directive: string): boolean {
    const validDirectives = [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'media-src',
      'object-src',
      'frame-src',
      'child-src',
      'worker-src',
      'manifest-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
      'plugin-types',
      'report-uri',
      'report-to',
      'sandbox',
      'upgrade-insecure-requests',
      'block-all-mixed-content',
      'require-trusted-types-for',
      'trusted-types',
    ]
    return validDirectives.includes(directive)
  }

  /**
   * Check if a CSP source value is valid
   */
  private isValidCSPSource(source: string): boolean {
    // Keywords must be quoted
    const keywords = [
      "'self'",
      "'none'",
      "'unsafe-inline'",
      "'unsafe-eval'",
      "'strict-dynamic'",
      "'unsafe-hashes'",
      "'report-sample'",
    ]

    if (keywords.includes(source)) {
      return true
    }

    // Wildcard
    if (source === '*') {
      return true
    }

    // Scheme sources (e.g., https:, data:, blob:)
    if (/^[a-z][a-z0-9+.-]*:$/i.test(source)) {
      return true
    }

    // Host sources (e.g., example.com, *.example.com, https://example.com)
    if (
      /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(
        source,
      )
    ) {
      return true
    }

    // URL sources
    if (/^https?:\/\//i.test(source)) {
      return true
    }

    // Nonce sources (e.g., 'nonce-abc123')
    if (/^'nonce-[a-zA-Z0-9+/=]+'$/.test(source)) {
      return true
    }

    // Hash sources (e.g., 'sha256-abc123')
    if (/^'(sha256|sha384|sha512)-[a-zA-Z0-9+/=]+'$/.test(source)) {
      return true
    }

    return false
  }

  /**
   * Get current configuration
   */
  getConfig(): SecurityHeadersConfig {
    return { ...this.config }
  }
}

/**
 * Factory function to create SecurityHeadersMiddleware instance
 */
export function createSecurityHeadersMiddleware(
  config?: Partial<SecurityHeadersConfig>,
): SecurityHeadersMiddleware {
  return new SecurityHeadersMiddleware(config)
}

/**
 * Default security headers configuration
 */
export const DEFAULT_SECURITY_HEADERS: SecurityHeadersConfig = {
  enabled: true,
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: false,
  },
  xFrameOptions: 'DENY',
  xContentTypeOptions: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
}

/**
 * Middleware configuration for security headers
 */
export interface SecurityHeadersMiddlewareConfig extends SecurityHeadersConfig {
  detectHttps?: (req: Request) => boolean
}

/**
 * Create a middleware function that applies security headers to responses
 *
 * @param config - Security headers configuration
 * @returns Middleware function
 */
export function createSecurityHeadersMiddlewareFunction(
  config?: Partial<SecurityHeadersMiddlewareConfig>,
): (req: Request, res: Response) => Response {
  const middleware = new SecurityHeadersMiddleware(config)

  // Default HTTPS detection function
  const detectHttps =
    config?.detectHttps ??
    ((req: Request) => {
      const url = new URL(req.url)
      return url.protocol === 'https:'
    })

  return (req: Request, res: Response): Response => {
    const isHttps = detectHttps(req)
    return middleware.applyHeaders(res, isHttps)
  }
}

/**
 * Pre-configured middleware function with default settings
 */
export const securityHeadersMiddleware =
  createSecurityHeadersMiddlewareFunction()

/**
 * Merge custom headers with existing response headers
 * Custom headers take precedence over existing headers
 *
 * @param response - Original response
 * @param customHeaders - Custom headers to merge
 * @returns Response with merged headers
 */
export function mergeHeaders(
  response: Response,
  customHeaders: Record<string, string>,
): Response {
  const headers = new Headers(response.headers)

  for (const [name, value] of Object.entries(customHeaders)) {
    headers.set(name, value)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * Helper function to check if a response already has security headers
 *
 * @param response - Response to check
 * @returns Object indicating which security headers are present
 */
export function hasSecurityHeaders(response: Response): {
  hsts: boolean
  xContentTypeOptions: boolean
  xFrameOptions: boolean
  referrerPolicy: boolean
  csp: boolean
  permissionsPolicy: boolean
} {
  const headers = response.headers
  return {
    hsts: headers.has('Strict-Transport-Security'),
    xContentTypeOptions: headers.has('X-Content-Type-Options'),
    xFrameOptions: headers.has('X-Frame-Options'),
    referrerPolicy: headers.has('Referrer-Policy'),
    csp:
      headers.has('Content-Security-Policy') ||
      headers.has('Content-Security-Policy-Report-Only'),
    permissionsPolicy: headers.has('Permissions-Policy'),
  }
}

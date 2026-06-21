/**
 * Input validation and sanitization module
 * Validates and sanitizes user inputs to prevent injection attacks
 */

import type { ValidationResult, ValidationRules } from './types'
import {
  sanitizePath,
  sanitizeHeader,
  containsOnlyAllowedChars,
  matchesBlockedPattern,
  recursiveDecodeURIComponent,
} from './utils'
import { DEFAULT_SECURITY_CONFIG } from './config'

/**
 * Input validator class for validating and sanitizing user inputs
 */
export class InputValidator {
  private rules: Required<ValidationRules>

  constructor(rules?: Partial<ValidationRules>) {
    // Merge with defaults
    const defaults = DEFAULT_SECURITY_CONFIG.inputValidation!
    this.rules = {
      maxPathLength: rules?.maxPathLength ?? defaults.maxPathLength!,
      maxHeaderSize: rules?.maxHeaderSize ?? defaults.maxHeaderSize!,
      maxHeaderCount: rules?.maxHeaderCount ?? defaults.maxHeaderCount!,
      allowedPathChars: rules?.allowedPathChars ?? defaults.allowedPathChars!,
      blockedPatterns: rules?.blockedPatterns ?? defaults.blockedPatterns!,
      sanitizeHeaders: rules?.sanitizeHeaders ?? defaults.sanitizeHeaders!,
    }
  }

  /**
   * Validates a URL path against security rules
   */
  validatePath(path: string): ValidationResult {
    const errors: string[] = []

    if (!path) {
      errors.push('Path cannot be empty')
      return { valid: false, errors }
    }

    // First pass: check blocked patterns on raw path
    // Catches null bytes, basic ../ patterns, etc.
    if (matchesBlockedPattern(path, this.rules.blockedPatterns)) {
      errors.push('Path contains blocked patterns')
      // Don't return early — still apply sanitization for defense-in-depth
    }

    // Recursively decode URL encoding to defeat double-encoding attacks
    // Strip null bytes first (they break decoding and were already checked above)
    const decoded = recursiveDecodeURIComponent(path.replace(/\0/g, ''))

    // Second pass: check blocked patterns on the fully-decoded path
    // Catches attacks hidden behind multiple layers of URL encoding
    // (e.g., %252f → %2f → /, which passes the raw check but fails decoded)
    if (
      decoded !== path &&
      matchesBlockedPattern(decoded, this.rules.blockedPatterns)
    ) {
      errors.push('Path contains blocked patterns')
    }

    // Check path length on the fully-decoded path
    if (decoded.length > this.rules.maxPathLength) {
      errors.push(`Path exceeds maximum length of ${this.rules.maxPathLength}`)
    }

    // Check if decoded path contains only allowed characters
    if (!containsOnlyAllowedChars(decoded, this.rules.allowedPathChars)) {
      errors.push('Path contains invalid characters')
    }

    // Sanitize the fully-decoded path (strip traversals, normalize slashes)
    const sanitized = sanitizePath(decoded)

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      sanitized,
    }
  }

  /**
   * Validates HTTP headers against RFC specifications
   */
  validateHeaders(headers: Headers): ValidationResult {
    const errors: string[] = []
    let headerCount = 0
    let totalHeaderSize = 0

    for (const [name, value] of headers.entries()) {
      headerCount++

      // Check header count limit
      if (headerCount > this.rules.maxHeaderCount) {
        errors.push(
          `Header count exceeds maximum of ${this.rules.maxHeaderCount}`,
        )
        break
      }

      // Calculate header size (name + value + separators)
      const headerSize = name.length + value.length + 4 // ": " and "\r\n"
      totalHeaderSize += headerSize

      // Check total header size
      if (totalHeaderSize > this.rules.maxHeaderSize) {
        errors.push(
          `Total header size exceeds maximum of ${this.rules.maxHeaderSize} bytes`,
        )
        break
      }

      // Validate header name (RFC 7230: field-name = token)
      if (!this.isValidHeaderName(name)) {
        errors.push(`Invalid header name: ${name}`)
      }

      // Validate header value (no control characters except HTAB)
      if (!this.isValidHeaderValue(value)) {
        errors.push(`Invalid header value for: ${name}`)
      }

      // Check for null bytes
      if (name.includes('\0') || value.includes('\0')) {
        errors.push(`Header contains null bytes: ${name}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Validates query parameters for malicious patterns
   */
  validateQueryParams(params: URLSearchParams): ValidationResult {
    const errors: string[] = []
    const paramCount = Array.from(params.keys()).length

    // Check parameter count (using maxQueryParams from size limits)
    const maxParams = 100 // Default from size limits
    if (paramCount > maxParams) {
      errors.push(`Query parameter count exceeds maximum of ${maxParams}`)
    }

    // Validate each parameter
    for (const [name, value] of params.entries()) {
      // Check for null bytes
      if (name.includes('\0') || value.includes('\0')) {
        errors.push(`Query parameter contains null bytes: ${name}`)
      }

      // Check against blocked patterns
      if (this.rules.blockedPatterns) {
        for (const pattern of this.rules.blockedPatterns) {
          if (pattern.test(value) || pattern.test(name)) {
            errors.push(`Query parameter contains blocked pattern: ${name}`)
            break
          }
        }
      }

      // Check for SQL injection patterns
      if (this.containsSQLInjectionPattern(value)) {
        errors.push(`Query parameter contains suspicious SQL patterns: ${name}`)
      }

      // Check for XSS patterns
      if (this.containsXSSPattern(value)) {
        errors.push(`Query parameter contains suspicious XSS patterns: ${name}`)
      }

      // Check for command injection patterns
      if (this.containsCommandInjectionPattern(value)) {
        errors.push(
          `Query parameter contains suspicious command injection patterns: ${name}`,
        )
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Sanitizes headers by removing control characters
   */
  sanitizeHeaders(headers: Headers): Headers {
    if (!this.rules.sanitizeHeaders) {
      return headers
    }

    const sanitized = new Headers()

    for (const [name, value] of headers.entries()) {
      const sanitizedValue = sanitizeHeader(value)
      sanitized.set(name, sanitizedValue)
    }

    return sanitized
  }

  /**
   * Validates header name according to RFC 7230
   * field-name = token
   * token = 1*tchar
   * tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." /
   *         "0-9" / "A-Z" / "^" / "_" / "`" / "a-z" / "|" / "~"
   */
  private isValidHeaderName(name: string): boolean {
    if (!name || name.length === 0) {
      return false
    }

    // RFC 7230 token characters
    const tokenPattern = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/
    return tokenPattern.test(name)
  }

  /**
   * Validates header value according to RFC 7230
   * field-value = *( field-content / obs-fold )
   * field-content = field-vchar [ 1*( SP / HTAB ) field-vchar ]
   * field-vchar = VCHAR / obs-text
   * obs-text = %x80-FF
   */
  private isValidHeaderValue(value: string): boolean {
    // Allow printable ASCII, space, tab, and extended ASCII
    // Disallow other control characters
    const validPattern = /^[\x20-\x7E\x80-\xFF\t]*$/
    return validPattern.test(value)
  }

  /**
   * Checks for SQL injection patterns
   */
  private containsSQLInjectionPattern(value: string): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/i,
      /(UNION\s+SELECT)/i,
      /('|\"|;|--|\*|\/\*|\*\/)/,
      /(OR\s+1\s*=\s*1)/i,
      /(AND\s+1\s*=\s*1)/i,
    ]

    return sqlPatterns.some((pattern) => pattern.test(value))
  }

  /**
   * Checks for XSS patterns
   */
  private containsXSSPattern(value: string): boolean {
    const xssPatterns = [
      /<script\b[^>]*>.*?<\/script\b[^>]*>/gis,
      /<iframe[^>]*>/i,
      /javascript:/i,
      /on\w+\s*=/i, // Event handlers like onclick=
      /<img[^>]+src[^>]*>/i,
      /eval\s*\(/i,
    ]

    return xssPatterns.some((pattern) => pattern.test(value))
  }

  /**
   * Checks for command injection patterns
   */
  private containsCommandInjectionPattern(value: string): boolean {
    const commandPatterns = [/[;&|`$()]/, /\$\{.*\}/, /\$\(.*\)/]

    return commandPatterns.some((pattern) => pattern.test(value))
  }
}

/**
 * Creates a default input validator instance
 */
export function createInputValidator(
  rules?: Partial<ValidationRules>,
): InputValidator {
  return new InputValidator(rules)
}

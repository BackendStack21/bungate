/**
 * Request size limiter module
 * Enforces limits on request sizes to prevent DoS attacks
 */

import type { SizeLimits } from './config'
import type { ValidationResult } from './types'
import { safeMerge } from './utils'

/**
 * Default size limits based on RFC recommendations
 */
const DEFAULT_SIZE_LIMITS: Required<SizeLimits> = {
  maxBodySize: 10 * 1024 * 1024, // 10MB
  maxHeaderSize: 16384, // 16KB
  maxHeaderCount: 100,
  maxUrlLength: 2048,
  maxQueryParams: 100,
}

/**
 * SizeLimiter class for validating request sizes
 */
export class SizeLimiter {
  private limits: Required<SizeLimits>

  constructor(limits?: Partial<SizeLimits>) {
    this.limits = safeMerge(DEFAULT_SIZE_LIMITS, limits) as Required<SizeLimits>
  }

  /**
   * Validates request body size.
   *
   * Checks Content-Length first. In production, Bun.serve's maxRequestBodySize
   * (configured by the gateway) provides defense-in-depth against chunked or
   * mismatched Content-Length bodies. The middleware layer cannot safely consume
   * and re-attach the body stream because Request.body is read-only.
   */
  async validateBodySize(req: Request): Promise<ValidationResult> {
    const contentLength = req.headers.get('content-length')

    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (isNaN(size)) {
        return {
          valid: false,
          errors: ['Invalid Content-Length header'],
        }
      }

      if (size > this.limits.maxBodySize) {
        return {
          valid: false,
          errors: [
            `Request body size (${size} bytes) exceeds maximum allowed size (${this.limits.maxBodySize} bytes)`,
          ],
        }
      }
    }

    return { valid: true }
  }

  /**
   * Validates header size and count
   */
  validateHeaders(headers: Headers): ValidationResult {
    const errors: string[] = []

    // Count headers
    let headerCount = 0
    let totalHeaderSize = 0

    for (const [name, value] of headers.entries()) {
      headerCount++
      // Calculate size: name + ": " + value + "\r\n"
      totalHeaderSize += name.length + 2 + value.length + 2
    }

    // Check header count
    if (headerCount > this.limits.maxHeaderCount) {
      errors.push(
        `Header count (${headerCount}) exceeds maximum allowed (${this.limits.maxHeaderCount})`,
      )
    }

    // Check total header size
    if (totalHeaderSize > this.limits.maxHeaderSize) {
      errors.push(
        `Total header size (${totalHeaderSize} bytes) exceeds maximum allowed (${this.limits.maxHeaderSize} bytes)`,
      )
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Validates URL length
   */
  validateUrlLength(url: string): ValidationResult {
    const urlLength = url.length

    if (urlLength > this.limits.maxUrlLength) {
      return {
        valid: false,
        errors: [
          `URL length (${urlLength}) exceeds maximum allowed (${this.limits.maxUrlLength})`,
        ],
      }
    }

    return { valid: true }
  }

  /**
   * Validates query parameter count
   */
  validateQueryParams(params: URLSearchParams): ValidationResult {
    let paramCount = 0

    // Count all parameters (including duplicates)
    for (const _ of params.keys()) {
      paramCount++
    }

    if (paramCount > this.limits.maxQueryParams) {
      return {
        valid: false,
        errors: [
          `Query parameter count (${paramCount}) exceeds maximum allowed (${this.limits.maxQueryParams})`,
        ],
      }
    }

    return { valid: true }
  }

  /**
   * Validates all request size constraints
   */
  async validateRequest(req: Request): Promise<ValidationResult> {
    const errors: string[] = []

    // Validate URL length
    const urlResult = this.validateUrlLength(req.url)
    if (!urlResult.valid && urlResult.errors) {
      errors.push(...urlResult.errors)
    }

    // Validate headers
    const headerResult = this.validateHeaders(req.headers)
    if (!headerResult.valid && headerResult.errors) {
      errors.push(...headerResult.errors)
    }

    // Validate query parameters
    const url = new URL(req.url)
    const queryResult = this.validateQueryParams(url.searchParams)
    if (!queryResult.valid && queryResult.errors) {
      errors.push(...queryResult.errors)
    }

    // Validate body size (for requests with bodies)
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const bodyResult = await this.validateBodySize(req)
      if (!bodyResult.valid && bodyResult.errors) {
        errors.push(...bodyResult.errors)
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Get current size limits configuration
   */
  getLimits(): Required<SizeLimits> {
    return { ...this.limits }
  }
}

/**
 * Factory function to create a SizeLimiter instance
 */
export function createSizeLimiter(limits?: Partial<SizeLimits>): SizeLimiter {
  return new SizeLimiter(limits)
}

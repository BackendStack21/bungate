/**
 * JWT Key Rotation Middleware
 *
 * Middleware wrapper that enhances JWT authentication with key rotation support.
 * Provides backward compatibility with single secret configuration.
 */

import type {
  RequestHandler,
  ZeroRequest,
  StepFunction,
} from '../interfaces/middleware'
import type { JWTKeyConfig } from './config'
import { JWTKeyRotationManager } from './jwt-key-rotation'

/**
 * JWT Key Rotation Middleware Options
 */
export interface JWTKeyRotationMiddlewareOptions {
  /**
   * JWT key rotation configuration
   * Can be a full JWTKeyConfig or a single secret string for backward compatibility
   */
  config: JWTKeyConfig | string

  /**
   * Custom logger function
   */
  logger?: (message: string, meta?: any) => void

  /**
   * Paths to exclude from JWT verification
   */
  excludePaths?: string[]

  /**
   * Custom token extraction function
   * Defaults to extracting from Authorization header
   */
  extractToken?: (req: ZeroRequest) => string | null

  /**
   * Custom error handler
   */
  onError?: (error: Error, req: ZeroRequest) => Response
}

/**
 * Default token extraction from Authorization header
 */
function defaultExtractToken(req: ZeroRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return null

  const parts = authHeader.split(' ')
  if (parts.length !== 2) return null
  const scheme = parts[0]
  const token = parts[1]
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null
  }

  return token
}

/**
 * Default error handler
 */
function defaultErrorHandler(error: Error, req: ZeroRequest): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      },
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )
}

/**
 * Normalizes configuration to JWTKeyConfig format
 */
function normalizeConfig(config: JWTKeyConfig | string): JWTKeyConfig {
  if (typeof config === 'string') {
    // Backward compatibility: single secret string
    return {
      secrets: [
        {
          key: config,
          algorithm: 'HS256',
          primary: true,
        },
      ],
    }
  }
  return config
}

/**
 * Creates JWT key rotation middleware
 *
 * @example
 * ```typescript
 * // Single secret (backward compatible)
 * const middleware = createJWTKeyRotationMiddleware({
 *   config: 'my-secret-key'
 * });
 *
 * // Multiple secrets with rotation
 * const middleware = createJWTKeyRotationMiddleware({
 *   config: {
 *     secrets: [
 *       { key: 'new-key', algorithm: 'HS256', primary: true },
 *       { key: 'old-key', algorithm: 'HS256', deprecated: true }
 *     ],
 *     gracePeriod: 86400000 // 24 hours
 *   }
 * });
 *
 * // With JWKS
 * const middleware = createJWTKeyRotationMiddleware({
 *   config: {
 *     secrets: [],
 *     jwksUri: 'https://example.com/.well-known/jwks.json',
 *     jwksRefreshInterval: 3600000 // 1 hour
 *   }
 * });
 * ```
 */
export function createJWTKeyRotationMiddleware(
  options: JWTKeyRotationMiddlewareOptions,
): RequestHandler {
  const config = normalizeConfig(options.config)
  const manager = new JWTKeyRotationManager(config, options.logger)
  const extractToken = options.extractToken || defaultExtractToken
  const onError = options.onError || defaultErrorHandler
  const excludePaths = options.excludePaths || []

  return async (req: ZeroRequest, next: StepFunction): Promise<Response> => {
    // Check if path is excluded
    const url = new URL(req.url)
    const pathname = url.pathname

    for (const excludePath of excludePaths) {
      if (pathname.startsWith(excludePath)) {
        return next() // Continue to next middleware
      }
    }

    // Extract token
    const token = extractToken(req)
    if (!token) {
      return onError(new Error('No token provided'), req)
    }

    try {
      // Verify token
      const result = await manager.verifyToken(token)

      // Attach payload to request
      ;(req as any).jwt = result.payload
      ;(req as any).jwtHeader = result.protectedHeader

      // Log if deprecated key was used
      if (result.usedDeprecatedKey) {
        options.logger?.('Request authenticated with deprecated key', {
          path: pathname,
          keyId: result.keyId,
        })
      }

      // Continue to next middleware
      return next()
    } catch (error) {
      return onError(
        error instanceof Error ? error : new Error(String(error)),
        req,
      )
    }
  }
}

/**
 * Helper function to create a token signing function
 *
 * @example
 * ```typescript
 * const signToken = createTokenSigner({
 *   config: {
 *     secrets: [
 *       { key: 'my-secret', algorithm: 'HS256', primary: true }
 *     ]
 *   }
 * });
 *
 * const token = await signToken({ userId: '123', role: 'admin' }, { expiresIn: '1h' });
 * ```
 */
export function createTokenSigner(options: {
  config: JWTKeyConfig | string
  logger?: (message: string, meta?: any) => void
}) {
  const config = normalizeConfig(options.config)
  const manager = new JWTKeyRotationManager(config, options.logger)

  return async (
    payload: Record<string, any>,
    options?: { expiresIn?: string | number },
  ): Promise<string> => {
    return manager.signToken(payload, options)
  }
}

/**
 * Helper function to create a token verifier
 *
 * @example
 * ```typescript
 * const verifyToken = createTokenVerifier({
 *   config: {
 *     secrets: [
 *       { key: 'new-key', algorithm: 'HS256', primary: true },
 *       { key: 'old-key', algorithm: 'HS256', deprecated: true }
 *     ]
 *   }
 * });
 *
 * const result = await verifyToken('eyJhbGc...');
 * console.log(result.payload);
 * ```
 */
export function createTokenVerifier(options: {
  config: JWTKeyConfig | string
  logger?: (message: string, meta?: any) => void
}) {
  const config = normalizeConfig(options.config)
  const manager = new JWTKeyRotationManager(config, options.logger)

  return async (token: string) => {
    return manager.verifyToken(token)
  }
}

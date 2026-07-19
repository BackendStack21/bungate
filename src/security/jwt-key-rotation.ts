/**
 * JWT Key Rotation Manager
 *
 * Provides support for JWT key rotation without service downtime.
 * Supports multiple secrets for verification while using a primary key for signing.
 * Includes JWKS refresh mechanism for automatic key updates.
 */

import { jwtVerify, SignJWT, createRemoteJWKSet, type JWTPayload } from 'jose'
import type { JWTKeyConfig } from './config'

/**
 * JWT key with metadata
 */
export interface JWTKey {
  key: string | Buffer
  algorithm: string
  kid?: string
  primary?: boolean
  deprecated?: boolean
  expiresAt?: number
}

/**
 * JWKS cache entry
 */
interface JWKSCacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>
  lastRefresh: number
  nextRefresh: number
}

/**
 * JWT verification result
 */
export interface JWTVerificationResult {
  payload: JWTPayload
  protectedHeader: any
  usedDeprecatedKey?: boolean
  keyId?: string
}

/**
 * JWT Key Rotation Manager
 *
 * Manages multiple JWT secrets for key rotation and JWKS refresh.
 */
export class JWTKeyRotationManager {
  private config: JWTKeyConfig
  private jwksCache?: JWKSCacheEntry
  private refreshTimer?: Timer
  private logger?: (message: string, meta?: any) => void

  constructor(
    config: JWTKeyConfig,
    logger?: (message: string, meta?: any) => void,
  ) {
    this.config = config
    this.logger = logger

    // Validate configuration
    this.validateConfig()

    // Start JWKS refresh if configured
    if (this.config.jwksUri) {
      this.initializeJWKS()
    }
  }

  /**
   * Validates the JWT key configuration
   */
  private validateConfig(): void {
    const hasJwks = !!this.config.jwksUri

    if (!this.config.secrets || this.config.secrets.length === 0) {
      if (!hasJwks) {
        throw new Error(
          'At least one JWT secret or a jwksUri must be configured',
        )
      }
      // JWKS-only configuration is valid for verification.
      return
    }

    const primaryKeys = this.config.secrets.filter((s) => s.primary)
    if (primaryKeys.length === 0) {
      // If no primary key is specified, use the first one
      const firstSecret = this.config.secrets[0]
      if (firstSecret) {
        firstSecret.primary = true
      }
    } else if (primaryKeys.length > 1) {
      throw new Error('Only one primary key can be configured')
    }

    // Validate algorithms
    const validAlgorithms = [
      'HS256',
      'HS384',
      'HS512',
      'RS256',
      'RS384',
      'RS512',
      'ES256',
      'ES384',
      'ES512',
    ]
    for (const secret of this.config.secrets) {
      if (!validAlgorithms.includes(secret.algorithm)) {
        throw new Error(`Invalid algorithm: ${secret.algorithm}`)
      }
    }
  }

  /**
   * Initializes JWKS and starts refresh timer
   */
  private initializeJWKS(): void {
    if (!this.config.jwksUri) return

    const jwks = createRemoteJWKSet(new URL(this.config.jwksUri))
    const now = Date.now()
    const refreshInterval = this.config.jwksRefreshInterval || 3600000 // Default: 1 hour

    this.jwksCache = {
      jwks,
      lastRefresh: now,
      nextRefresh: now + refreshInterval,
    }

    // Start background refresh
    this.startJWKSRefresh()
  }

  /**
   * Starts background JWKS refresh task
   */
  private startJWKSRefresh(): void {
    if (!this.config.jwksUri || !this.config.jwksRefreshInterval) return

    this.refreshTimer = setInterval(() => {
      this.refreshJWKS().catch((err) => {
        this.logger?.('JWKS refresh failed', { error: err.message })
      })
    }, this.config.jwksRefreshInterval)
  }

  /**
   * Refreshes JWKS from the remote endpoint
   */
  async refreshJWKS(): Promise<void> {
    if (!this.config.jwksUri) {
      throw new Error('JWKS URI not configured')
    }

    try {
      const jwks = createRemoteJWKSet(new URL(this.config.jwksUri))
      const now = Date.now()
      const refreshInterval = this.config.jwksRefreshInterval || 3600000

      this.jwksCache = {
        jwks,
        lastRefresh: now,
        nextRefresh: now + refreshInterval,
      }

      this.logger?.('JWKS refreshed successfully', {
        uri: this.config.jwksUri,
        nextRefresh: new Date(this.jwksCache.nextRefresh).toISOString(),
      })
    } catch (error) {
      this.logger?.('Failed to refresh JWKS', {
        uri: this.config.jwksUri,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Gets the primary key for signing
   */
  getPrimaryKey(): JWTKey {
    const primaryKey = this.config.secrets.find((s) => s.primary)
    if (!primaryKey) {
      // Fallback to first key if no primary is set
      const firstKey = this.config.secrets[0]
      if (!firstKey) {
        throw new Error('No JWT secrets configured')
      }
      return firstKey
    }
    return primaryKey
  }

  /**
   * Signs a JWT token using the primary key.
   *
   * Enforces minimum HMAC key length and always sets an expiration time.
   */
  async signToken(
    payload: JWTPayload,
    options?: { expiresIn?: string | number },
  ): Promise<string> {
    const primaryKey = this.getPrimaryKey()

    // Enforce minimum key entropy for HMAC algorithms
    if (primaryKey.algorithm.startsWith('HS')) {
      const keyString =
        typeof primaryKey.key === 'string'
          ? primaryKey.key
          : new TextDecoder().decode(primaryKey.key)
      const minBits = parseInt(primaryKey.algorithm.replace(/\D/g, ''), 10)
      if (Buffer.byteLength(keyString, 'utf8') * 8 < minBits) {
        throw new Error(
          `JWT key for ${primaryKey.algorithm} must be at least ${minBits} bits`,
        )
      }
    }

    // Convert key to appropriate format
    const key =
      typeof primaryKey.key === 'string'
        ? new TextEncoder().encode(primaryKey.key)
        : primaryKey.key

    const jwt = new SignJWT(payload)
      .setProtectedHeader({
        alg: primaryKey.algorithm,
        ...(primaryKey.kid && { kid: primaryKey.kid }),
      })
      .setIssuedAt()

    // Default expiration to 1 hour if not specified. Tokens without an exp claim
    // are dangerous because they remain valid forever if leaked.
    const expiresIn = options?.expiresIn ?? '1h'
    if (typeof expiresIn === 'number') {
      jwt.setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    } else {
      jwt.setExpirationTime(expiresIn)
    }

    return jwt.sign(key)
  }

  /**
   * Verifies a JWT token using all configured keys
   * Tries each key in order until one succeeds
   */
  async verifyToken(token: string): Promise<JWTVerificationResult> {
    const errors: Error[] = []

    // Try JWKS first if configured
    if (this.jwksCache) {
      try {
        const result = await jwtVerify(token, this.jwksCache.jwks)
        if (result.payload.exp == null) {
          throw new Error('JWT token is missing the required exp claim')
        }
        return {
          payload: result.payload,
          protectedHeader: result.protectedHeader,
          keyId: result.protectedHeader.kid,
        }
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }

    // Try each configured secret
    for (const secret of this.config.secrets) {
      try {
        // Check if key is expired
        if (secret.expiresAt && Date.now() > secret.expiresAt) {
          continue
        }

        // Convert key to appropriate format
        const key =
          typeof secret.key === 'string'
            ? new TextEncoder().encode(secret.key)
            : secret.key

        const result = await jwtVerify(token, key, {
          algorithms: [secret.algorithm],
        })

        // Reject tokens that do not contain an exp claim
        if (result.payload.exp == null) {
          throw new Error('JWT token is missing the required exp claim')
        }

        // Check if this is a deprecated key
        const usedDeprecatedKey = secret.deprecated === true

        // Log warning if deprecated key was used
        if (usedDeprecatedKey) {
          this.logger?.('JWT verified with deprecated key', {
            kid: secret.kid,
            algorithm: secret.algorithm,
            expiresAt: secret.expiresAt
              ? new Date(secret.expiresAt).toISOString()
              : undefined,
          })
        }

        return {
          payload: result.payload,
          protectedHeader: result.protectedHeader,
          ...(usedDeprecatedKey && { usedDeprecatedKey }),
          keyId: secret.kid,
        }
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)))
      }
    }

    // If we get here, all verification attempts failed
    throw new Error(
      `JWT verification failed with all configured keys. Errors: ${errors.map((e) => e.message).join(', ')}`,
    )
  }

  /**
   * Rotates keys by marking old keys as deprecated
   */
  rotateKeys(): void {
    const currentPrimary = this.getPrimaryKey()

    // Mark current primary as deprecated if it has a grace period
    if (this.config.gracePeriod) {
      const expiresAt = Date.now() + this.config.gracePeriod
      currentPrimary.deprecated = true
      currentPrimary.expiresAt = expiresAt
      currentPrimary.primary = false

      this.logger?.('Key marked as deprecated', {
        kid: currentPrimary.kid,
        expiresAt: new Date(expiresAt).toISOString(),
      })
    }
  }

  /**
   * Cleans up expired keys
   */
  cleanupExpiredKeys(): void {
    const now = Date.now()
    const initialCount = this.config.secrets.length

    this.config.secrets = this.config.secrets.filter((secret) => {
      if (secret.expiresAt && now > secret.expiresAt) {
        this.logger?.('Removing expired key', {
          kid: secret.kid,
          expiresAt: new Date(secret.expiresAt).toISOString(),
        })
        return false
      }
      return true
    })

    const removedCount = initialCount - this.config.secrets.length
    if (removedCount > 0) {
      this.logger?.('Cleaned up expired keys', { count: removedCount })
    }
  }

  /**
   * Stops the JWKS refresh timer
   */
  destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = undefined
    }
  }
}

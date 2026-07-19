/**
 * Security configuration schema and validation
 */

import type { ValidationResult, ValidationRules } from './types'
import { safeDeepMerge } from './utils'

/**
 * TLS/HTTPS configuration
 */
export interface TLSConfig {
  enabled: boolean
  cert?: string | Buffer
  key?: string | Buffer
  ca?: string | Buffer
  minVersion?: 'TLSv1.2' | 'TLSv1.3'
  cipherSuites?: string[]
  requestCert?: boolean
  rejectUnauthorized?: boolean
  redirectHTTP?: boolean
  redirectPort?: number
  /**
   * Allowed Host header values for the HTTP->HTTPS redirect server.
   * Supports exact hostnames and leading wildcards (e.g. '*.example.com').
   * If not set, the redirect server uses the gateway's configured hostname.
   */
  redirectAllowedHosts?: string[]
}

/**
 * Error handler configuration
 */
export interface ErrorHandlerConfig {
  production?: boolean
  includeStackTrace?: boolean
  logErrors?: boolean
  customMessages?: Record<number, string>
  sanitizeBackendErrors?: boolean
  /** Optional logger to receive error log entries. Defaults to the gateway logger. */
  logger?: any
}

/**
 * Session configuration
 */
export interface SessionConfig {
  entropyBits?: number
  ttl?: number
  cookieName?: string
  cookieOptions?: {
    secure?: boolean
    httpOnly?: boolean
    sameSite?: 'strict' | 'lax' | 'none'
    domain?: string
    path?: string
  }
}

/**
 * Trusted proxy configuration
 */
export interface TrustedProxyConfig {
  enabled: boolean
  trustedIPs?: string[]
  trustedNetworks?: string[]
  maxForwardedDepth?: number
  trustAll?: boolean
  /**
   * Honor the Cloudflare-specific CF-Connecting-IP header.
   * Only enable when the immediate proxy is a Cloudflare edge.
   * @default false
   */
  trustCloudflare?: boolean
  /**
   * Honor the X-Real-IP / X-Client-IP headers from the trusted immediate proxy.
   * @default false
   */
  trustXRealIP?: boolean
}

/**
 * Security headers configuration
 */
export interface SecurityHeadersConfig {
  enabled?: boolean
  hsts?: {
    maxAge?: number
    includeSubDomains?: boolean
    preload?: boolean
  }
  contentSecurityPolicy?: {
    directives?: Record<string, string[]>
    reportOnly?: boolean
  }
  xFrameOptions?: 'DENY' | 'SAMEORIGIN' | string
  xContentTypeOptions?: boolean
  referrerPolicy?: string
  permissionsPolicy?: Record<string, string[]>
  customHeaders?: Record<string, string>
}

/**
 * Request size limits
 */
export interface SizeLimits {
  maxBodySize?: number
  maxHeaderSize?: number
  maxHeaderCount?: number
  maxUrlLength?: number
  maxQueryParams?: number
}

/**
 * Rate limit store configuration
 */
export interface RateLimitStoreConfig {
  type: 'memory' | 'redis' | 'custom'
  redis?: {
    host: string
    port: number
    password?: string
    db?: number
    keyPrefix?: string
  }
  fallbackToMemory?: boolean
}

/**
 * JWT key rotation configuration
 */
export interface JWTKeyConfig {
  secrets: Array<{
    key: string | Buffer
    algorithm: string
    kid?: string
    primary?: boolean
    deprecated?: boolean
    expiresAt?: number
  }>
  jwksUri?: string
  jwksRefreshInterval?: number
  gracePeriod?: number
}

/**
 * Health check authentication configuration
 */
export interface HealthCheckAuthConfig {
  enabled?: boolean
  authentication?: {
    type: 'basic' | 'bearer' | 'apikey'
    credentials?: Record<string, string>
  }
  ipWhitelist?: string[]
  publicEndpoints?: string[]
  detailLevel?: 'minimal' | 'standard' | 'detailed'
}

/**
 * CSRF protection configuration
 */
export interface CSRFConfig {
  enabled?: boolean
  tokenLength?: number
  cookieName?: string
  headerName?: string
  excludeMethods?: string[]
  excludePaths?: string[]
  sameSiteStrict?: boolean
}

/**
 * CORS validation configuration
 */
export interface CORSValidationConfig {
  strictMode?: boolean
  allowWildcardWithCredentials?: boolean
  maxOrigins?: number
  requireHttps?: boolean
}

/**
 * Payload monitoring configuration
 */
export interface PayloadMonitorConfig {
  maxResponseSize?: number
  trackMetrics?: boolean
  abortOnLimit?: boolean
  warnThreshold?: number
}

/**
 * Secure cluster configuration
 */
export interface SecureClusterConfig {
  filterEnvVars?: string[]
  connectionDrainTimeout?: number
  secretsIPC?: boolean
  isolateWorkerMemory?: boolean
}

/**
 * Main security configuration
 */
export interface SecurityConfig {
  tls?: TLSConfig
  inputValidation?: ValidationRules
  errorHandling?: ErrorHandlerConfig
  sessions?: SessionConfig
  trustedProxies?: TrustedProxyConfig
  securityHeaders?: SecurityHeadersConfig
  sizeLimits?: SizeLimits
  rateLimitStore?: RateLimitStoreConfig
  jwtKeyRotation?: JWTKeyConfig
  healthCheckAuth?: HealthCheckAuthConfig
  csrf?: CSRFConfig
  corsValidation?: CORSValidationConfig
  payloadMonitor?: PayloadMonitorConfig
  secureCluster?: SecureClusterConfig
}

/**
 * Default security configuration values
 */
export const DEFAULT_SECURITY_CONFIG: Partial<SecurityConfig> = {
  inputValidation: {
    maxPathLength: 2048,
    maxHeaderSize: 16384,
    maxHeaderCount: 100,
    allowedPathChars: /^[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/,
    blockedPatterns: [
      /\.\./,
      /%2e%2e/i,
      /%2f/i,
      /%5c/i,
      /%00/,
      /\0/,
      /%252[fF]/i, // raw double-encoded slash before decoding
    ],
    sanitizeHeaders: true,
  },
  errorHandling: {
    production: process.env.NODE_ENV === 'production' || false,
    includeStackTrace: false,
    logErrors: true,
    sanitizeBackendErrors: true,
  },
  sessions: {
    entropyBits: 128,
    ttl: 3600000, // 1 hour
    cookieName: 'bungate_session',
    cookieOptions: {
      secure: true,
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    },
  },
  sizeLimits: {
    maxBodySize: 10 * 1024 * 1024, // 10MB
    maxHeaderSize: 16384, // 16KB
    maxHeaderCount: 100,
    maxUrlLength: 2048,
    maxQueryParams: 100,
  },
  securityHeaders: {
    enabled: true,
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: false,
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
  },
  csrf: {
    enabled: false,
    tokenLength: 32,
    cookieName: 'bungate_csrf',
    headerName: 'X-CSRF-Token',
    excludeMethods: ['GET', 'HEAD', 'OPTIONS'],
    excludePaths: [],
    sameSiteStrict: true,
  },
  payloadMonitor: {
    maxResponseSize: 100 * 1024 * 1024, // 100MB
    trackMetrics: true,
    abortOnLimit: true,
    warnThreshold: 0.8, // 80%
  },
}

/**
 * Validates security configuration
 */
export function validateSecurityConfig(
  config: SecurityConfig,
): ValidationResult {
  const errors: string[] = []

  // Validate TLS config
  if (config.tls?.enabled) {
    if (!config.tls.cert || !config.tls.key) {
      errors.push('TLS enabled but cert or key not provided')
    }
    if (config.tls.redirectHTTP && !config.tls.redirectPort) {
      errors.push('HTTP redirect enabled but redirectPort not specified')
    }
  }

  // Validate session config
  if (config.sessions) {
    if (
      config.sessions.entropyBits != null &&
      config.sessions.entropyBits < 128
    ) {
      errors.push('Session entropy must be at least 128 bits')
    }
    if (config.sessions.ttl != null && config.sessions.ttl <= 0) {
      errors.push('Session TTL must be positive')
    }
  }

  // Validate size limits
  if (config.sizeLimits) {
    if (
      config.sizeLimits.maxBodySize != null &&
      config.sizeLimits.maxBodySize <= 0
    ) {
      errors.push('maxBodySize must be positive')
    }
    if (
      config.sizeLimits.maxHeaderSize != null &&
      config.sizeLimits.maxHeaderSize <= 0
    ) {
      errors.push('maxHeaderSize must be positive')
    }
  }

  // Validate trusted proxy config
  if (config.trustedProxies?.enabled && config.trustedProxies.trustAll) {
    errors.push('trustAll is dangerous and should not be used in production')
  }

  // Validate CORS config
  if (config.corsValidation?.allowWildcardWithCredentials) {
    errors.push('Wildcard origins with credentials is a security risk')
  }

  // Validate rate limit store
  if (config.rateLimitStore?.type === 'redis' && !config.rateLimitStore.redis) {
    errors.push('Redis type selected but redis configuration not provided')
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  }
}

/**
 * Merges user config with defaults.
 *
 * Uses safeDeepMerge to prevent prototype pollution via __proto__,
 * constructor, or prototype keys.
 */
export function mergeSecurityConfig(
  userConfig: Partial<SecurityConfig>,
): SecurityConfig {
  return safeDeepMerge(DEFAULT_SECURITY_CONFIG as SecurityConfig, userConfig)
}

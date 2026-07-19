/**
 * Bungate Security Module
 *
 * Provides comprehensive security features for the Bungate API Gateway
 */

// Export types
export type {
  ValidationResult,
  SecurityContext,
  SecurityIssue,
  ErrorContext,
  SafeError,
  SecurityLog,
  SecurityMetrics,
} from './types'

// Export configuration
export type {
  TLSConfig,
  ErrorHandlerConfig,
  SessionConfig,
  TrustedProxyConfig,
  SecurityHeadersConfig,
  SizeLimits,
  RateLimitStoreConfig,
  JWTKeyConfig,
  HealthCheckAuthConfig,
  CSRFConfig,
  CORSValidationConfig,
  PayloadMonitorConfig,
  SecureClusterConfig,
  SecurityConfig,
} from './config'

export {
  DEFAULT_SECURITY_CONFIG,
  validateSecurityConfig,
  mergeSecurityConfig,
} from './config'

// Export utilities
export {
  calculateEntropy,
  hasMinimumEntropy,
  generateSecureRandom,
  generateSecureRandomWithEntropy,
  sanitizePath,
  sanitizeHeader,
  containsOnlyAllowedChars,
  matchesBlockedPattern,
  matchesExcludedPath,
  sanitizeErrorMessage,
  generateRequestId,
  isValidIP,
  isIPInCIDR,
  safeJSONParse,
  redactSensitiveData,
  timingSafeEqual,
  isValidURL,
  extractDomain,
} from './utils'

// Export TLS manager
export {
  TLSManager,
  createTLSManager,
  DEFAULT_CIPHER_SUITES,
  type BunTLSOptions,
} from './tls-manager'

// Export HTTP redirect
export {
  createHTTPRedirectServer,
  HTTPRedirectManager,
  type HTTPRedirectConfig,
} from './http-redirect'

// Export input validator
export { InputValidator, createInputValidator } from './input-validator'

// Export validation middleware
export {
  createValidationMiddleware,
  validationMiddleware,
  type ValidationMiddlewareConfig,
} from './validation-middleware'

// Export error handler
export { SecureErrorHandler, createSecureErrorHandler } from './error-handler'

// Export error handler middleware
export {
  createErrorHandlerMiddleware,
  errorHandlerMiddleware,
  createProductionErrorHandler,
  createDevelopmentErrorHandler,
  type ErrorHandlerMiddlewareConfig,
} from './error-handler-middleware'

// Export session manager
export {
  SessionManager,
  createSessionManager,
  type Session,
  type CookieOptions,
} from './session-manager'

// Export trusted proxy validator
export {
  TrustedProxyValidator,
  createTrustedProxyValidator,
} from './trusted-proxy'

// Export security headers middleware
export {
  SecurityHeadersMiddleware,
  createSecurityHeadersMiddleware,
  createSecurityHeadersMiddlewareFunction,
  securityHeadersMiddleware,
  mergeHeaders,
  hasSecurityHeaders,
  DEFAULT_SECURITY_HEADERS,
  type SecurityHeadersMiddlewareConfig,
} from './security-headers'

// Export size limiter
export { SizeLimiter, createSizeLimiter } from './size-limiter'

// Export size limiter middleware
export {
  createSizeLimiterMiddleware,
  sizeLimiterMiddleware,
  type SizeLimiterMiddlewareConfig,
} from './size-limiter-middleware'

// Export JWT key rotation
export {
  JWTKeyRotationManager,
  type JWTKey,
  type JWTVerificationResult,
} from './jwt-key-rotation'

// Export JWT key rotation middleware
export {
  createJWTKeyRotationMiddleware,
  createTokenSigner,
  createTokenVerifier,
  type JWTKeyRotationMiddlewareOptions,
} from './jwt-key-rotation-middleware'

// Export hardened JWT auth middleware
export { createJWTAuth } from './jwt-auth'

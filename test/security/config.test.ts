/**
 * Security config validation tests
 * Covers validateSecurityConfig edge cases
 */
import { describe, test, expect } from 'bun:test'
import {
  validateSecurityConfig,
  mergeSecurityConfig,
  type SecurityConfig,
} from '../../src/security/config'

describe('validateSecurityConfig', () => {
  test('should validate empty config', () => {
    const result = validateSecurityConfig({})
    expect(result.valid).toBe(true)
  })

  test('should reject TLS without cert or key', () => {
    const result = validateSecurityConfig({
      tls: { enabled: true },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('TLS enabled but cert or key not provided')
  })

  test('should reject TLS redirect without redirectPort', () => {
    const result = validateSecurityConfig({
      tls: {
        enabled: true,
        cert: 'fake-cert',
        key: 'fake-key',
        redirectHTTP: true,
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'HTTP redirect enabled but redirectPort not specified',
    )
  })

  test('should accept valid TLS config', () => {
    const result = validateSecurityConfig({
      tls: {
        enabled: true,
        cert: 'fake-cert',
        key: 'fake-key',
        redirectHTTP: true,
        redirectPort: 80,
      },
    })
    expect(result.valid).toBe(true)
  })

  test('should reject low session entropy', () => {
    const result = validateSecurityConfig({
      sessions: { entropyBits: 64 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Session entropy must be at least 128 bits')
  })

  test('should reject non-positive session TTL', () => {
    const result = validateSecurityConfig({
      sessions: { ttl: -1 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Session TTL must be positive')
  })

  test('should reject non-positive maxBodySize', () => {
    const result = validateSecurityConfig({
      sizeLimits: { maxBodySize: -1 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('maxBodySize must be positive')
  })

  test('should reject non-positive maxHeaderSize', () => {
    const result = validateSecurityConfig({
      sizeLimits: { maxHeaderSize: -1 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('maxHeaderSize must be positive')
  })

  test('should accept valid sizeLimits', () => {
    const result = validateSecurityConfig({
      sizeLimits: { maxBodySize: 1024, maxHeaderSize: 512 },
    })
    expect(result.valid).toBe(true)
  })

  test('should warn about trustAll', () => {
    const result = validateSecurityConfig({
      trustedProxies: { enabled: true, trustAll: true },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'trustAll is dangerous and should not be used in production',
    )
  })

  test('should warn about wildcard with credentials', () => {
    const result = validateSecurityConfig({
      corsValidation: { allowWildcardWithCredentials: true },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Wildcard origins with credentials is a security risk',
    )
  })

  test('should reject redis config without redis settings', () => {
    const result = validateSecurityConfig({
      rateLimitStore: { type: 'redis' as any },
    })
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(
      'Redis type selected but redis configuration not provided',
    )
  })
})

describe('mergeSecurityConfig', () => {
  test('should merge user config with defaults', () => {
    const merged = mergeSecurityConfig({
      tls: { enabled: true, cert: 'c', key: 'k' },
    })
    expect(merged.tls?.enabled).toBe(true)
    expect(merged.inputValidation?.maxPathLength).toBe(2048)
    expect(merged.securityHeaders?.enabled).toBe(true)
  })

  test('should override defaults', () => {
    const merged = mergeSecurityConfig({
      inputValidation: { maxPathLength: 100 },
    })
    expect(merged.inputValidation?.maxPathLength).toBe(100)
    expect(merged.inputValidation?.maxHeaderSize).toBe(16384)
  })
})

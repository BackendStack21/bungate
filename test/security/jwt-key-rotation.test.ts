import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { JWTKeyRotationManager } from '../../src/security/jwt-key-rotation'
import type { JWTKeyConfig } from '../../src/security/config'

describe('JWTKeyRotationManager', () => {
  let manager: JWTKeyRotationManager

  afterEach(() => {
    if (manager) {
      manager.destroy()
    }
  })

  describe('constructor and validation', () => {
    test('should create JWTKeyRotationManager instance', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-key-at-least-32-bytes-long!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)
      expect(manager).toBeDefined()
      expect(manager).toBeInstanceOf(JWTKeyRotationManager)
    })

    test('should throw error if no secrets configured', () => {
      expect(() => {
        new JWTKeyRotationManager({ secrets: [] })
      }).toThrow('At least one JWT secret or a jwksUri must be configured')
    })

    test('should throw error if multiple primary keys configured', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'key1-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'key2-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      expect(() => {
        new JWTKeyRotationManager(config)
      }).toThrow('Only one primary key can be configured')
    })

    test('should auto-assign first key as primary if none specified', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'key1-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
          },
          {
            key: 'key2-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)
      const primaryKey = manager.getPrimaryKey()
      expect(primaryKey.key).toBe('key1-at-least-32-bytes-long-secret-key!')
    })

    test('should throw error for invalid algorithm', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-key-at-least-32-bytes-long-secret-key!!',
            algorithm: 'INVALID' as any,
          },
        ],
      }
      expect(() => {
        new JWTKeyRotationManager(config)
      }).toThrow('Invalid algorithm')
    })

    test('should accept valid algorithms', () => {
      const algorithms = [
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

      for (const algorithm of algorithms) {
        const config: JWTKeyConfig = {
          secrets: [
            {
              key: 'test-key-at-least-32-bytes-long-secret-key!!',
              algorithm,
              primary: true,
            },
          ],
        }
        const mgr = new JWTKeyRotationManager(config)
        expect(mgr).toBeDefined()
        mgr.destroy()
      }
    })
  })

  describe('getPrimaryKey', () => {
    test('should return the primary key', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
          },
          {
            key: 'new-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)
      const primaryKey = manager.getPrimaryKey()
      expect(primaryKey.key).toBe('new-key-at-least-32-bytes-long-secret-key!')
      expect(primaryKey.primary).toBe(true)
    })

    test('should return first key if no primary specified', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'first-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
          },
          {
            key: 'second-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)
      const primaryKey = manager.getPrimaryKey()
      expect(primaryKey.key).toBe('first-key-at-least-32-bytes-long-secret-key')
    })
  })

  describe('signToken', () => {
    test('should sign a token with primary key', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-key-at-least-32-bytes-long!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      const payload = { userId: '123', role: 'admin' }
      const token = await manager.signToken(payload)

      expect(token).toBeDefined()
      expect(typeof token).toBe('string')
      expect(token.split('.')).toHaveLength(3) // JWT has 3 parts
    })

    test('should sign token with expiration', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-key-at-least-32-bytes-long!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      const payload = { userId: '123' }
      const token = await manager.signToken(payload, { expiresIn: 3600 })

      expect(token).toBeDefined()

      // Verify the token contains expiration
      const result = await manager.verifyToken(token)
      expect(result.payload.exp).toBeDefined()
    })

    test('should include kid in header if specified', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-key-at-least-32-bytes-long!',
            algorithm: 'HS256',
            primary: true,
            kid: 'key-2024-01',
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      const token = await manager.signToken({ userId: '123' })
      const result = await manager.verifyToken(token)

      expect(result.protectedHeader.kid).toBe('key-2024-01')
    })
  })

  describe('verifyToken - single secret', () => {
    test('should verify a valid token', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-key-at-least-32-bytes-long!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      const payload = { userId: '123', role: 'admin' }
      const token = await manager.signToken(payload)

      const result = await manager.verifyToken(token)
      expect(result.payload.userId).toBe('123')
      expect(result.payload.role).toBe('admin')
      expect(result.usedDeprecatedKey).toBeUndefined()
    })

    test('should reject invalid token', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-key-at-least-32-bytes-long!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      const invalidToken = 'invalid.token.here'

      await expect(manager.verifyToken(invalidToken)).rejects.toThrow()
    })

    test('should reject token signed with different key', async () => {
      const config1: JWTKeyConfig = {
        secrets: [
          {
            key: 'key1-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      const manager1 = new JWTKeyRotationManager(config1)
      const token = await manager1.signToken({ userId: '123' })
      manager1.destroy()

      const config2: JWTKeyConfig = {
        secrets: [
          {
            key: 'key2-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config2)

      await expect(manager.verifyToken(token)).rejects.toThrow()
    })
  })

  describe('verifyToken - multiple secrets', () => {
    test('should verify token with any configured secret', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'new-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            deprecated: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      // Create a token with the old key
      const oldConfig: JWTKeyConfig = {
        secrets: [
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      const oldManager = new JWTKeyRotationManager(oldConfig)
      const token = await oldManager.signToken({ userId: '123' })
      oldManager.destroy()

      // Should verify with new manager that has old key as deprecated
      const result = await manager.verifyToken(token)
      expect(result.payload.userId).toBe('123')
      expect(result.usedDeprecatedKey).toBe(true)
    })

    test('should try secrets in order', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'key1-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'key2-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
          },
          {
            key: 'key3-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      // Create token with key3
      const key3Config: JWTKeyConfig = {
        secrets: [
          {
            key: 'key3-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      const key3Manager = new JWTKeyRotationManager(key3Config)
      const token = await key3Manager.signToken({ userId: '123' })
      key3Manager.destroy()

      // Should still verify
      const result = await manager.verifyToken(token)
      expect(result.payload.userId).toBe('123')
    })

    test('should log warning when deprecated key is used', async () => {
      const logs: any[] = []
      const logger = (message: string, meta?: any) => {
        logs.push({ message, meta })
      }

      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'new-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            deprecated: true,
            kid: 'old-key-id',
          },
        ],
      }
      manager = new JWTKeyRotationManager(config, logger)

      // Create token with old key
      const oldConfig: JWTKeyConfig = {
        secrets: [
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      const oldManager = new JWTKeyRotationManager(oldConfig)
      const token = await oldManager.signToken({ userId: '123' })
      oldManager.destroy()

      await manager.verifyToken(token)

      expect(logs.length).toBeGreaterThan(0)
      expect(logs[0].message).toContain('deprecated')
    })

    test('should skip expired keys during verification', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'new-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'expired-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            expiresAt: Date.now() - 1000,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      // Create token with expired key
      const expiredConfig: JWTKeyConfig = {
        secrets: [
          {
            key: 'expired-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      const expiredManager = new JWTKeyRotationManager(expiredConfig)
      const token = await expiredManager.signToken({ userId: '123' })
      expiredManager.destroy()

      // Should fail because expired key is skipped
      await expect(manager.verifyToken(token)).rejects.toThrow()
    })
  })

  describe('rotateKeys', () => {
    test('should mark current primary as deprecated', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'current-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        gracePeriod: 86400000, // 24 hours
      }
      manager = new JWTKeyRotationManager(config)

      const beforeRotation = manager.getPrimaryKey()
      expect(beforeRotation.deprecated).toBeUndefined()

      manager.rotateKeys()

      expect(beforeRotation.deprecated).toBe(true)
      expect(beforeRotation.primary).toBe(false)
      expect(beforeRotation.expiresAt).toBeDefined()
    })

    test('should set expiration based on grace period', () => {
      const gracePeriod = 3600000 // 1 hour
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'current-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        gracePeriod,
      }
      manager = new JWTKeyRotationManager(config)

      const beforeTime = Date.now()
      manager.rotateKeys()
      const afterTime = Date.now()

      const primaryKey = config.secrets[0]
      expect(primaryKey).toBeDefined()
      expect(primaryKey!.expiresAt).toBeDefined()
      expect(primaryKey!.expiresAt!).toBeGreaterThanOrEqual(
        beforeTime + gracePeriod,
      )
      expect(primaryKey!.expiresAt!).toBeLessThanOrEqual(
        afterTime + gracePeriod,
      )
    })

    test('should log rotation event', () => {
      const logs: any[] = []
      const logger = (message: string, meta?: any) => {
        logs.push({ message, meta })
      }

      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'current-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
            kid: 'key-2024-01',
          },
        ],
        gracePeriod: 86400000,
      }
      manager = new JWTKeyRotationManager(config, logger)

      manager.rotateKeys()

      expect(logs.length).toBeGreaterThan(0)
      expect(logs[0].message).toContain('deprecated')
      expect(logs[0].meta.kid).toBe('key-2024-01')
    })
  })

  describe('cleanupExpiredKeys', () => {
    test('should remove expired keys', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'current-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'expired-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            expiresAt: Date.now() - 1000,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      expect(config.secrets.length).toBe(2)

      manager.cleanupExpiredKeys()

      expect(config.secrets.length).toBe(1)
      expect(config.secrets[0]?.key).toBe(
        'current-key-at-least-32-bytes-long-secret-key',
      )
    })

    test('should keep non-expired keys', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'current-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'future-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            expiresAt: Date.now() + 86400000,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      manager.cleanupExpiredKeys()

      expect(config.secrets.length).toBe(2)
    })

    test('should log cleanup events', () => {
      const logs: any[] = []
      const logger = (message: string, meta?: any) => {
        logs.push({ message, meta })
      }

      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'current-key-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
          {
            key: 'expired-key-1-at-least-32-bytes-long-secret',
            algorithm: 'HS256',
            expiresAt: Date.now() - 1000,
            kid: 'exp-1',
          },
          {
            key: 'expired-key-2-at-least-32-bytes-long-secret',
            algorithm: 'HS256',
            expiresAt: Date.now() - 2000,
            kid: 'exp-2',
          },
        ],
      }
      manager = new JWTKeyRotationManager(config, logger)

      manager.cleanupExpiredKeys()

      expect(logs.length).toBeGreaterThan(0)
      const cleanupLog = logs.find((log) => log.message.includes('Cleaned up'))
      expect(cleanupLog).toBeDefined()
      expect(cleanupLog.meta.count).toBe(2)
    })
  })

  describe('key rotation without downtime', () => {
    test('should support seamless key rotation', async () => {
      // Start with old key
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        gracePeriod: 86400000,
      }
      manager = new JWTKeyRotationManager(config)

      // Create token with old key
      const oldToken = await manager.signToken({ userId: '123' })

      // Add new key and rotate
      config.secrets.push({
        key: 'new-key-at-least-32-bytes-long-secret-key!',
        algorithm: 'HS256',
        primary: true,
      })
      manager.rotateKeys()

      // Old token should still verify
      const oldResult = await manager.verifyToken(oldToken)
      expect(oldResult.payload.userId).toBe('123')
      expect(oldResult.usedDeprecatedKey).toBe(true)

      // New tokens should use new key
      const newToken = await manager.signToken({ userId: '456' })
      const newResult = await manager.verifyToken(newToken)
      expect(newResult.payload.userId).toBe('456')
      expect(newResult.usedDeprecatedKey).toBeUndefined()
    })

    test('should handle multiple rotation cycles', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'key-v1-at-least-32-bytes-long-secret-key!!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        gracePeriod: 86400000,
      }
      manager = new JWTKeyRotationManager(config)

      const token1 = await manager.signToken({ version: 1 })

      // First rotation
      config.secrets.push({
        key: 'key-v2-at-least-32-bytes-long-secret-key!!',
        algorithm: 'HS256',
        primary: true,
      })
      manager.rotateKeys()
      const token2 = await manager.signToken({ version: 2 })

      // Second rotation
      config.secrets.push({
        key: 'key-v3-at-least-32-bytes-long-secret-key!!',
        algorithm: 'HS256',
        primary: true,
      })
      manager.rotateKeys()
      const token3 = await manager.signToken({ version: 3 })

      // All tokens should still verify
      const result1 = await manager.verifyToken(token1)
      expect(result1.payload.version).toBe(1)

      const result2 = await manager.verifyToken(token2)
      expect(result2.payload.version).toBe(2)

      const result3 = await manager.verifyToken(token3)
      expect(result3.payload.version).toBe(3)
    })
  })

  describe('destroy', () => {
    test('should stop JWKS refresh timer', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-key-at-least-32-bytes-long-secret-key!!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        jwksUri: 'https://example.com/.well-known/jwks.json',
        jwksRefreshInterval: 3600000,
      }
      manager = new JWTKeyRotationManager(config)

      expect(() => manager.destroy()).not.toThrow()
    })

    test('should be safe to call multiple times', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-key-at-least-32-bytes-long-secret-key!!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      manager.destroy()
      expect(() => manager.destroy()).not.toThrow()
    })
  })

  describe('refreshJWKS', () => {
    test('should successfully refresh JWKS and update cache', async () => {
      const logs: any[] = []
      const logger = (message: string, meta?: any) => {
        logs.push({ message, meta })
      }

      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        jwksUri: 'https://example.com/.well-known/jwks.json',
        jwksRefreshInterval: 3600000,
      }
      manager = new JWTKeyRotationManager(config, logger)

      // Access jwksCache before refresh — initialized by constructor
      const initialCache = (manager as any).jwksCache
      expect(initialCache).toBeDefined()
      const initialLastRefresh = initialCache.lastRefresh

      // Wait a tiny bit so timestamps differ
      await new Promise((resolve) => setTimeout(resolve, 10))

      await (manager as any).refreshJWKS()

      const updatedCache = (manager as any).jwksCache
      expect(updatedCache).toBeDefined()
      expect(updatedCache.lastRefresh).toBeGreaterThan(initialLastRefresh)
      expect(updatedCache.nextRefresh).toBeGreaterThan(updatedCache.lastRefresh)

      // Verify success log
      const successLog = logs.find(
        (l) => l.message === 'JWKS refreshed successfully',
      )
      expect(successLog).toBeDefined()
      expect(successLog.meta.uri).toBe(
        'https://example.com/.well-known/jwks.json',
      )
      expect(successLog.meta.nextRefresh).toBeDefined()
    })

    test('should throw when JWKS URI is not configured', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      }
      manager = new JWTKeyRotationManager(config)

      await expect((manager as any).refreshJWKS()).rejects.toThrow(
        'JWKS URI not configured',
      )
    })

    test('should catch error, log, and re-throw for invalid JWKS URI', async () => {
      const logs: any[] = []
      const logger = (message: string, meta?: any) => {
        logs.push({ message, meta })
      }

      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        // Note: no jwksUri here so constructor won't initialize JWKS.
        // We set it manually via (manager as any) for the test.
      }
      manager = new JWTKeyRotationManager(config, logger)

      // Inject a bad JWKS URI that will cause new URL() to throw
      ;(manager as any).config.jwksUri = 'not-a-valid-url'

      // Clear logs from construction
      logs.length = 0

      await expect((manager as any).refreshJWKS()).rejects.toThrow()

      // Verify error log was written
      const errorLog = logs.find((l) => l.message === 'Failed to refresh JWKS')
      expect(errorLog).toBeDefined()
      expect(errorLog.meta.uri).toBe('not-a-valid-url')
      expect(errorLog.meta.error).toBeDefined()
    })
  })

  describe('startJWKSRefresh', () => {
    test('should set up refresh timer when jwksUri and jwksRefreshInterval are configured', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        jwksUri: 'https://example.com/.well-known/jwks.json',
        jwksRefreshInterval: 3600000,
      }
      manager = new JWTKeyRotationManager(config)

      // Verify that an interval timer was created
      const timer = (manager as any).refreshTimer
      expect(timer).toBeDefined()
    })

    test('should not set up timer when jwksRefreshInterval is not configured', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        jwksUri: 'https://example.com/.well-known/jwks.json',
        // no jwksRefreshInterval
      }
      manager = new JWTKeyRotationManager(config)

      // startJWKSRefresh returns early if jwksRefreshInterval is missing
      const timer = (manager as any).refreshTimer
      expect(timer).toBeUndefined()
    })

    test('should not create timer when jwksUri is not set', () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        // no jwksUri
      }
      manager = new JWTKeyRotationManager(config)

      const timer = (manager as any).refreshTimer
      expect(timer).toBeUndefined()
    })

    test('timer callback invokes refreshJWKS and updates cache', async () => {
      const logs: any[] = []
      const logger = (message: string, meta?: any) => {
        logs.push({ message, meta })
      }

      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
          },
        ],
        jwksUri: 'https://example.com/.well-known/jwks.json',
        jwksRefreshInterval: 50, // short interval for fast test
      }
      manager = new JWTKeyRotationManager(config, logger)

      // Record initial cache state
      const initialCache = (manager as any).jwksCache
      expect(initialCache).toBeDefined()
      const initialLastRefresh = initialCache.lastRefresh

      // Wait for the interval to fire at least once
      await new Promise((resolve) => setTimeout(resolve, 120))

      const updatedCache = (manager as any).jwksCache
      expect(updatedCache).toBeDefined()
      // Cache should have been refreshed by the timer callback
      expect(updatedCache.lastRefresh).toBeGreaterThan(initialLastRefresh)

      // Verify refresh success was logged by the callback
      const successLogs = logs.filter(
        (l) => l.message === 'JWKS refreshed successfully',
      )
      expect(successLogs.length).toBeGreaterThan(0)
    })
  })
})

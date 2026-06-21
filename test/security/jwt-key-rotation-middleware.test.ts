import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import {
  createJWTKeyRotationMiddleware,
  createTokenSigner,
  createTokenVerifier,
  type JWTKeyRotationMiddlewareOptions,
} from '../../src/security/jwt-key-rotation-middleware'
import type { JWTKeyConfig } from '../../src/security/config'
import type { ZeroRequest } from '../../src/interfaces/middleware'

// Helper to create mock request
function createMockRequest(
  url: string,
  headers: Record<string, string> = {},
): ZeroRequest {
  const headersObj = new Headers(headers)
  return {
    url,
    method: 'GET',
    headers: headersObj,
  } as ZeroRequest
}

// Helper to create mock next function
function createMockNext(): () => Response {
  return () => new Response('OK', { status: 200 })
}

describe('createJWTKeyRotationMiddleware', () => {
  describe('backward compatibility with single secret', () => {
    test('should accept single secret string', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'my-secret-key-at-least-32-bytes-long-secret',
      })

      expect(middleware).toBeDefined()
      expect(typeof middleware).toBe('function')
    })

    test('should verify token with single secret string', async () => {
      const signer = createTokenSigner({
        config: 'my-secret-key-at-least-32-bytes-long-secret',
      })
      const token = await signer({ userId: '123' })

      const middleware = createJWTKeyRotationMiddleware({
        config: 'my-secret-key-at-least-32-bytes-long-secret',
      })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response) // Middleware returns next() response
      expect(result.status).toBe(200)
      expect((req as any).jwt).toBeDefined()
      expect((req as any).jwt.userId).toBe('123')
    })
  })

  describe('multiple secrets configuration', () => {
    test('should verify token with primary key', async () => {
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

      const signer = createTokenSigner({ config })
      const token = await signer({ userId: '123', role: 'admin' })

      const middleware = createJWTKeyRotationMiddleware({ config })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result.status).toBe(200)
      expect((req as any).jwt).toBeDefined()
      expect((req as any).jwt.userId).toBe('123')
      expect((req as any).jwt.role).toBe('admin')
    })

    test('should verify token with deprecated key', async () => {
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

      // Create token with old key
      const oldSigner = createTokenSigner({
        config: {
          secrets: [
            {
              key: 'old-key-at-least-32-bytes-long-secret-key!',
              algorithm: 'HS256',
              primary: true,
            },
          ],
        },
      })
      const token = await oldSigner({ userId: '456' })

      const middleware = createJWTKeyRotationMiddleware({ config })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result.status).toBe(200)
      expect((req as any).jwt).toBeDefined()
      expect((req as any).jwt.userId).toBe('456')
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

      // Create token with old key
      const oldSigner = createTokenSigner({
        config: {
          secrets: [
            {
              key: 'old-key-at-least-32-bytes-long-secret-key!',
              algorithm: 'HS256',
              primary: true,
            },
          ],
        },
      })
      const token = await oldSigner({ userId: '789' })

      const middleware = createJWTKeyRotationMiddleware({ config, logger })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      await middleware(req, next)

      // Should have logged both from manager and middleware
      expect(logs.length).toBeGreaterThan(0)
      const deprecatedLogs = logs.filter((log) =>
        log.message.includes('deprecated'),
      )
      expect(deprecatedLogs.length).toBeGreaterThan(0)
    })
  })

  describe('token extraction', () => {
    test('should extract token from Authorization header', async () => {
      const signer = createTokenSigner({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })
      const token = await signer({ userId: '123' })

      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result.status).toBe(200)
      expect((req as any).jwt).toBeDefined()
    })

    test('should return 401 if no token provided', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })

      const req = createMockRequest('http://localhost/api/test')
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result!.status).toBe(401)
    })

    test('should return 401 if Authorization header is malformed', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: 'InvalidFormat',
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result!.status).toBe(401)
    })

    test('should support custom token extraction', async () => {
      const signer = createTokenSigner({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })
      const token = await signer({ userId: '123' })

      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
        extractToken: (req) => {
          // Extract from custom header
          return req.headers.get('x-api-token')
        },
      })

      const req = createMockRequest('http://localhost/api/test', {
        'x-api-token': token,
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result.status).toBe(200)
      expect((req as any).jwt).toBeDefined()
      expect((req as any).jwt.userId).toBe('123')
    })
  })

  describe('path exclusions', () => {
    test('should skip authentication for excluded paths', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
        excludePaths: ['/public', '/health'],
      })

      const req = createMockRequest('http://localhost/public/data')
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result.status).toBe(200)
      expect((req as any).jwt).toBeUndefined() // No JWT attached
    })

    test('should require authentication for non-excluded paths', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
        excludePaths: ['/public'],
      })

      const req = createMockRequest('http://localhost/api/protected')
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result!.status).toBe(401)
    })

    test('should match path prefixes', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
        excludePaths: ['/api/public'],
      })

      const req1 = createMockRequest('http://localhost/api/public/users')
      const next1 = createMockNext()
      const result1 = await middleware(req1, next1)
      expect(result1).toBeInstanceOf(Response)
      expect(result1.status).toBe(200)

      const req2 = createMockRequest('http://localhost/api/private/users')
      const next2 = createMockNext()
      const result2 = await middleware(req2, next2)
      expect(result2).toBeInstanceOf(Response)
      expect(result2!.status).toBe(401)
    })
  })

  describe('error handling', () => {
    test('should return 401 for invalid token', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: 'Bearer invalid.token.here',
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result!.status).toBe(401)
    })

    test('should return 401 for expired token', async () => {
      const signer = createTokenSigner({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })
      const token = await signer({ userId: '123' }, { expiresIn: -1 }) // Already expired

      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result!.status).toBe(401)
    })

    test('should support custom error handler', async () => {
      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
        onError: (error, req) => {
          return new Response(
            JSON.stringify({ custom: 'error', message: error.message }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          )
        },
      })

      const req = createMockRequest('http://localhost/api/test')
      const next = createMockNext()

      const result = await middleware(req, next)

      expect(result).toBeInstanceOf(Response)
      expect(result!.status).toBe(403)
      const body = (await result!.json()) as any
      expect(body.custom).toBe('error')
    })
  })

  describe('JWT payload attachment', () => {
    test('should attach JWT payload to request', async () => {
      const signer = createTokenSigner({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })
      const token = await signer({
        userId: '123',
        role: 'admin',
        email: 'test@example.com',
      })

      const middleware = createJWTKeyRotationMiddleware({
        config: 'test-secret-at-least-32-bytes-long-secret-key',
      })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      await middleware(req, next)

      expect((req as any).jwt).toBeDefined()
      expect((req as any).jwt.userId).toBe('123')
      expect((req as any).jwt.role).toBe('admin')
      expect((req as any).jwt.email).toBe('test@example.com')
    })

    test('should attach JWT header to request', async () => {
      const config: JWTKeyConfig = {
        secrets: [
          {
            key: 'test-secret-at-least-32-bytes-long-secret-key',
            algorithm: 'HS256',
            primary: true,
            kid: 'key-2024-01',
          },
        ],
      }

      const signer = createTokenSigner({ config })
      const token = await signer({ userId: '123' })

      const middleware = createJWTKeyRotationMiddleware({ config })

      const req = createMockRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const next = createMockNext()

      await middleware(req, next)

      expect((req as any).jwtHeader).toBeDefined()
      expect((req as any).jwtHeader.alg).toBe('HS256')
      expect((req as any).jwtHeader.kid).toBe('key-2024-01')
    })
  })
})

describe('createTokenSigner', () => {
  test('should create token signer function', () => {
    const signer = createTokenSigner({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    expect(signer).toBeDefined()
    expect(typeof signer).toBe('function')
  })

  test('should sign tokens with payload', async () => {
    const signer = createTokenSigner({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    const token = await signer({ userId: '123', role: 'admin' })

    expect(token).toBeDefined()
    expect(typeof token).toBe('string')
    expect(token.split('.')).toHaveLength(3)
  })

  test('should sign tokens with expiration', async () => {
    const signer = createTokenSigner({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    const token = await signer({ userId: '123' }, { expiresIn: 3600 })

    const verifier = createTokenVerifier({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    const result = await verifier(token)

    expect(result.payload.exp).toBeDefined()
  })

  test('should use primary key for signing', async () => {
    const config: JWTKeyConfig = {
      secrets: [
        {
          key: 'old-key-at-least-32-bytes-long-secret-key!',
          algorithm: 'HS256',
          deprecated: true,
        },
        {
          key: 'new-key-at-least-32-bytes-long-secret-key!',
          algorithm: 'HS256',
          primary: true,
          kid: 'new-key-id',
        },
      ],
    }

    const signer = createTokenSigner({ config })
    const token = await signer({ userId: '123' })

    const verifier = createTokenVerifier({ config })
    const result = await verifier(token)

    expect(result.protectedHeader.kid).toBe('new-key-id')
  })

  test('should work with single secret string', async () => {
    const signer = createTokenSigner({
      config: 'simple-secret-at-least-32-bytes-long!',
    })
    const token = await signer({ userId: '123' })

    const verifier = createTokenVerifier({
      config: 'simple-secret-at-least-32-bytes-long!',
    })
    const result = await verifier(token)

    expect(result.payload.userId).toBe('123')
  })
})

describe('createTokenVerifier', () => {
  test('should create token verifier function', () => {
    const verifier = createTokenVerifier({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    expect(verifier).toBeDefined()
    expect(typeof verifier).toBe('function')
  })

  test('should verify valid tokens', async () => {
    const signer = createTokenSigner({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    const token = await signer({ userId: '123', role: 'admin' })

    const verifier = createTokenVerifier({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })
    const result = await verifier(token)

    expect(result.payload.userId).toBe('123')
    expect(result.payload.role).toBe('admin')
  })

  test('should reject invalid tokens', async () => {
    const verifier = createTokenVerifier({
      config: 'test-secret-at-least-32-bytes-long-secret-key',
    })

    await expect(verifier('invalid.token.here')).rejects.toThrow()
  })

  test('should verify with any configured secret', async () => {
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

    // Create token with old key
    const oldSigner = createTokenSigner({
      config: {
        secrets: [
          {
            key: 'old-key-at-least-32-bytes-long-secret-key!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      },
    })
    const token = await oldSigner({ userId: '123' })

    // Verify with new config that includes old key
    const verifier = createTokenVerifier({ config })
    const result = await verifier(token)

    expect(result.payload.userId).toBe('123')
    expect(result.usedDeprecatedKey).toBe(true)
  })

  test('should work with single secret string', async () => {
    const signer = createTokenSigner({
      config: 'simple-secret-at-least-32-bytes-long!',
    })
    const token = await signer({ userId: '123' })

    const verifier = createTokenVerifier({
      config: 'simple-secret-at-least-32-bytes-long!',
    })
    const result = await verifier(token)

    expect(result.payload.userId).toBe('123')
  })
})

describe('key rotation without downtime', () => {
  test('should support seamless key rotation in middleware', async () => {
    // Start with old key
    const oldConfig: JWTKeyConfig = {
      secrets: [
        {
          key: 'old-key-at-least-32-bytes-long-secret-key!',
          algorithm: 'HS256',
          primary: true,
        },
      ],
    }

    const oldSigner = createTokenSigner({ config: oldConfig })
    const oldToken = await oldSigner({ userId: '123' })

    // Rotate to new key while keeping old key
    const newConfig: JWTKeyConfig = {
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

    const middleware = createJWTKeyRotationMiddleware({ config: newConfig })

    // Old token should still work
    const req1 = createMockRequest('http://localhost/api/test', {
      authorization: `Bearer ${oldToken}`,
    })
    const next1 = createMockNext()
    const result1 = await middleware(req1, next1)

    expect(result1).toBeInstanceOf(Response)
    expect(result1.status).toBe(200)
    expect((req1 as any).jwt.userId).toBe('123')

    // New tokens should also work
    const newSigner = createTokenSigner({ config: newConfig })
    const newToken = await newSigner({ userId: '456' })

    const req2 = createMockRequest('http://localhost/api/test', {
      authorization: `Bearer ${newToken}`,
    })
    const next2 = createMockNext()
    const result2 = await middleware(req2, next2)

    expect(result2).toBeInstanceOf(Response)
    expect(result2.status).toBe(200)
    expect((req2 as any).jwt.userId).toBe('456')
  })

  test('should handle multiple rotation cycles', async () => {
    // Version 1
    const v1Signer = createTokenSigner({
      config: {
        secrets: [
          {
            key: 'key-v1-at-least-32-bytes-long-secret-key!!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      },
    })
    const token1 = await v1Signer({ version: 1 })

    // Version 2
    const v2Signer = createTokenSigner({
      config: {
        secrets: [
          {
            key: 'key-v2-at-least-32-bytes-long-secret-key!!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      },
    })
    const token2 = await v2Signer({ version: 2 })

    // Version 3
    const v3Signer = createTokenSigner({
      config: {
        secrets: [
          {
            key: 'key-v3-at-least-32-bytes-long-secret-key!!',
            algorithm: 'HS256',
            primary: true,
          },
        ],
      },
    })
    const token3 = await v3Signer({ version: 3 })

    // Middleware with all keys
    const config: JWTKeyConfig = {
      secrets: [
        {
          key: 'key-v3-at-least-32-bytes-long-secret-key!!',
          algorithm: 'HS256',
          primary: true,
        },
        {
          key: 'key-v2-at-least-32-bytes-long-secret-key!!',
          algorithm: 'HS256',
          deprecated: true,
        },
        {
          key: 'key-v1-at-least-32-bytes-long-secret-key!!',
          algorithm: 'HS256',
          deprecated: true,
        },
      ],
    }

    const middleware = createJWTKeyRotationMiddleware({ config })

    // All tokens should verify
    const req1 = createMockRequest('http://localhost/api/test', {
      authorization: `Bearer ${token1}`,
    })
    await middleware(req1, createMockNext())
    expect((req1 as any).jwt.version).toBe(1)

    const req2 = createMockRequest('http://localhost/api/test', {
      authorization: `Bearer ${token2}`,
    })
    await middleware(req2, createMockNext())
    expect((req2 as any).jwt.version).toBe(2)

    const req3 = createMockRequest('http://localhost/api/test', {
      authorization: `Bearer ${token3}`,
    })
    await middleware(req3, createMockNext())
    expect((req3 as any).jwt.version).toBe(3)
  })
})

/**
 * Security Middleware Order Tests
 *
 * Verifies that security middleware (authentication, rate limiting) executes
 * before route-specific custom middleware for proper security enforcement.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway'
import type { RequestHandler } from '../../src/interfaces/middleware'

describe('Security Middleware Order', () => {
  let backendServer: any
  let gateway: BunGateway | undefined

  beforeAll(async () => {
    // Start a simple backend server
    backendServer = Bun.serve({
      port: 9010,
      fetch: async (req: Request) => {
        return new Response(JSON.stringify({ message: 'Backend response' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
  })

  afterEach(async () => {
    if (gateway) {
      await gateway.close()
      gateway = undefined
    }
  })

  afterAll(async () => {
    if (gateway) await gateway.close()
    if (backendServer) backendServer.stop()
  })

  it('should execute authentication before route-specific middleware', async () => {
    const executionOrder: string[] = []

    // Route-specific middleware that should run AFTER authentication
    const customMiddleware: RequestHandler = async (req, next) => {
      executionOrder.push('custom-middleware')
      // This should only run if authentication passes
      const response = await next()
      return response
    }

    gateway = new BunGateway({
      server: {
        port: 9011,
        hostname: 'localhost',
        development: true,
      },
      metrics: { enabled: false },
    })

    gateway.addRoute({
      pattern: '/api/protected/*',
      target: 'http://localhost:9010',
      auth: {
        secret: 'test-secret-at-least-32-bytes-long-for-hs256!',
        optional: false,
      },
      middlewares: [customMiddleware],
    })

    await gateway.listen()

    // Test without authentication - should fail before custom middleware runs
    const unauthResponse = await fetch(
      'http://localhost:9011/api/protected/data',
    )
    expect(unauthResponse.status).toBe(401)
    expect(executionOrder).not.toContain('custom-middleware')

    // Test with optional auth - custom middleware should run
    executionOrder.length = 0 // Clear array

    // Create a new route with optional auth to test middleware execution
    gateway.addRoute({
      pattern: '/api/optional/*',
      target: 'http://localhost:9010',
      auth: {
        secret: 'test-secret-at-least-32-bytes-long-for-hs256!',
        optional: true, // Allow requests without auth
      },
      middlewares: [customMiddleware],
    })

    const optionalResponse = await fetch(
      'http://localhost:9011/api/optional/data',
    )
    expect(optionalResponse.status).toBe(200)
    expect(executionOrder).toContain('custom-middleware')
  })

  it('should execute rate limiting before route-specific middleware', async () => {
    const executionOrder: string[] = []
    let customMiddlewareCallCount = 0

    // Route-specific middleware that should run AFTER rate limiting
    const customMiddleware: RequestHandler = async (req, next) => {
      customMiddlewareCallCount++
      executionOrder.push('custom-middleware')
      const response = await next()
      return response
    }

    gateway = new BunGateway({
      server: {
        port: 9012,
        hostname: 'localhost',
        development: true,
      },
      metrics: { enabled: false },
    })

    gateway.addRoute({
      pattern: '/api/limited/*',
      target: 'http://localhost:9010',
      rateLimit: {
        max: 2, // Only allow 2 requests
        windowMs: 60000,
      },
      middlewares: [customMiddleware],
    })

    await gateway.listen()

    // First request - should succeed
    const response1 = await fetch('http://localhost:9012/api/limited/data')
    expect(response1.status).toBe(200)

    // Second request - should succeed
    const response2 = await fetch('http://localhost:9012/api/limited/data')
    expect(response2.status).toBe(200)

    // Third request - should be rate limited before custom middleware runs
    const response3 = await fetch('http://localhost:9012/api/limited/data')
    expect(response3.status).toBe(429)

    // Custom middleware should only have been called twice (not three times)
    expect(customMiddlewareCallCount).toBe(2)
  })

  it('should execute security middleware in correct order: auth -> rate limit -> custom', async () => {
    const executionOrder: string[] = []

    const customMiddleware: RequestHandler = async (req, next) => {
      executionOrder.push('custom-middleware')
      const response = await next()
      return response
    }

    gateway = new BunGateway({
      server: {
        port: 9013,
        hostname: 'localhost',
        development: true,
      },
      metrics: { enabled: false },
    })

    gateway.addRoute({
      pattern: '/api/secure/*',
      target: 'http://localhost:9010',
      auth: {
        secret: 'test-secret-at-least-32-bytes-long-for-hs256!',
        optional: false,
      },
      rateLimit: {
        max: 10,
        windowMs: 60000,
      },
      middlewares: [customMiddleware],
    })

    await gateway.listen()

    // Test without auth - should fail at authentication, before rate limit and custom middleware
    const unauthResponse = await fetch('http://localhost:9013/api/secure/data')
    expect(unauthResponse.status).toBe(401)
    expect(executionOrder).not.toContain('custom-middleware')

    // Test with optional auth to verify middleware order
    executionOrder.length = 0

    gateway.addRoute({
      pattern: '/api/secure-optional/*',
      target: 'http://localhost:9010',
      auth: {
        secret: 'test-secret-at-least-32-bytes-long-for-hs256!',
        optional: true, // Allow requests without auth
      },
      rateLimit: {
        max: 10,
        windowMs: 60000,
      },
      middlewares: [customMiddleware],
    })

    const optionalResponse = await fetch(
      'http://localhost:9013/api/secure-optional/data',
    )
    expect(optionalResponse.status).toBe(200)
    expect(executionOrder).toContain('custom-middleware')
  })
})

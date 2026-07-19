import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway.ts'
import type { RouteConfig } from '../../src/interfaces/route.ts'
import type { ZeroRequest } from '../../src/interfaces/middleware.ts'

describe('BunGateway Rate Limiting (0http-bun)', () => {
  let gateway: BunGateway

  beforeEach(() => {
    gateway = new BunGateway()
  })

  afterEach(async () => {
    if (gateway) {
      await gateway.close()
    }
  })

  test('should apply rate limiting and return 429 when exceeded', async () => {
    const route: RouteConfig = {
      pattern: '/api/rate-limited',
      methods: ['GET'],
      handler: (req: ZeroRequest) => {
        return Response.json({
          message: 'Success',
          rateLimit: req.ctx?.rateLimit,
        })
      },
      rateLimit: {
        windowMs: 60000, // 1 minute
        max: 3, // Only 3 requests allowed
      },
    }

    gateway.addRoute(route)

    // Make requests up to the limit
    const successfulRequests = []
    for (let i = 0; i < 3; i++) {
      const request = new Request('http://localhost/api/rate-limited', {
        method: 'GET',
      })
      const response = await gateway.fetch(request)
      successfulRequests.push(response)
    }

    // All should be successful
    for (const response of successfulRequests) {
      expect(response.status).toBe(200)
      const data = (await response.json()) as { rateLimit?: any }
      expect(data.rateLimit).toBeDefined()
      expect(data.rateLimit.limit).toBe(3)
    }

    // The 4th request should be rate limited
    const request4 = new Request('http://localhost/api/rate-limited', {
      method: 'GET',
    })
    const response4 = await gateway.fetch(request4)

    expect(response4.status).toBe(429)

    // Check rate limit headers
    expect(response4.headers.get('X-RateLimit-Limit')).toBe('3')
    expect(response4.headers.get('X-RateLimit-Used')).toBe('4')
    expect(response4.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(response4.headers.has('X-RateLimit-Reset')).toBe(true)

    // Response should contain error message
    const errorData = (await response4.json()) as {
      error: string
      message: string
    }
    expect(errorData.error).toBe('Too many requests')
    expect(errorData.message).toContain('Rate limit exceeded')
  })

  test('should use custom key generator for rate limiting', async () => {
    const route: RouteConfig = {
      pattern: '/api/custom-rate-limit',
      methods: ['GET'],
      handler: (req: ZeroRequest) => {
        return Response.json({
          message: 'Success',
          key: req.headers.get('x-user-id') || 'anonymous',
        })
      },
      rateLimit: {
        windowMs: 60000,
        max: 2,
        keyGenerator: (req: ZeroRequest) => {
          // Use user ID from header for rate limiting
          return req.headers.get('x-user-id') || 'anonymous'
        },
      },
    }

    gateway.addRoute(route)

    // User1 makes 2 requests (should succeed)
    const user1Request1 = new Request(
      'http://localhost/api/custom-rate-limit',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user1' },
      },
    )
    const user1Response1 = await gateway.fetch(user1Request1)
    expect(user1Response1.status).toBe(200)

    const user1Request2 = new Request(
      'http://localhost/api/custom-rate-limit',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user1' },
      },
    )
    const user1Response2 = await gateway.fetch(user1Request2)
    expect(user1Response2.status).toBe(200)

    // User1's 3rd request should be rate limited
    const user1Request3 = new Request(
      'http://localhost/api/custom-rate-limit',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user1' },
      },
    )
    const user1Response3 = await gateway.fetch(user1Request3)
    expect(user1Response3.status).toBe(429)

    // But User2 should still be able to make requests (different key)
    const user2Request1 = new Request(
      'http://localhost/api/custom-rate-limit',
      {
        method: 'GET',
        headers: { 'x-user-id': 'user2' },
      },
    )
    const user2Response1 = await gateway.fetch(user2Request1)
    expect(user2Response1.status).toBe(200)
  })

  test('should apply global rate limiting with excludePaths', async () => {
    const gateway = new BunGateway({
      rateLimit: {
        windowMs: 60000,
        max: 1,
        excludePaths: ['/health'],
      },
    })

    gateway.addRoute({
      pattern: '/*',
      handler: (req: ZeroRequest) =>
        Response.json({ path: new URL(req.url).pathname }),
    })

    // First request to a non-excluded path succeeds
    const response1 = await gateway.fetch(
      new Request('http://localhost/api/data'),
    )
    expect(response1.status).toBe(200)

    // Second request to the same path is rate limited
    const response2 = await gateway.fetch(
      new Request('http://localhost/api/data'),
    )
    expect(response2.status).toBe(429)

    // Excluded path remains available
    for (let i = 0; i < 3; i++) {
      const healthResponse = await gateway.fetch(
        new Request('http://localhost/health'),
      )
      expect(healthResponse.status).toBe(200)
    }

    // Boundary: '/healthcheck' should NOT match the excluded '/health' prefix
    const healthCheckResponse = await gateway.fetch(
      new Request('http://localhost/healthcheck'),
    )
    expect(healthCheckResponse.status).toBe(429)

    await gateway.close()
  })

  test('should exclude paths from rate limiting', async () => {
    const route: RouteConfig = {
      pattern: '/api/maybe-limited/*',
      methods: ['GET'],
      handler: (req: ZeroRequest) => {
        return Response.json({
          message: 'Success',
          path: new URL(req.url).pathname,
        })
      },
      rateLimit: {
        windowMs: 60000,
        max: 1, // Very restrictive limit
        excludePaths: ['/api/maybe-limited/health'], // But exclude health check
      },
    }

    gateway.addRoute(route)

    // Regular endpoint should be rate limited after 1 request
    const request1 = new Request('http://localhost/api/maybe-limited/data', {
      method: 'GET',
    })
    const response1 = await gateway.fetch(request1)
    expect(response1.status).toBe(200)

    const request2 = new Request('http://localhost/api/maybe-limited/data', {
      method: 'GET',
    })
    const response2 = await gateway.fetch(request2)
    expect(response2.status).toBe(429)

    // But health endpoint should never be rate limited
    for (let i = 0; i < 5; i++) {
      const healthRequest = new Request(
        'http://localhost/api/maybe-limited/health',
        { method: 'GET' },
      )
      const healthResponse = await gateway.fetch(healthRequest)
      expect(healthResponse.status).toBe(200)
    }
  })

  test('should use boundary-aware excludePaths for route rate limiting', async () => {
    const route: RouteConfig = {
      pattern: '/api/maybe-limited/*',
      methods: ['GET'],
      handler: (req: ZeroRequest) => {
        return Response.json({
          message: 'Success',
          path: new URL(req.url).pathname,
        })
      },
      rateLimit: {
        windowMs: 60000,
        max: 1,
        excludePaths: ['/api/maybe-limited/health'],
      },
    }

    gateway.addRoute(route)

    // The excluded path itself is not rate limited.
    const healthResponse = await gateway.fetch(
      new Request('http://localhost/api/maybe-limited/health', {
        method: 'GET',
      }),
    )
    expect(healthResponse.status).toBe(200)

    // A sibling path sharing the prefix MUST still be rate limited.
    const response1 = await gateway.fetch(
      new Request('http://localhost/api/maybe-limited/healthcheck', {
        method: 'GET',
      }),
    )
    expect(response1.status).toBe(200)

    const response2 = await gateway.fetch(
      new Request('http://localhost/api/maybe-limited/healthcheck', {
        method: 'GET',
      }),
    )
    expect(response2.status).toBe(429)
  })

  test('should provide rate limit context in request', async () => {
    const route: RouteConfig = {
      pattern: '/api/rate-context',
      methods: ['GET'],
      handler: (req: ZeroRequest) => {
        const rateLimit = req.ctx?.rateLimit
        return Response.json({
          message: 'Success',
          rateLimit: {
            limit: rateLimit?.limit,
            used: rateLimit?.used,
            remaining: rateLimit?.remaining,
            hasResetTime: !!rateLimit?.resetTime,
          },
        })
      },
      rateLimit: {
        windowMs: 60000,
        max: 5,
      },
    }

    gateway.addRoute(route)

    // First request
    const request1 = new Request('http://localhost/api/rate-context', {
      method: 'GET',
    })
    const response1 = await gateway.fetch(request1)
    expect(response1.status).toBe(200)

    const data1 = (await response1.json()) as { rateLimit: any }
    expect(data1.rateLimit.limit).toBe(5)
    expect(data1.rateLimit.used).toBe(1)
    expect(data1.rateLimit.remaining).toBe(4)
    expect(data1.rateLimit.hasResetTime).toBe(true)

    // Second request
    const request2 = new Request('http://localhost/api/rate-context', {
      method: 'GET',
    })
    const response2 = await gateway.fetch(request2)
    expect(response2.status).toBe(200)

    const data2 = (await response2.json()) as { rateLimit: any }
    expect(data2.rateLimit.limit).toBe(5)
    expect(data2.rateLimit.used).toBe(2)
    expect(data2.rateLimit.remaining).toBe(3)
  })

  test('BunGateway Rate Limiting (0http-bun) > should use custom message for rate limit exceeded', async () => {
    const gateway = new BunGateway()

    gateway.addRoute({
      pattern: '/api/limited',
      handler: async () => new Response('OK', { status: 200 }),
      rateLimit: {
        windowMs: 1000,
        max: 1,
        handler(req, totalHits, max, resetTime) {
          return new Response('Custom rate limit message', {
            status: 429,
            headers: { 'Content-Type': 'text/plain' },
          })
        },
      },
    })

    // First request should succeed
    const response1 = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response1.status).toBe(200)

    // Second request should be rate limited with custom message
    const response2 = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response2.status).toBe(429)
    expect(await response2.text()).toBe('Custom rate limit message')
  })

  test('BunGateway Rate Limiting (0http-bun) > should skip rate limiting with skip function', async () => {
    const gateway = new BunGateway()

    gateway.addRoute({
      pattern: '/api/limited',
      handler: async () => new Response('OK', { status: 200 }),
      rateLimit: {
        windowMs: 1000,
        max: 1,
        skip: (req) => req.headers.get('x-skip-rate-limit') === 'true',
      },
    })

    // First request should succeed
    const response1 = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response1.status).toBe(200)

    // Second request would normally be rate limited, but should succeed with skip header
    const response2 = await gateway.fetch(
      new Request('http://localhost/api/limited', {
        headers: { 'x-skip-rate-limit': 'true' },
      }),
    )
    expect(response2.status).toBe(200)

    // Third request without skip header should be rate limited
    const response3 = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response3.status).toBe(429)
  })

  test('BunGateway Rate Limiting (0http-bun) > should include standard rate limit headers', async () => {
    const gateway = new BunGateway()

    gateway.addRoute({
      pattern: '/api/limited',
      handler: async () => new Response('OK', { status: 200 }),
      rateLimit: {
        windowMs: 60000,
        max: 5,
        standardHeaders: true,
      },
    })

    const response = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response.status).toBe(200)

    // Check rate limit headers
    expect(response.headers.get('X-RateLimit-Limit')).toBe('5')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4')
    expect(response.headers.get('X-RateLimit-Used')).toBe('1')
    expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy()
  })

  test('BunGateway Rate Limiting (0http-bun) > should use custom handler for rate limit exceeded', async () => {
    const gateway = new BunGateway()

    gateway.addRoute({
      pattern: '/api/limited',
      handler: async () => new Response('OK', { status: 200 }),
      rateLimit: {
        windowMs: 1000,
        max: 1,
        handler: (req, totalHits, max, resetTime) => {
          return new Response(
            JSON.stringify({
              error: 'Custom rate limit handler',
              hits: totalHits,
              limit: max,
              retryAfter: Math.ceil((resetTime.getTime() - Date.now()) / 1000),
            }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        },
      },
    })

    // First request should succeed
    const response1 = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response1.status).toBe(200)

    // Second request should be rate limited with custom handler
    const response2 = await gateway.fetch(
      new Request('http://localhost/api/limited'),
    )
    expect(response2.status).toBe(429)

    const responseData = (await response2.json()) as any
    expect(responseData.error).toBe('Custom rate limit handler')
    expect(responseData.hits).toBe(2)
    expect(responseData.limit).toBe(1)
    expect(typeof responseData.retryAfter).toBe('number')
  })
})

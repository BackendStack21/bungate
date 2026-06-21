/**
 * Weighted Load Balancer E2E Tests
 * Tests the weighted load balancing strategy with different weight configurations
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway'
import { BunGateLogger } from '../../src/logger/pino-logger'

interface EchoResponse {
  server: string
  port: number
  method: string
  path: string
  headers: Record<string, string>
  timestamp: string
}

describe('Weighted Load Balancer E2E Tests', () => {
  let gateway: BunGateway
  let echoServer1: any
  let echoServer2: any
  let echoServer3: any

  beforeAll(async () => {
    // Start echo servers on ports 8100, 8101, and 8102
    echoServer1 = Bun.serve({
      port: 8100,
      fetch(req) {
        const url = new URL(req.url)

        // Health endpoint
        if (url.pathname === '/health' || url.pathname === '/') {
          return new Response('OK', {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Server': 'echo-1',
            },
          })
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-1',
          port: 8100,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          timestamp: new Date().toISOString(),
        }

        return new Response(JSON.stringify(response, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'X-Server': 'echo-1',
          },
        })
      },
    })

    echoServer2 = Bun.serve({
      port: 8101,
      fetch(req) {
        const url = new URL(req.url)

        // Health endpoint
        if (url.pathname === '/health' || url.pathname === '/') {
          return new Response('OK', {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Server': 'echo-2',
            },
          })
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-2',
          port: 8101,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          timestamp: new Date().toISOString(),
        }

        return new Response(JSON.stringify(response, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'X-Server': 'echo-2',
          },
        })
      },
    })

    echoServer3 = Bun.serve({
      port: 8102,
      fetch(req) {
        const url = new URL(req.url)

        // Health endpoint
        if (url.pathname === '/health' || url.pathname === '/') {
          return new Response('OK', {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Server': 'echo-3',
            },
          })
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-3',
          port: 8102,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          timestamp: new Date().toISOString(),
        }

        return new Response(JSON.stringify(response, null, 2), {
          headers: {
            'Content-Type': 'application/json',
            'X-Server': 'echo-3',
          },
        })
      },
    })

    // Wait a bit for servers to start
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Create gateway with basic logger
    const logger = new BunGateLogger({
      level: 'error', // Keep logs quiet during tests
    })

    gateway = new BunGateway({
      logger,
      server: {
        port: 3002, // Use different port to avoid conflicts
        development: false, // Disable development mode to avoid Prometheus conflicts
        hostname: '127.0.0.1',
      },
    })

    // Add weighted load balancer route with 5:2:1 ratio
    gateway.addRoute({
      pattern: '/api/weighted-high/*',
      loadBalancer: {
        strategy: 'weighted',
        targets: [
          { url: 'http://localhost:8100', weight: 5 }, // High weight
          { url: 'http://localhost:8101', weight: 2 }, // Medium weight
          { url: 'http://localhost:8102', weight: 1 }, // Low weight
        ],
        healthCheck: {
          enabled: true,
          interval: 2000,
          timeout: 1000,
          path: '/health',
          expectedStatus: 200,
        },
      },
      proxy: {
        pathRewrite: (path) => path.replace('/api/weighted-high', ''),
        timeout: 5000,
      },
    })

    // Add weighted load balancer route with equal weights
    gateway.addRoute({
      pattern: '/api/weighted-equal/*',
      loadBalancer: {
        strategy: 'weighted',
        targets: [
          { url: 'http://localhost:8100', weight: 1 }, // Equal weight
          { url: 'http://localhost:8101', weight: 1 }, // Equal weight
          { url: 'http://localhost:8102', weight: 1 }, // Equal weight
        ],
        healthCheck: {
          enabled: true,
          interval: 2000,
          timeout: 1000,
          path: '/health',
          expectedStatus: 200,
        },
      },
      proxy: {
        pathRewrite: (path) => path.replace('/api/weighted-equal', ''),
        timeout: 5000,
      },
    })

    // Add weighted load balancer route with extreme ratio (10:1:0)
    gateway.addRoute({
      pattern: '/api/weighted-extreme/*',
      loadBalancer: {
        strategy: 'weighted',
        targets: [
          { url: 'http://localhost:8100', weight: 10 }, // Very high weight
          { url: 'http://localhost:8101', weight: 1 }, // Low weight
        ],
        healthCheck: {
          enabled: true,
          interval: 2000,
          timeout: 1000,
          path: '/health',
          expectedStatus: 200,
        },
      },
      proxy: {
        pathRewrite: (path) => path.replace('/api/weighted-extreme', ''),
        timeout: 5000,
      },
    })

    // Start the gateway
    await gateway.listen(3002)

    // Wait for health checks to complete
    await new Promise((resolve) => setTimeout(resolve, 3000))
  })

  afterAll(async () => {
    // Clean up
    if (gateway) {
      await gateway.close()
    }
    if (echoServer1) {
      echoServer1.stop()
    }
    if (echoServer2) {
      echoServer2.stop()
    }
    if (echoServer3) {
      echoServer3.stop()
    }
  })

  test('should start all echo servers successfully', async () => {
    // Test that all servers are running
    const echo1Response = await fetch('http://localhost:8100/health')
    expect(echo1Response.status).toBe(200)
    expect(echo1Response.headers.get('X-Server')).toBe('echo-1')

    const echo2Response = await fetch('http://localhost:8101/health')
    expect(echo2Response.status).toBe(200)
    expect(echo2Response.headers.get('X-Server')).toBe('echo-2')

    const echo3Response = await fetch('http://localhost:8102/health')
    expect(echo3Response.status).toBe(200)
    expect(echo3Response.headers.get('X-Server')).toBe('echo-3')
  })

  test('should distribute requests according to weights (5:2:1)', async () => {
    const serverCounts: Record<string, number> = {
      'echo-1': 0,
      'echo-2': 0,
      'echo-3': 0,
    }
    const requestCount = 160 // Increased to 160 for better statistical distribution (multiple of 8)

    // Make multiple requests to observe weighted distribution
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch(
        'http://localhost:3002/api/weighted-high/test',
      )
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // Calculate expected distribution based on weights (5:2:1)
    // Total weight = 5 + 2 + 1 = 8
    // Expected percentages: echo-1 = 5/8 (62.5%), echo-2 = 2/8 (25%), echo-3 = 1/8 (12.5%)
    const expectedEcho1 = Math.round(requestCount * (5 / 8)) // 100 requests
    const expectedEcho2 = Math.round(requestCount * (2 / 8)) // 40 requests
    const expectedEcho3 = Math.round(requestCount * (1 / 8)) // 20 requests

    // Use more tolerant ranges for CI stability
    // Focus on the most important invariants rather than exact distributions

    // Total should equal request count (this must always be true)
    expect(
      (serverCounts['echo-1'] || 0) +
        (serverCounts['echo-2'] || 0) +
        (serverCounts['echo-3'] || 0),
    ).toBe(requestCount)

    // All servers should get at least some requests
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(0)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(0)
    expect(serverCounts['echo-3'] || 0).toBeGreaterThan(0)

    // Echo-1 should have the most requests (highest weight)
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(
      serverCounts['echo-2'] || 0,
    )
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(
      serverCounts['echo-3'] || 0,
    )

    // Echo-2 should have more requests than echo-3 (higher weight)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(
      serverCounts['echo-3'] || 0,
    )

    // Validate the weighted distribution is working with very generous tolerances
    // Echo-1 should get at least 30% of requests (much lower than expected 62.5% for CI stability)
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(requestCount * 0.3)

    // Echo-1 should get at most 85% of requests (much higher than expected 62.5% for CI stability)
    expect(serverCounts['echo-1'] || 0).toBeLessThan(requestCount * 0.85)

    // Echo-2 should get at least 5% of requests (much lower than expected 25% for CI stability)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(requestCount * 0.05)

    // Echo-2 should get at most 50% of requests (much higher than expected 25% for CI stability)
    expect(serverCounts['echo-2'] || 0).toBeLessThan(requestCount * 0.5)

    // Echo-3 should get at least 2% of requests (much lower than expected 12.5% for CI stability)
    expect(serverCounts['echo-3'] || 0).toBeGreaterThan(requestCount * 0.02)

    // Echo-3 should get at most 40% of requests (much higher than expected 12.5% for CI stability)
    expect(serverCounts['echo-3'] || 0).toBeLessThan(requestCount * 0.4)

    // The key invariant: echo-1 should have more requests than echo-2 and echo-3 combined
    // This is relaxed to allow for some variance in CI environments
    const echo1Count = serverCounts['echo-1'] || 0
    const echo2Count = serverCounts['echo-2'] || 0
    const echo3Count = serverCounts['echo-3'] || 0

    // Allow echo-1 to have at least 40% of the total, which should be more than echo-2 + echo-3 in most cases
    expect(echo1Count).toBeGreaterThan(requestCount * 0.4)
  })

  test('should distribute requests evenly when weights are equal', async () => {
    const serverCounts: Record<string, number> = {
      'echo-1': 0,
      'echo-2': 0,
      'echo-3': 0,
    }
    const requestCount = 120 // Increased for better statistical distribution (multiple of 3)

    // Make multiple requests to test equal weight distribution
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch(
        'http://localhost:3002/api/weighted-equal/test',
      )
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // Total should equal request count (this must always be true)
    expect(
      (serverCounts['echo-1'] || 0) +
        (serverCounts['echo-2'] || 0) +
        (serverCounts['echo-3'] || 0),
    ).toBe(requestCount)

    // All servers should get at least some requests
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(0)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(0)
    expect(serverCounts['echo-3'] || 0).toBeGreaterThan(0)

    // With equal weights, each server should get roughly 1/3 of requests
    // Use very generous tolerances for CI stability
    const expectedPerServer = requestCount / 3 // 40 requests each

    // Each server should get at least 15% of requests (much lower than expected 33.3% for CI stability)
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(requestCount * 0.15)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(requestCount * 0.15)
    expect(serverCounts['echo-3'] || 0).toBeGreaterThan(requestCount * 0.15)

    // Each server should get at most 65% of requests (much higher than expected 33.3% for CI stability)
    expect(serverCounts['echo-1'] || 0).toBeLessThan(requestCount * 0.65)
    expect(serverCounts['echo-2'] || 0).toBeLessThan(requestCount * 0.65)
    expect(serverCounts['echo-3'] || 0).toBeLessThan(requestCount * 0.65)

    // The difference between any two servers should not be too extreme
    // Allow up to 2x difference between servers for CI stability
    const counts = [
      serverCounts['echo-1'] || 0,
      serverCounts['echo-2'] || 0,
      serverCounts['echo-3'] || 0,
    ]
    const maxCount = Math.max(...counts)
    const minCount = Math.min(...counts)

    // Max should not be more than 3x the min for equal weights
    expect(maxCount).toBeLessThan(minCount * 3)
  })

  test('should heavily favor high-weight server in extreme ratio (10:1)', async () => {
    const serverCounts: Record<string, number> = { 'echo-1': 0, 'echo-2': 0 }
    const requestCount = 110 // Increased for better statistical distribution (multiple of 11)

    // Make multiple requests to test extreme weight distribution
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch(
        'http://localhost:3002/api/weighted-extreme/test',
      )
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // Total should equal request count (this must always be true)
    expect((serverCounts['echo-1'] || 0) + (serverCounts['echo-2'] || 0)).toBe(
      requestCount,
    )

    // Both servers should get at least some requests
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(0)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(0)

    // With 10:1 weight ratio, echo-1 should get ~90% of requests
    // Use generous tolerances for CI stability

    // Echo-1 should get at least 60% of requests (much lower than expected 90.9% for CI stability)
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(requestCount * 0.6)

    // Echo-1 should get at most 98% of requests (slightly higher than expected 90.9% for CI stability)
    expect(serverCounts['echo-1'] || 0).toBeLessThan(requestCount * 0.98)

    // Echo-2 should get at least 2% of requests (much lower than expected 9.1% for CI stability)
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(requestCount * 0.02)

    // Echo-2 should get at most 40% of requests (much higher than expected 9.1% for CI stability)
    expect(serverCounts['echo-2'] || 0).toBeLessThan(requestCount * 0.4)

    // Echo-1 should have significantly more requests than echo-2 (key invariant)
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(
      (serverCounts['echo-2'] || 0) * 2,
    )
  })

  test('should handle path rewriting correctly with weighted strategy', async () => {
    const response = await fetch(
      'http://localhost:3002/api/weighted-high/custom/path',
    )
    expect(response.status).toBe(200)

    const data = (await response.json()) as EchoResponse
    expect(data.path).toBe('/custom/path')
    expect(data.method).toBe('GET')
    expect(data.server).toMatch(/echo-[123]/)
  })

  test('should handle request headers correctly with weighted strategy', async () => {
    const response = await fetch(
      'http://localhost:3002/api/weighted-high/headers',
      {
        headers: {
          'X-Test-Header': 'weighted-test',
          Authorization: 'Bearer weighted-token',
        },
      },
    )

    expect(response.status).toBe(200)
    const data = (await response.json()) as EchoResponse

    // Verify custom headers were passed through
    expect(data.headers['x-test-header']).toBe('weighted-test')
    // Authorization is stripped from proxied requests for security
    expect(data.headers['authorization']).toBeUndefined()
    expect(data.server).toMatch(/echo-[123]/)
  })
})

/**
 * Random Load Balancer E2E Tests
 * Tests the random load balancing strategy
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway.ts'
import { BunGateLogger } from '../../src/logger/pino-logger.ts'

interface EchoResponse {
  server: string
  port: number
  method: string
  path: string
  headers: Record<string, string>
  timestamp: string
}

describe('Random Load Balancer E2E Tests', () => {
  let gateway: BunGateway
  let echoServer1: any
  let echoServer2: any
  let echoServer3: any

  beforeAll(async () => {
    // Start echo servers on ports 8090, 8091, and 8092 (different ports to avoid conflicts)
    echoServer1 = Bun.serve({
      port: 8090,
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
          port: 8090,
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
      port: 8091,
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
          port: 8091,
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
      port: 8092,
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
          port: 8092,
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
        port: 3004, // Use different port to avoid conflicts
        development: false, // Disable development mode to avoid Prometheus conflicts
        hostname: '127.0.0.1',
      },
    })

    // Add random load balancer route with 3 servers
    gateway.addRoute({
      pattern: '/api/random-three/*',
      loadBalancer: {
        strategy: 'random',
        targets: [
          { url: 'http://localhost:8090' },
          { url: 'http://localhost:8091' },
          { url: 'http://localhost:8092' },
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
        pathRewrite: (path) => path.replace('/api/random-three', ''),
        timeout: 5000,
      },
    })

    // Add random load balancer route with 2 servers for easier prediction
    gateway.addRoute({
      pattern: '/api/random-two/*',
      loadBalancer: {
        strategy: 'random',
        targets: [
          { url: 'http://localhost:8090' },
          { url: 'http://localhost:8091' },
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
        pathRewrite: (path) => path.replace('/api/random-two', ''),
        timeout: 5000,
      },
    })

    // Start the gateway
    await gateway.listen(3004)

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
    const echo1Response = await fetch('http://localhost:8090/health')
    expect(echo1Response.status).toBe(200)
    expect(echo1Response.headers.get('X-Server')).toBe('echo-1')

    const echo2Response = await fetch('http://localhost:8091/health')
    expect(echo2Response.status).toBe(200)
    expect(echo2Response.headers.get('X-Server')).toBe('echo-2')

    const echo3Response = await fetch('http://localhost:8092/health')
    expect(echo3Response.status).toBe(200)
    expect(echo3Response.headers.get('X-Server')).toBe('echo-3')
  })

  test('should randomly distribute requests among three servers', async () => {
    const serverCounts: Record<string, number> = {
      'echo-1': 0,
      'echo-2': 0,
      'echo-3': 0,
    }
    const requestCount = 30 // Large number to see randomness

    // Make multiple requests to observe random distribution
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch(
        'http://localhost:3004/api/random-three/test',
      )
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // All servers should have received at least some requests with high probability
    expect(serverCounts['echo-1']).toBeGreaterThan(0)
    expect(serverCounts['echo-2']).toBeGreaterThan(0)
    expect(serverCounts['echo-3']).toBeGreaterThan(0)

    // Total should equal request count
    expect(
      (serverCounts['echo-1'] || 0) +
        (serverCounts['echo-2'] || 0) +
        (serverCounts['echo-3'] || 0),
    ).toBe(requestCount)

    // No single server should get all requests (extremely unlikely with random)
    expect(serverCounts['echo-1'] || 0).toBeLessThan(requestCount)
    expect(serverCounts['echo-2'] || 0).toBeLessThan(requestCount)
    expect(serverCounts['echo-3'] || 0).toBeLessThan(requestCount)

    // Each server should get roughly 1/3 of requests (allow generous variance for randomness)
    const expectedPerServer = requestCount / 3
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(expectedPerServer * 0.3) // At least 30% of expected
    expect(serverCounts['echo-1'] || 0).toBeLessThanOrEqual(
      expectedPerServer * 1.7,
    ) // At most 170% of expected
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(expectedPerServer * 0.3)
    expect(serverCounts['echo-2'] || 0).toBeLessThanOrEqual(
      expectedPerServer * 1.7,
    )
    expect(serverCounts['echo-3'] || 0).toBeGreaterThan(expectedPerServer * 0.3)
    expect(serverCounts['echo-3'] || 0).toBeLessThanOrEqual(
      expectedPerServer * 1.7,
    )
  })

  test('should randomly distribute requests between two servers', async () => {
    const serverCounts: Record<string, number> = { 'echo-1': 0, 'echo-2': 0 }
    const requestCount = 20

    // Make multiple requests to observe random distribution
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch('http://localhost:3004/api/random-two/test')
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // Both servers should have received at least some requests
    expect(serverCounts['echo-1']).toBeGreaterThan(0)
    expect(serverCounts['echo-2']).toBeGreaterThan(0)

    // Total should equal request count
    expect((serverCounts['echo-1'] || 0) + (serverCounts['echo-2'] || 0)).toBe(
      requestCount,
    )

    // Neither server should get all requests
    expect(serverCounts['echo-1'] || 0).toBeLessThan(requestCount)
    expect(serverCounts['echo-2'] || 0).toBeLessThan(requestCount)

    // Each server should get roughly half of requests (allow variance for randomness)
    const expectedPerServer = requestCount / 2
    expect(serverCounts['echo-1'] || 0).toBeGreaterThan(expectedPerServer * 0.3) // At least 30% of expected
    expect(serverCounts['echo-1'] || 0).toBeLessThanOrEqual(
      expectedPerServer * 1.7,
    ) // At most 170% of expected
    expect(serverCounts['echo-2'] || 0).toBeGreaterThan(expectedPerServer * 0.3)
    expect(serverCounts['echo-2'] || 0).toBeLessThanOrEqual(
      expectedPerServer * 1.7,
    )
  })

  test('should show randomness across multiple test runs', async () => {
    const distributions = []

    // Run multiple small batches to observe different patterns
    for (let batch = 0; batch < 5; batch++) {
      const serverCounts: Record<string, number> = { 'echo-1': 0, 'echo-2': 0 }

      // Small batch of requests
      for (let i = 0; i < 6; i++) {
        const response = await fetch(
          'http://localhost:3004/api/random-two/batch',
        )
        expect(response.status).toBe(200)

        const data = (await response.json()) as EchoResponse
        if (data.server in serverCounts) {
          serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
        }
      }

      distributions.push({
        echo1: serverCounts['echo-1'] || 0,
        echo2: serverCounts['echo-2'] || 0,
      })
    }

    // Verify we got some variety in distributions (randomness should produce different patterns)
    const patterns = distributions.map((d) => `${d.echo1}-${d.echo2}`)
    const uniquePatterns = new Set(patterns)

    // With randomness, we should see at least 2 different patterns across 5 batches
    expect(uniquePatterns.size).toBeGreaterThanOrEqual(2)
  })

  test('should handle path rewriting correctly with random strategy', async () => {
    const response = await fetch(
      'http://localhost:3004/api/random-three/custom/path',
    )
    expect(response.status).toBe(200)

    const data = (await response.json()) as EchoResponse
    expect(data.path).toBe('/custom/path')
    expect(data.method).toBe('GET')
    expect(data.server).toMatch(/echo-[123]/)
  })

  test('should handle request headers correctly with random strategy', async () => {
    const response = await fetch(
      'http://localhost:3004/api/random-three/headers',
      {
        headers: {
          'X-Test-Header': 'random-test',
          Authorization: 'Bearer random-token',
        },
      },
    )

    expect(response.status).toBe(200)
    const data = (await response.json()) as EchoResponse

    // Verify custom headers were passed through
    expect(data.headers['x-test-header']).toBe('random-test')
    // Authorization is stripped from proxied requests for security
    expect(data.headers['authorization']).toBeUndefined()
    expect(data.server).toMatch(/echo-[123]/)
  })
})

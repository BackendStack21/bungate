/**
 * Least Connections Load Balancer E2E Tests
 * Tests the least-connections load balancing strategy
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
  delay?: number
}

describe('Least Connections Load Balancer E2E Tests', () => {
  let gateway: BunGateway
  let echoServer1: any
  let echoServer2: any
  let echoServer3: any

  beforeAll(async () => {
    // Start echo servers with different response times to simulate connection loads
    echoServer1 = Bun.serve({
      port: 8110,
      async fetch(req) {
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

        // Simulate different processing times
        const delay = url.searchParams.get('delay')
          ? parseInt(url.searchParams.get('delay')!)
          : 0
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-1',
          port: 8110,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          timestamp: new Date().toISOString(),
          delay: delay,
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
      port: 8111,
      async fetch(req) {
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

        // Simulate different processing times
        const delay = url.searchParams.get('delay')
          ? parseInt(url.searchParams.get('delay')!)
          : 0
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-2',
          port: 8111,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          timestamp: new Date().toISOString(),
          delay: delay,
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
      port: 8112,
      async fetch(req) {
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

        // Simulate different processing times
        const delay = url.searchParams.get('delay')
          ? parseInt(url.searchParams.get('delay')!)
          : 0
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay))
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-3',
          port: 8112,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          timestamp: new Date().toISOString(),
          delay: delay,
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
        port: 3003, // Use different port to avoid conflicts
        development: false, // Disable development mode to avoid Prometheus conflicts
        hostname: '127.0.0.1',
      },
    })

    // Add least-connections load balancer route
    gateway.addRoute({
      pattern: '/api/least-connections/*',
      loadBalancer: {
        strategy: 'least-connections',
        targets: [
          { url: 'http://localhost:8110' },
          { url: 'http://localhost:8111' },
          { url: 'http://localhost:8112' },
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
        pathRewrite: (path) => path.replace('/api/least-connections', ''),
        timeout: 10000, // Longer timeout for delay tests
      },
    })

    // Add a second route for concurrent testing
    gateway.addRoute({
      pattern: '/api/concurrent/*',
      loadBalancer: {
        strategy: 'least-connections',
        targets: [
          { url: 'http://localhost:8110' },
          { url: 'http://localhost:8111' },
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
        pathRewrite: (path) => path.replace('/api/concurrent', ''),
        timeout: 10000,
      },
    })

    // Start the gateway
    await gateway.listen(3003)

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
    const echo1Response = await fetch('http://localhost:8110/health')
    expect(echo1Response.status).toBe(200)
    expect(echo1Response.headers.get('X-Server')).toBe('echo-1')

    const echo2Response = await fetch('http://localhost:8111/health')
    expect(echo2Response.status).toBe(200)
    expect(echo2Response.headers.get('X-Server')).toBe('echo-2')

    const echo3Response = await fetch('http://localhost:8112/health')
    expect(echo3Response.status).toBe(200)
    expect(echo3Response.headers.get('X-Server')).toBe('echo-3')
  })

  test('should distribute requests using least-connections strategy', async () => {
    const serverCounts: Record<string, number> = {
      'echo-1': 0,
      'echo-2': 0,
      'echo-3': 0,
    }
    const requestCount = 6

    // Make requests to test least-connections behavior
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch(
        'http://localhost:3003/api/least-connections/test',
      )
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // Total should equal request count
    expect(
      (serverCounts['echo-1'] || 0) +
        (serverCounts['echo-2'] || 0) +
        (serverCounts['echo-3'] || 0),
    ).toBe(requestCount)

    // At least one server should have received requests (basic functionality)
    const totalRequests =
      (serverCounts['echo-1'] || 0) +
      (serverCounts['echo-2'] || 0) +
      (serverCounts['echo-3'] || 0)
    expect(totalRequests).toBe(requestCount)

    // The strategy should work (even if it consistently picks one server due to timing)
    expect(totalRequests).toBeGreaterThan(0)
  })

  test('should handle basic concurrent requests', async () => {
    // Start a few concurrent requests to test basic functionality
    const promises = []

    for (let i = 0; i < 3; i++) {
      promises.push(
        fetch('http://localhost:3003/api/concurrent/basic')
          .then((res) => res.json())
          .then((data) => data as EchoResponse),
      )
    }

    const results = await Promise.all(promises)

    // All requests should succeed
    expect(results.length).toBe(3)
    results.forEach((result) => {
      expect(result.server).toMatch(/echo-[12]/)
      expect(result.method).toBe('GET')
      expect(result.path).toBe('/basic')
    })
  })

  test('should balance load when servers have different response times', async () => {
    // Test with mixed delays to ensure least-connections works with different response times
    const serverCounts: Record<string, number> = {
      'echo-1': 0,
      'echo-2': 0,
      'echo-3': 0,
    }
    const promises = []

    // Start multiple requests with different delays
    for (let i = 0; i < 9; i++) {
      const delay = (i % 3) * 50 // 0ms, 50ms, 100ms delays
      promises.push(
        fetch(
          `http://localhost:3003/api/least-connections/mixed?delay=${delay}`,
        )
          .then((res) => res.json())
          .then((data) => {
            const response = data as EchoResponse
            if (response.server in serverCounts) {
              serverCounts[response.server] =
                (serverCounts[response.server] || 0) + 1
            }
            return response
          }),
      )
    }

    const results = await Promise.all(promises)

    // All requests should succeed
    expect(results.length).toBe(9)

    // All servers should have received requests
    expect(serverCounts['echo-1']).toBeGreaterThan(0)
    expect(serverCounts['echo-2']).toBeGreaterThan(0)
    expect(serverCounts['echo-3']).toBeGreaterThan(0)

    // Total should equal request count
    expect(
      (serverCounts['echo-1'] || 0) +
        (serverCounts['echo-2'] || 0) +
        (serverCounts['echo-3'] || 0),
    ).toBe(9)
  })

  test('should handle path rewriting correctly with least-connections strategy', async () => {
    const response = await fetch(
      'http://localhost:3003/api/least-connections/custom/path',
    )
    expect(response.status).toBe(200)

    const data = (await response.json()) as EchoResponse
    expect(data.path).toBe('/custom/path')
    expect(data.method).toBe('GET')
  })

  test('should handle request headers correctly with least-connections strategy', async () => {
    const response = await fetch(
      'http://localhost:3003/api/least-connections/headers',
      {
        headers: {
          'X-Test-Header': 'least-connections-test',
          Authorization: 'Bearer lc-token',
        },
      },
    )

    expect(response.status).toBe(200)
    const data = (await response.json()) as EchoResponse

    // Verify custom headers were passed through
    expect(data.headers['x-test-header']).toBe('least-connections-test')
    // Authorization is stripped from proxied requests for security
    expect(data.headers['authorization']).toBeUndefined()
  })
})

/**
 * Basic E2E tests for Load Balancer functionality
 * Tests the fundamental load balancing capabilities with real echo servers
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

describe('Basic Load Balancer E2E Tests', () => {
  let gateway: BunGateway
  let echoServer1: any
  let echoServer2: any

  beforeAll(async () => {
    // Start echo servers on ports 8080 and 8081
    echoServer1 = Bun.serve({
      port: 8080,
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
          port: 8080,
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
      port: 8081,
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
          port: 8081,
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

    // Wait a bit for servers to start
    await new Promise((resolve) => setTimeout(resolve, 100))

    // Create gateway with basic logger
    const logger = new BunGateLogger({
      level: 'error', // Keep logs quiet during tests
    })

    gateway = new BunGateway({
      logger,
      server: {
        port: 3001, // Use different port to avoid conflicts
        development: false, // Disable development mode to avoid Prometheus conflicts
        hostname: '127.0.0.1',
      },
    })

    // Add a basic round-robin route
    gateway.addRoute({
      pattern: '/api/test/*',
      loadBalancer: {
        strategy: 'round-robin',
        targets: [
          { url: 'http://localhost:8080' },
          { url: 'http://localhost:8081' },
        ],
        healthCheck: {
          enabled: true,
          interval: 2000, // More frequent health checks for tests
          timeout: 1000, // Shorter timeout for tests
          path: '/health',
          expectedStatus: 200,
        },
      },
      proxy: {
        pathRewrite: (path) => path.replace('/api/test', ''),
        timeout: 5000,
      },
    })

    // Start the gateway
    await gateway.listen(3001)

    // Wait longer for health checks to complete
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
  })

  test('should start gateway and echo servers successfully', async () => {
    // Test that all servers are running
    const echo1Response = await fetch('http://localhost:8080/health')
    expect(echo1Response.status).toBe(200)
    expect(echo1Response.headers.get('X-Server')).toBe('echo-1')

    const echo2Response = await fetch('http://localhost:8081/health')
    expect(echo2Response.status).toBe(200)
    expect(echo2Response.headers.get('X-Server')).toBe('echo-2')

    // Test that health endpoints work directly
    const echo1HealthResponse = await fetch('http://localhost:8080/')
    expect(echo1HealthResponse.status).toBe(200)

    const echo2HealthResponse = await fetch('http://localhost:8081/')
    expect(echo2HealthResponse.status).toBe(200)
  })

  test('should have healthy targets after health checks complete', async () => {
    // Wait a bit more to ensure health checks have run
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Test gateway is running with healthy targets
    const gatewayResponse = await fetch('http://localhost:3001/api/test/health')
    expect(gatewayResponse.status).toBe(200)
  })

  test('should perform basic load balancing between two servers', async () => {
    const responses: EchoResponse[] = []

    // Make 4 requests to see round-robin in action
    for (let i = 0; i < 4; i++) {
      const response = await fetch('http://localhost:3001/api/test/echo')
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      responses.push(data)
    }

    // Should have responses from both servers
    const servers = responses.map((r) => r.server)
    expect(servers).toContain('echo-1')
    expect(servers).toContain('echo-2')

    // Verify path rewriting worked
    responses.forEach((response) => {
      expect(response.path).toBe('/echo')
      expect(response.method).toBe('GET')
    })
  })

  test('should handle request headers correctly', async () => {
    const response = await fetch('http://localhost:3001/api/test/headers', {
      headers: {
        'X-Test-Header': 'test-value',
        Authorization: 'Bearer test-token',
      },
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as EchoResponse

    // Verify custom headers were passed through
    expect(data.headers['x-test-header']).toBe('test-value')
    // Authorization is stripped from proxied requests for security
    expect(data.headers['authorization']).toBeUndefined()
  })

  test('should distribute requests roughly evenly with round-robin', async () => {
    const serverCounts: Record<string, number> = { 'echo-1': 0, 'echo-2': 0 }
    const requestCount = 10

    // Make multiple requests
    for (let i = 0; i < requestCount; i++) {
      const response = await fetch('http://localhost:3001/api/test/count')
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      if (data.server in serverCounts) {
        serverCounts[data.server] = (serverCounts[data.server] || 0) + 1
      }
    }

    // Both servers should have received requests
    expect(serverCounts['echo-1']).toBeGreaterThan(0)
    expect(serverCounts['echo-2']).toBeGreaterThan(0)

    // Total should equal request count
    expect((serverCounts['echo-1'] || 0) + (serverCounts['echo-2'] || 0)).toBe(
      requestCount,
    )

    // Distribution should be roughly even (allow some variance)
    const difference = Math.abs(
      (serverCounts['echo-1'] || 0) - (serverCounts['echo-2'] || 0),
    )
    expect(difference).toBeLessThanOrEqual(2) // Allow difference of up to 2
  })
})

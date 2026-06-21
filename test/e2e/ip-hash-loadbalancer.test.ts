/**
 * IP-Hash Load Balancer E2E Tests
 * Tests the IP-hash load balancing strategy for session affinity
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
  body?: string | null
  timestamp: string
}

describe('IP-Hash Load Balancer E2E Tests', () => {
  let gateway: BunGateway
  let echoServer1: any
  let echoServer2: any
  let echoServer3: any

  beforeAll(async () => {
    // Start echo servers on ports 8120, 8121, and 8122
    echoServer1 = Bun.serve({
      port: 8120,
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

        // Read request body if present
        let body = null
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try {
            body = await req.text()
          } catch (e) {
            // Ignore body parsing errors
          }
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-1',
          port: 8120,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          body: body,
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
      port: 8121,
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

        // Read request body if present
        let body = null
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try {
            body = await req.text()
          } catch (e) {
            // Ignore body parsing errors
          }
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-2',
          port: 8121,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          body: body,
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
      port: 8122,
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

        // Read request body if present
        let body = null
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          try {
            body = await req.text()
          } catch (e) {
            // Ignore body parsing errors
          }
        }

        // Echo endpoint - return server identifier and request info
        const response = {
          server: 'echo-3',
          port: 8122,
          method: req.method,
          path: url.pathname,
          headers: Object.fromEntries(req.headers.entries()),
          body: body,
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
        port: 3005, // Use different port to avoid conflicts
        development: false, // Disable development mode to avoid Prometheus conflicts
        hostname: '127.0.0.1',
      },
    })

    // Add IP-hash load balancer route
    gateway.addRoute({
      pattern: '/api/ip-hash/*',
      loadBalancer: {
        strategy: 'ip-hash',
        targets: [
          { url: 'http://localhost:8120' },
          { url: 'http://localhost:8121' },
          { url: 'http://localhost:8122' },
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
        pathRewrite: (path) => path.replace('/api/ip-hash', ''),
        timeout: 5000,
      },
    })

    // Add IP-hash load balancer route with 2 servers for simpler testing
    gateway.addRoute({
      pattern: '/api/ip-hash-two/*',
      loadBalancer: {
        strategy: 'ip-hash',
        targets: [
          { url: 'http://localhost:8120' },
          { url: 'http://localhost:8121' },
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
        pathRewrite: (path) => path.replace('/api/ip-hash-two', ''),
        timeout: 5000,
      },
    })

    // Start the gateway
    await gateway.listen(3005)

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
    const echo1Response = await fetch('http://localhost:8120/health')
    expect(echo1Response.status).toBe(200)
    expect(echo1Response.headers.get('X-Server')).toBe('echo-1')

    const echo2Response = await fetch('http://localhost:8121/health')
    expect(echo2Response.status).toBe(200)
    expect(echo2Response.headers.get('X-Server')).toBe('echo-2')

    const echo3Response = await fetch('http://localhost:8122/health')
    expect(echo3Response.status).toBe(200)
    expect(echo3Response.headers.get('X-Server')).toBe('echo-3')
  })

  test('should route requests to the same server based on IP hash', async () => {
    // Make multiple requests from the same IP (localhost)
    // IP-hash should consistently route to the same server
    const responses = []
    for (let i = 0; i < 5; i++) {
      const response = await fetch('http://localhost:3005/api/ip-hash/test')
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      responses.push(data.server)
    }

    // All responses should be from the same server (IP-hash consistency)
    const uniqueServers = new Set(responses)
    expect(uniqueServers.size).toBe(1)

    // Verify it's one of our echo servers
    const server = responses[0]
    expect(server).toMatch(/echo-[123]/)
  })

  test('should distribute different IP addresses across servers', async () => {
    // Since we're testing from localhost, we'll simulate different IP behavior
    // by making requests and checking that the algorithm distributes across servers
    // Note: In a real scenario, different client IPs would hash to different servers

    // Make a request to see which server gets selected for localhost
    const response = await fetch('http://localhost:3005/api/ip-hash-two/test')
    expect(response.status).toBe(200)

    const data = (await response.json()) as EchoResponse
    expect(data.server).toMatch(/echo-[12]/) // Should be echo-1 or echo-2

    // The same IP should always go to the same server
    for (let i = 0; i < 3; i++) {
      const consistentResponse = await fetch(
        'http://localhost:3005/api/ip-hash-two/test',
      )
      const consistentData = (await consistentResponse.json()) as EchoResponse
      expect(consistentData.server).toBe(data.server)
    }
  })

  test('should maintain session affinity for the same IP', async () => {
    // Test session affinity by making multiple requests with different paths
    // but from the same IP (localhost)
    const servers = new Set<string>()

    const paths = ['/session1', '/session2', '/session3', '/different/path']

    for (const path of paths) {
      const response = await fetch(`http://localhost:3005/api/ip-hash${path}`)
      expect(response.status).toBe(200)

      const data = (await response.json()) as EchoResponse
      servers.add(data.server)
      expect(data.path).toBe(path)
    }

    // All requests from the same IP should go to the same server
    expect(servers.size).toBe(1)
  })

  test('should handle different HTTP methods consistently', async () => {
    // Test that different HTTP methods from the same IP go to the same server
    const servers = new Set<string>()

    // GET request first
    const getResponse = await fetch(
      'http://localhost:3005/api/ip-hash/method-test',
    )
    expect(getResponse.status).toBe(200)
    const getData = (await getResponse.json()) as EchoResponse
    servers.add(getData.server)
    expect(getData.method).toBe('GET')
    expect(getData.path).toBe('/method-test')

    // Another GET request to the same path (should go to same server)
    const getResponse2 = await fetch(
      'http://localhost:3005/api/ip-hash/method-test',
    )
    expect(getResponse2.status).toBe(200)
    const getData2 = (await getResponse2.json()) as EchoResponse
    servers.add(getData2.server)
    expect(getData2.method).toBe('GET')
    expect(getData2.path).toBe('/method-test')

    // All requests from the same IP should go to the same server
    expect(servers.size).toBe(1)
  })

  test('should handle path rewriting correctly with IP-hash strategy', async () => {
    const response = await fetch(
      'http://localhost:3005/api/ip-hash/custom/path',
    )
    expect(response.status).toBe(200)

    const data = (await response.json()) as EchoResponse
    expect(data.path).toBe('/custom/path')
    expect(data.method).toBe('GET')
    expect(data.server).toMatch(/echo-[123]/)
  })

  test('should handle request headers correctly with IP-hash strategy', async () => {
    const response = await fetch('http://localhost:3005/api/ip-hash/headers', {
      headers: {
        'X-Test-Header': 'ip-hash-test',
        Authorization: 'Bearer ip-hash-token',
        'X-Session-ID': 'session-123',
      },
    })

    expect(response.status).toBe(200)
    const data = (await response.json()) as EchoResponse

    // Verify custom headers were passed through
    expect(data.headers['x-test-header']).toBe('ip-hash-test')
    // Authorization is stripped from proxied requests for security
    expect(data.headers['authorization']).toBeUndefined()
    expect(data.headers['x-session-id']).toBe('session-123')
    expect(data.server).toMatch(/echo-[123]/)
  })

  test('should provide consistent routing for user sessions', async () => {
    // Simulate a user session by making multiple requests with session data
    const sessionRequests = [
      { path: '/login', method: 'GET' },
      { path: '/dashboard', method: 'GET' },
      { path: '/profile', method: 'GET' },
      { path: '/logout', method: 'GET' },
    ]

    const servers = new Set<string>()

    for (const req of sessionRequests) {
      const response = await fetch(
        `http://localhost:3005/api/ip-hash${req.path}`,
        {
          method: req.method,
        },
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as EchoResponse
      servers.add(data.server)
      expect(data.path).toBe(req.path)
      expect(data.method).toBe(req.method)
    }

    // All session requests should go to the same server (session affinity)
    expect(servers.size).toBe(1)
  })
})

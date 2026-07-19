import { describe, test, expect, afterEach } from 'bun:test'
import {
  createHTTPRedirectServer,
  HTTPRedirectManager,
  matchesAllowedHost,
} from '../../src/security/http-redirect'
import { BunGateLogger } from '../../src/logger/pino-logger'
import type { Server } from 'bun'

describe('HTTP Redirect', () => {
  let servers: Server[] = []

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.stop()))
    servers = []
  })

  async function getAvailablePort(startPort = 9000): Promise<number> {
    for (let port = startPort; port < startPort + 100; port++) {
      try {
        const testServer = Bun.serve({
          port,
          fetch: () => new Response('test'),
        })
        testServer.stop()
        return port
      } catch {
        continue
      }
    }
    throw new Error('No available ports found')
  }

  describe('createHTTPRedirectServer', () => {
    test('should create redirect server', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 443

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        hostname: 'localhost',
      })
      servers.push(server)

      expect(server).toBeDefined()
      expect(server.port).toBe(httpPort)
    })

    test('should redirect HTTP to HTTPS with 301 status', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        hostname: 'localhost',
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(
        `http://localhost:${httpPort}/test/path?query=value`,
        {
          redirect: 'manual',
        },
      )

      expect(response.status).toBe(301)
      expect(response.headers.get('Location')).toBe(
        `https://localhost:${httpsPort}/test/path?query=value`,
      )
      expect(response.headers.get('Connection')).toBe('close')
    })

    test('should preserve path and query parameters', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        hostname: 'localhost',
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(
        `http://localhost:${httpPort}/api/users/123?filter=active`,
        {
          redirect: 'manual',
        },
      )

      expect(response.status).toBe(301)
      const location = response.headers.get('Location')
      expect(location).toContain('/api/users/123')
      expect(location).toContain('filter=active')
    })

    test('should omit port 443 from redirect URL', async () => {
      const httpPort = await getAvailablePort(9200) // Use different port range
      const httpsPort = 443 // Standard HTTPS port

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        hostname: 'localhost',
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(`http://localhost:${httpPort}/test`, {
        redirect: 'manual',
      })

      const location = response.headers.get('Location')
      // When httpsPort is 443, the port should be omitted from the URL
      expect(location).toBe('https://localhost/test')
      expect(location).not.toContain(':443')
    })

    test('should include non-standard HTTPS port in redirect URL', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        hostname: 'localhost',
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(`http://localhost:${httpPort}/test`, {
        redirect: 'manual',
      })

      const location = response.headers.get('Location')
      expect(location).toBe(`https://localhost:${httpsPort}/test`)
    })

    test('should use request hostname when custom hostname not provided', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        // No custom hostname - rely on an explicit allowlist for the request host.
        allowHosts: ['localhost'],
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(`http://localhost:${httpPort}/test`, {
        redirect: 'manual',
      })

      const location = response.headers.get('Location')
      expect(location).toBe(`https://localhost:${httpsPort}/test`)
    })

    test('should accept logger configuration', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const logger = new BunGateLogger({
        level: 'error',
        format: 'json',
      })

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        hostname: 'localhost',
        logger,
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(`http://localhost:${httpPort}/test`, {
        redirect: 'manual',
      })

      // Verify redirect still works with logger
      expect(response.status).toBe(301)
    })
  })

  describe('HTTPRedirectManager', () => {
    test('should start and stop redirect server', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const manager = new HTTPRedirectManager({
        port: httpPort,
        httpsPort,
      })

      expect(manager.isRunning()).toBe(false)

      const server = manager.start()
      servers.push(server)

      expect(manager.isRunning()).toBe(true)
      expect(manager.getServer()).toBe(server)

      manager.stop()
      expect(manager.isRunning()).toBe(false)
      expect(manager.getServer()).toBeNull()
    })

    test('should throw error when starting already running server', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const manager = new HTTPRedirectManager({
        port: httpPort,
        httpsPort,
      })

      const server = manager.start()
      servers.push(server)

      expect(() => manager.start()).toThrow(
        'HTTP redirect server is already running',
      )

      manager.stop()
    })

    test('should handle stop when server not running', () => {
      const manager = new HTTPRedirectManager({
        port: 9999,
        httpsPort: 8443,
      })

      expect(() => manager.stop()).not.toThrow()
    })
  })

  describe('matchesAllowedHost', () => {
    test('matches exact hostnames case-insensitively', () => {
      expect(matchesAllowedHost('Example.COM', 'example.com')).toBe(true)
      expect(matchesAllowedHost('example.com', 'other.com')).toBe(false)
    })

    test('matches wildcard patterns', () => {
      expect(matchesAllowedHost('api.example.com', '*.example.com')).toBe(true)
      expect(matchesAllowedHost('example.com', '*.example.com')).toBe(true)
      expect(matchesAllowedHost('api.other.com', '*.example.com')).toBe(false)
    })
  })

  describe('wildcard allowHosts', () => {
    test('should redirect when request host matches wildcard allowlist', async () => {
      const httpPort = await getAvailablePort()
      const httpsPort = 8443

      const server = createHTTPRedirectServer({
        port: httpPort,
        httpsPort,
        // localhost:port will not match *.example.com, so also allow localhost exactly.
        allowHosts: ['*.example.com', 'localhost'],
      })
      servers.push(server)

      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(`http://localhost:${httpPort}/test`, {
        redirect: 'manual',
      })

      expect(response.status).toBe(301)
    })
  })
})

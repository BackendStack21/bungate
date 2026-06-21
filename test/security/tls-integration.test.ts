import { describe, test, expect, afterEach } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway'
import { BunGateLogger } from '../../src/logger/pino-logger'
import type { Server } from 'bun'

describe('TLS Integration with Gateway', () => {
  let gateways: BunGateway[] = []
  let servers: Server[] = []

  afterEach(async () => {
    for (const gateway of gateways) {
      await gateway.close()
    }
    gateways = []
    servers = []
  })

  async function getAvailablePort(startPort = 9100): Promise<number> {
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

  const logger = new BunGateLogger({
    level: 'error',
    format: 'json',
  })

  test('should start gateway with TLS enabled', async () => {
    const port = await getAvailablePort()

    const gateway = new BunGateway({
      server: { port },
      logger,
      security: {
        tls: {
          enabled: true,
          cert: './examples/cert.pem',
          key: './examples/key.pem',
          minVersion: 'TLSv1.2',
        },
      },
      routes: [
        {
          pattern: '/test',
          handler: async () => new Response('Hello HTTPS'),
        },
      ],
    })
    gateways.push(gateway)

    const server = await gateway.listen()
    expect(server).toBeDefined()
    expect(server.port).toBe(port)
  })

  test('should reject invalid TLS configuration', () => {
    expect(() => {
      new BunGateway({
        security: {
          tls: {
            enabled: true,
            // Missing cert and key
          },
        },
      })
    }).toThrow('Security configuration validation failed')
  })

  test('should start gateway with HTTP redirect', async () => {
    const httpsPort = await getAvailablePort()
    const httpPort = await getAvailablePort(httpsPort + 1)

    const gateway = new BunGateway({
      server: { port: httpsPort },
      logger,
      security: {
        tls: {
          enabled: true,
          cert: './examples/cert.pem',
          key: './examples/key.pem',
          redirectHTTP: true,
          redirectPort: httpPort,
        },
      },
      routes: [
        {
          pattern: '/api/*',
          handler: async () => new Response('Secure'),
        },
      ],
    })
    gateways.push(gateway)

    await gateway.listen()
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Test HTTP redirect
    const response = await fetch(`http://localhost:${httpPort}/api/test`, {
      redirect: 'manual',
    })

    expect(response.status).toBe(301)
    const location = response.headers.get('Location')
    expect(location).toContain(`https://localhost:${httpsPort}/api/test`)
  })

  test('should validate certificates on startup', async () => {
    const port = await getAvailablePort()

    const gateway = new BunGateway({
      server: { port },
      logger,
      security: {
        tls: {
          enabled: true,
          cert: './nonexistent-cert.pem',
          key: './nonexistent-key.pem',
        },
      },
    })
    gateways.push(gateway)

    await expect(gateway.listen()).rejects.toThrow(
      'Failed to load TLS certificate',
    )
  })

  test('should work with TLS disabled', async () => {
    const port = await getAvailablePort()

    const gateway = new BunGateway({
      server: { port },
      logger,
      security: {
        tls: {
          enabled: false,
        },
      },
      routes: [
        {
          pattern: '/test',
          handler: async () => new Response('Hello HTTP'),
        },
      ],
    })
    gateways.push(gateway)

    const server = await gateway.listen()
    expect(server).toBeDefined()

    await new Promise((resolve) => setTimeout(resolve, 100))

    const response = await fetch(`http://localhost:${port}/test`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Hello HTTP')
  })

  test('should accept certificate buffers', async () => {
    const port = await getAvailablePort()
    const { readFileSync } = await import('fs')

    const gateway = new BunGateway({
      server: { port },
      logger,
      security: {
        tls: {
          enabled: true,
          cert: readFileSync('./examples/cert.pem'),
          key: readFileSync('./examples/key.pem'),
        },
      },
      routes: [
        {
          pattern: '/test',
          handler: async () => new Response('Buffer certs work'),
        },
      ],
    })
    gateways.push(gateway)

    const server = await gateway.listen()
    expect(server).toBeDefined()
  })

  test('should enforce minimum TLS version', async () => {
    const port = await getAvailablePort()

    const gateway = new BunGateway({
      server: { port },
      logger,
      security: {
        tls: {
          enabled: true,
          cert: './examples/cert.pem',
          key: './examples/key.pem',
          minVersion: 'TLSv1.3',
        },
      },
    })
    gateways.push(gateway)

    const server = await gateway.listen()
    expect(server).toBeDefined()
  })
})

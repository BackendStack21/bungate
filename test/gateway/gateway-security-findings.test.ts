import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway'
import type { ZeroRequest } from '../../src/interfaces/middleware'

describe('BunGateway security findings', () => {
  let gateway: BunGateway
  let upstream: ReturnType<typeof Bun.serve>
  let upstreamUrl: string
  let gatewayServer: ReturnType<typeof Bun.serve>
  let gatewayUrl: string

  beforeAll(async () => {
    upstream = Bun.serve({
      port: 0,
      fetch: (req) => {
        const url = new URL(req.url)
        if (url.pathname === '/echo-host') {
          return Response.json({ host: req.headers.get('host') })
        }
        if (url.pathname === '/redirect') {
          return new Response(null, {
            status: 302,
            headers: { location: 'http://127.0.0.1:1/internal' },
          })
        }
        return new Response('OK')
      },
    })
    upstreamUrl = `http://localhost:${upstream.port}`

    gateway = new BunGateway({
      logger: undefined,
      routes: [
        {
          pattern: '/proxy/*',
          target: upstreamUrl,
          proxy: {
            pathRewrite: {
              '^/proxy': '',
            },
          },
        },
        {
          pattern: '/proxy-redirect/*',
          target: upstreamUrl,
          proxy: {
            followRedirects: true,
            pathRewrite: {
              '^/proxy-redirect': '',
            },
          },
        },
        {
          pattern: '/error',
          handler: async () => {
            throw new Error('POC-SECRET-MARKER')
          },
        },
      ],
    })

    gatewayServer = await gateway.listen(0)
    gatewayUrl = `http://localhost:${gatewayServer.port}`
  })

  afterAll(async () => {
    await gateway.close()
    upstream.stop()
  })

  test('simple proxy sends upstream host, not localhost (V-11)', async () => {
    const response = await fetch(`${gatewayUrl}/proxy/echo-host`)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.host).toBe(`localhost:${upstream.port}`)
  })

  test('does not follow upstream redirects by default (V-1)', async () => {
    const response = await fetch(`${gatewayUrl}/proxy/redirect`, {
      redirect: 'manual',
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://127.0.0.1:1/internal')
  })

  test('async handler errors are sanitized (V-9)', async () => {
    const response = await fetch(`${gatewayUrl}/error`)
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).not.toContain('POC-SECRET-MARKER')
    expect(text).toContain('Internal server error')
  })
})

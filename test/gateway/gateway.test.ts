import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway.ts'
import type { GatewayConfig } from '../../src/interfaces/gateway.ts'
import type {
  ZeroRequest,
  StepFunction,
} from '../../src/interfaces/middleware.ts'

// Extended RouteConfig for testing (includes handler)
interface TestRouteConfig {
  pattern: string
  methods?: string[]
  middlewares?: any[]
  handler: (req: ZeroRequest) => Response | Promise<Response>
}

describe('BunGateway', () => {
  let gateway: BunGateway

  beforeEach(() => {
    gateway = new BunGateway()
  })

  afterEach(async () => {
    if (gateway) {
      await gateway.close()
    }
  })

  test('should create gateway with default config', () => {
    expect(gateway).toBeDefined()
    expect(gateway.getConfig()).toEqual({})
  })

  test('should create gateway with custom config', () => {
    const config: GatewayConfig = {
      server: { port: 4000 },
      defaultRoute: (req: ZeroRequest) =>
        new Response('Not found', { status: 404 }),
    }

    const customGateway = new BunGateway(config)
    expect(customGateway.getConfig()).toEqual(config)
  })

  test('should register GET route', async () => {
    gateway.get('/test', (req: ZeroRequest) => {
      return new Response('Hello from GET')
    })

    const request = new Request('http://localhost/test', { method: 'GET' })
    const response = await gateway.fetch(request)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Hello from GET')
  })

  test('should register POST route', async () => {
    gateway.post('/test', (req: ZeroRequest) => {
      return new Response('Hello from POST')
    })

    const request = new Request('http://localhost/test', { method: 'POST' })
    const response = await gateway.fetch(request)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Hello from POST')
  })

  test('should register route with parameters', async () => {
    gateway.get('/users/:id', (req: ZeroRequest) => {
      return Response.json({ id: req.params.id })
    })

    const request = new Request('http://localhost/users/123', { method: 'GET' })
    const response = await gateway.fetch(request)

    expect(response.status).toBe(200)
    const data = (await response.json()) as { id: string }
    expect(data.id).toBe('123')
  })

  test('should use middleware', async () => {
    let middlewareCalled = false

    gateway.use((req: ZeroRequest, next: StepFunction) => {
      middlewareCalled = true
      req.ctx = { ...req.ctx, middleware: true }
      return next()
    })

    gateway.get('/test', (req: ZeroRequest) => {
      return Response.json({ middleware: req.ctx?.middleware })
    })

    const request = new Request('http://localhost/test', { method: 'GET' })
    const response = await gateway.fetch(request)

    expect(middlewareCalled).toBe(true)
    expect(response.status).toBe(200)
    const data = (await response.json()) as { middleware: boolean }
    expect(data.middleware).toBe(true)
  })

  test('should add route via addRoute method', async () => {
    const testRoute = {
      pattern: '/api/test',
      methods: ['GET', 'POST'],
      handler: (req: ZeroRequest) => {
        return Response.json({ method: req.method })
      },
    } as TestRouteConfig

    gateway.addRoute(testRoute as any)

    // Test GET
    let request = new Request('http://localhost/api/test', { method: 'GET' })
    let response = await gateway.fetch(request)
    expect(response.status).toBe(200)
    let data = (await response.json()) as { method: string }
    expect(data.method).toBe('GET')

    // Test POST
    request = new Request('http://localhost/api/test', { method: 'POST' })
    response = await gateway.fetch(request)
    expect(response.status).toBe(200)
    data = (await response.json()) as { method: string }
    expect(data.method).toBe('POST')
  })

  test('should handle all HTTP methods with all() method', async () => {
    gateway.all('/all-methods', (req: ZeroRequest) => {
      return Response.json({ method: req.method })
    })

    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    for (const method of methods) {
      const request = new Request('http://localhost/all-methods', { method })
      const response = await gateway.fetch(request)

      if (method === 'HEAD') {
        expect(response.status).toBe(200)
        // HEAD requests don't have a body
      } else {
        expect(response.status).toBe(200)
        const data = (await response.json()) as { method: string }
        expect(data.method).toBe(method)
      }
    }
  })

  test('should start and stop server', async () => {
    gateway.get('/', () => new Response('Server running'))

    const server = await gateway.listen(0) // Use port 0 for automatic assignment
    expect(server).toBeDefined()
    expect(server.port).toBeGreaterThan(0)

    await gateway.close()
  })

  test('should handle route with middlewares', async () => {
    const middleware1 = (req: ZeroRequest, next: StepFunction) => {
      req.ctx = { ...req.ctx, step: 1 }
      return next()
    }

    const middleware2 = (req: ZeroRequest, next: StepFunction) => {
      req.ctx = { ...req.ctx, step: 2 }
      return next()
    }

    const testRoute = {
      pattern: '/middleware-test',
      middlewares: [middleware1, middleware2],
      handler: (req: ZeroRequest) => {
        return Response.json({ step: req.ctx?.step })
      },
    } as TestRouteConfig

    gateway.addRoute(testRoute as any)

    const request = new Request('http://localhost/middleware-test', {
      method: 'GET',
    })
    const response = await gateway.fetch(request)

    expect(response.status).toBe(200)
    const data = (await response.json()) as { step: number }
    expect(data.step).toBe(2)
  })

  test('should throw error for removeRoute (not implemented)', () => {
    expect(() => {
      gateway.removeRoute('/test')
    }).toThrow('removeRoute is not implemented')
  })
})

describe('BunGateway HTTP method helpers', () => {
  let gateway: BunGateway
  beforeEach(() => {
    gateway = new BunGateway()
  })

  test('should register PUT route', async () => {
    gateway.put('/put', async () => new Response('put-ok'))
    const res = await gateway.fetch(
      new Request('http://localhost/put', { method: 'PUT' }),
    )
    expect(await res.text()).toBe('put-ok')
  })

  test('should register PATCH route', async () => {
    gateway.patch('/patch', async () => new Response('patch-ok'))
    const res = await gateway.fetch(
      new Request('http://localhost/patch', { method: 'PATCH' }),
    )
    expect(await res.text()).toBe('patch-ok')
  })

  test('should register DELETE route', async () => {
    gateway.delete('/delete', async () => new Response('delete-ok'))
    const res = await gateway.fetch(
      new Request('http://localhost/delete', { method: 'DELETE' }),
    )
    expect(await res.text()).toBe('delete-ok')
  })

  test('should register HEAD route', async () => {
    gateway.head('/head', async () => new Response(null, { status: 204 }))
    const res = await gateway.fetch(
      new Request('http://localhost/head', { method: 'HEAD' }),
    )
    expect(res.status).toBe(204)
  })
})

import { describe, test, expect } from 'bun:test'
import { BunGateway } from '../../src/gateway/gateway.ts'
import type { ZeroRequest } from '../../src/interfaces/middleware.ts'

describe('BunGateway Error Handling', () => {
  test('should use custom error handler', async () => {
    let errorHandlerCalled = false
    let capturedError: Error | null = null

    const gateway = new BunGateway({
      errorHandler: (err: Error) => {
        errorHandlerCalled = true
        capturedError = err
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })

    // Add a route that throws an error
    gateway.get('/error', (req: ZeroRequest) => {
      throw new Error('Test error')
    })

    const request = new Request('http://localhost/error', { method: 'GET' })
    const response = await gateway.fetch(request)

    expect(response.status).toBe(500)
    expect(errorHandlerCalled).toBe(true)
    expect(capturedError).toBeDefined()
    expect(capturedError!.message).toBe('Test error')

    const data = (await response.json()) as { error: string }
    expect(data.error).toBe('Test error')
  })

  test('should use custom default route handler', async () => {
    const gateway = new BunGateway({
      defaultRoute: (req: ZeroRequest) => {
        return new Response(
          JSON.stringify({
            message: 'Custom 404',
            path: new URL(req.url).pathname,
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      },
    })

    const request = new Request('http://localhost/non-existent', {
      method: 'GET',
    })
    const response = await gateway.fetch(request)

    expect(response.status).toBe(404)

    const data = (await response.json()) as { message: string; path: string }
    expect(data.message).toBe('Custom 404')
    expect(data.path).toBe('/non-existent')
  })
})

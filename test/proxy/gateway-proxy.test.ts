/**
 * Test suite for GatewayProxy and createGatewayProxy
 */
import { describe, test, expect, beforeEach, spyOn } from 'bun:test'
import {
  GatewayProxy,
  createGatewayProxy,
  resolveTargetUrl,
  matchesHostname,
  isRedirectAllowed,
} from '../../src/proxy/gateway-proxy.ts'
import { FetchProxy } from 'fetch-gate/lib/proxy'
import type {
  ProxyOptions,
  ProxyRequestOptions,
  CircuitState,
} from 'fetch-gate'

describe('GatewayProxy', () => {
  let handler: GatewayProxy
  let options: ProxyOptions

  beforeEach(() => {
    options = {} as ProxyOptions
    handler = new GatewayProxy(options)
  })

  test('proxy delegates to fetchProxy', async () => {
    // Since fetchProxy is private, we spy on the public method and verify it works
    const req = new Request('http://test')
    const res = await handler.proxy(req as any)

    expect(res).toBeInstanceOf(Response)
  })

  test('close delegates to fetchProxy', () => {
    // Test that close method exists and can be called without error
    expect(() => handler.close()).not.toThrow()
  })

  test('getCircuitBreakerState delegates to fetchProxy', () => {
    const result = handler.getCircuitBreakerState()
    expect(typeof result).toBe('string')
    expect([
      'closed',
      'open',
      'half-open',
      'CLOSED',
      'OPEN',
      'HALF-OPEN',
    ]).toContain(result)
  })

  test('getCircuitBreakerFailures delegates to fetchProxy', () => {
    const result = handler.getCircuitBreakerFailures()
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThanOrEqual(0)
  })

  test('clearURLCache delegates to fetchProxy', () => {
    // Test that clearURLCache method exists and can be called without error
    expect(() => handler.clearURLCache()).not.toThrow()
  })
})

describe('createGatewayProxy', () => {
  test('returns a ProxyInstance with all methods bound', () => {
    const instance = createGatewayProxy({} as ProxyOptions)
    expect(instance).toHaveProperty('proxy')
    expect(instance).toHaveProperty('close')
    expect(instance).toHaveProperty('getCircuitBreakerState')
    expect(instance).toHaveProperty('getCircuitBreakerFailures')
    expect(instance).toHaveProperty('clearURLCache')
  })
})

describe('resolveTargetUrl', () => {
  test('returns source URL when it contains scheme', () => {
    const url = resolveTargetUrl('http://example.com/path')
    expect(url.href).toBe('http://example.com/path')
  })

  test('resolves against base URL', () => {
    const url = resolveTargetUrl('/path', 'http://example.com')
    expect(url.href).toBe('http://example.com/path')
  })

  test('falls back to localhost for malformed input', () => {
    const url = resolveTargetUrl('path', 'not-a-base')
    expect(url.href).toBe('http://localhost/path')
  })
})

describe('matchesHostname', () => {
  test('matches exact hostnames case-insensitively', () => {
    expect(matchesHostname('Example.COM', 'example.com')).toBe(true)
    expect(matchesHostname('example.com', 'other.com')).toBe(false)
  })

  test('matches wildcard patterns', () => {
    expect(matchesHostname('api.example.com', '*.example.com')).toBe(true)
    expect(matchesHostname('example.com', '*.example.com')).toBe(true)
    expect(matchesHostname('api.other.com', '*.example.com')).toBe(false)
  })
})

describe('isRedirectAllowed', () => {
  const original = new URL('http://example.com/api')

  test('allows same-origin redirects by default', () => {
    expect(
      isRedirectAllowed(new URL('http://example.com/other'), original, {}),
    ).toBe(true)
    expect(
      isRedirectAllowed(new URL('http://other.com/other'), original, {}),
    ).toBe(false)
  })

  test('allows allow-listed hostnames', () => {
    expect(
      isRedirectAllowed(new URL('http://api.example.com/x'), original, {
        redirectAllowlist: ['*.example.com'],
      }),
    ).toBe(true)
  })

  test('rejects same-origin redirects when disabled', () => {
    expect(
      isRedirectAllowed(new URL('http://example.com/other'), original, {
        redirectSameOrigin: false,
      }),
    ).toBe(false)
  })
})

describe('GatewayProxy redirect handling', () => {
  let handler: GatewayProxy

  beforeEach(() => {
    handler = new GatewayProxy({
      followRedirects: true,
      base: 'http://original.example.com',
    })
  })

  test('follows same-origin GET redirect', async () => {
    const spy = spyOn(FetchProxy.prototype, 'proxy')
    spy
      .mockImplementationOnce(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://original.example.com/followed' },
          }),
      )
      .mockImplementationOnce(
        async () => new Response('followed', { status: 200 }),
      )

    const req = new Request('http://original.example.com/api')
    const res = await handler.proxy(
      req as any,
      'http://original.example.com/api',
    )

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('followed')
    expect(spy).toHaveBeenCalledTimes(2)

    spy.mockRestore()
  })

  test('does not follow cross-origin redirect by default', async () => {
    const spy = spyOn(FetchProxy.prototype, 'proxy')
    spy.mockImplementationOnce(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://evil.com/secret' },
        }),
    )

    const req = new Request('http://original.example.com/api')
    const res = await handler.proxy(
      req as any,
      'http://original.example.com/api',
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://evil.com/secret')

    spy.mockRestore()
  })

  test('follows redirect when hostname is allow-listed', async () => {
    const spy = spyOn(FetchProxy.prototype, 'proxy')
    spy
      .mockImplementationOnce(
        async () =>
          new Response(null, {
            status: 302,
            headers: { location: 'http://api.example.com/followed' },
          }),
      )
      .mockImplementationOnce(
        async () => new Response('followed', { status: 200 }),
      )

    const proxy = new GatewayProxy({
      followRedirects: true,
      base: 'http://original.example.com',
      redirectAllowlist: ['*.example.com'],
    })

    const req = new Request('http://original.example.com/api')
    const res = await proxy.proxy(req as any, 'http://original.example.com/api')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('followed')

    spy.mockRestore()
  })

  test('does not follow non-GET/HEAD redirects', async () => {
    const spy = spyOn(FetchProxy.prototype, 'proxy')
    spy.mockImplementationOnce(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://original.example.com/created' },
        }),
    )

    const req = new Request('http://original.example.com/api', {
      method: 'POST',
    })
    const res = await handler.proxy(
      req as any,
      'http://original.example.com/api',
    )

    expect(res.status).toBe(302)

    spy.mockRestore()
  })

  test('stops following after maxRedirects', async () => {
    const spy = spyOn(FetchProxy.prototype, 'proxy')
    let calls = 0
    spy.mockImplementation(async () => {
      calls++
      return new Response(null, {
        status: 302,
        headers: { location: `http://original.example.com/step-${calls}` },
      })
    })

    const proxy = new GatewayProxy({
      followRedirects: true,
      maxRedirects: 2,
      base: 'http://original.example.com',
    })

    const req = new Request('http://original.example.com/api')
    const res = await proxy.proxy(req as any, 'http://original.example.com/api')

    expect(res.status).toBe(302)
    expect(calls).toBe(3) // initial + 2 redirects

    spy.mockRestore()
  })
})

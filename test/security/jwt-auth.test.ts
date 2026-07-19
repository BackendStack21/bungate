import { describe, test, expect } from 'bun:test'
import {
  SignJWT,
  importSPKI,
  exportSPKI,
  exportPKCS8,
  exportJWK,
  generateKeyPair,
  CompactSign,
} from 'jose'
import { createJWTAuth } from '../../src/security/jwt-auth'
import type { ZeroRequest } from '../../src/interfaces/middleware'

function zeroRequest(
  url: string,
  headers?: Record<string, string>,
): ZeroRequest {
  const req = new Request(url, { headers }) as ZeroRequest
  req.ctx = {}
  return req
}

describe('createJWTAuth hardened middleware', () => {
  test('rejects a token without an exp claim', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret })

    const token = await new SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(secret))

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toMatch(/expired|exp/i)
  })

  test('accepts a token with an exp claim', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret })

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('rejects HS256 token signed with a PEM public key (algorithm confusion)', async () => {
    const { publicKey } = await generateKeyPair('RS256')
    const publicKeyPEM = await exportSPKI(publicKey)

    // Attacker forges an HS256 token using the public key string as secret.
    const forgedToken = await new SignJWT({ sub: 'attacker', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(publicKeyPEM))

    // Operator misconfigures the public key PEM as the HMAC secret.
    const middleware = createJWTAuth({ secret: publicKeyPEM })

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${forgedToken}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('verifies an RS256 token with the matching public key', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const publicKeyPEM = await exportSPKI(publicKey)

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const middleware = createJWTAuth({ secret: publicKeyPEM })

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('rejects a short HMAC secret', () => {
    expect(() => createJWTAuth({ secret: 'short' })).toThrow(
      /secret too short/i,
    )
  })

  test('rejects API key when apiKeys is neither array nor function', async () => {
    const middleware = createJWTAuth({ apiKeys: 'not-a-valid-config' as any })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'key1',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('enforces audience claim when configured', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret, audience: 'expected-audience' })

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .setAudience('wrong-audience')
      .sign(new TextEncoder().encode(secret))

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('uses boundary-aware excludePaths matching', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({
      secret,
      excludePaths: ['/api/public'],
    })

    const publicReq = zeroRequest('http://localhost/api/public')
    const publicResponse = await middleware(publicReq, () => new Response('OK'))
    expect(publicResponse.status).toBe(200)

    const siblingReq = zeroRequest('http://localhost/api/publicity/admin')
    const siblingResponse = await middleware(
      siblingReq,
      () => new Response('OK'),
    )
    expect(siblingResponse.status).toBe(401)
  })

  test('rejects algorithm "none"', () => {
    expect(() =>
      createJWTAuth({ secret: 'x'.repeat(32), algorithms: ['none'] }),
    ).toThrow(/none.*not allowed/i)
  })

  test('throws when no auth mechanism is configured', () => {
    expect(() => createJWTAuth({})).toThrow(
      /requires either secret, jwksUri, jwks, or apiKeys/i,
    )
  })

  test('rejects a token with invalid issuer', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret, issuer: 'expected-issuer' })

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .setIssuer('wrong-issuer')
      .sign(new TextEncoder().encode(secret))

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toMatch(/issuer/i)
  })

  test('verifies a token using a custom token extractor', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({
      secret,
      getToken: (req) => req.headers.get('x-custom-token') || undefined,
    })

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    const req = zeroRequest('http://localhost/api/test', {
      'x-custom-token': token,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('extracts token from custom header and query parameter', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    const headerMiddleware = createJWTAuth({
      secret,
      tokenHeader: 'x-api-token',
    })
    const headerReq = zeroRequest('http://localhost/api/test', {
      'x-api-token': token,
    })
    expect(
      (await headerMiddleware(headerReq, () => new Response('OK'))).status,
    ).toBe(200)

    const queryMiddleware = createJWTAuth({
      secret,
      tokenQuery: 'token',
    })
    const queryReq = zeroRequest(
      `http://localhost/api/test?token=${encodeURIComponent(token)}`,
    )
    expect(
      (await queryMiddleware(queryReq, () => new Response('OK'))).status,
    ).toBe(200)
  })

  test('rejects malformed authorization header', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret })

    const req1 = zeroRequest('http://localhost/api/test', {
      authorization: 'token',
    })
    expect((await middleware(req1, () => new Response('OK'))).status).toBe(401)

    const req2 = zeroRequest('http://localhost/api/test', {
      authorization: 'Basic dXNlcjpwYXNz',
    })
    expect((await middleware(req2, () => new Response('OK'))).status).toBe(401)
  })

  test('validates API keys from array, function, and validator', async () => {
    const middlewareArray = createJWTAuth({ apiKeys: ['key1', 'key2'] })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'key1',
    })
    expect((await middlewareArray(req, () => new Response('OK'))).status).toBe(
      200,
    )

    const middlewareFn = createJWTAuth({
      apiKeys: async (key) => key === 'key1',
    })
    expect((await middlewareFn(req, () => new Response('OK'))).status).toBe(200)

    const middlewareValidator = createJWTAuth({
      apiKeyValidator: (key) => key === 'key1',
    })
    expect(
      (await middlewareValidator(req, () => new Response('OK'))).status,
    ).toBe(200)

    const invalidReq = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'wrong',
    })
    expect(
      (await middlewareArray(invalidReq, () => new Response('OK'))).status,
    ).toBe(401)

    // apiKeys configured but request has no API key header at all
    const missingKeyReq = zeroRequest('http://localhost/api/test')
    expect(
      (await middlewareArray(missingKeyReq, () => new Response('OK'))).status,
    ).toBe(401)
  })

  test('calls one-arg apiKeyValidator when length is 1', async () => {
    const middleware = createJWTAuth({
      apiKeyValidator: (key: string) => key === 'key1',
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'key1',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('calls two-arg apiKeyValidator when length is 2', async () => {
    const middleware = createJWTAuth({
      apiKeyValidator: (key: string, req: ZeroRequest) =>
        key === 'key1' && new URL(req.url).pathname === '/api/test',
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'key1',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('returns custom unauthorized response', async () => {
    const middleware = createJWTAuth({
      apiKeys: ['key1'],
      unauthorizedResponse: new Response('custom', { status: 403 }),
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'wrong',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('custom')
  })

  test('uses custom unauthorized response function returning object', async () => {
    const middleware = createJWTAuth({
      apiKeys: ['key1'],
      unauthorizedResponse: (error) => ({
        body: { message: error.message },
        status: 418,
        headers: { 'x-custom': 'yes' },
      }),
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'wrong',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(418)
    expect(response.headers.get('x-custom')).toBe('yes')
    expect(await response.json()).toEqual({ message: 'Invalid API key' })
  })

  test('custom unauthorized response object serializes non-string body', async () => {
    const middleware = createJWTAuth({
      apiKeys: ['key1'],
      unauthorizedResponse: () => ({
        body: { detail: 'nope' },
        status: 403,
      }),
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'wrong',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ detail: 'nope' })
  })

  test('falls back to default response when unauthorizedResponse returns primitive', async () => {
    const middleware = createJWTAuth({
      apiKeys: ['key1'],
      unauthorizedResponse: () => 'just-a-string' as any,
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'wrong',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('falls back to default response when unauthorizedResponse throws', async () => {
    const middleware = createJWTAuth({
      apiKeys: ['key1'],
      unauthorizedResponse: () => {
        throw new Error('boom')
      },
    })
    const req = zeroRequest('http://localhost/api/test', {
      'x-api-key': 'wrong',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('invokes onError handler and returns its response', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({
      secret,
      onError: (error) =>
        new Response(JSON.stringify({ handled: error.message }), {
          status: 400,
        }),
    })

    // Trigger the catch path with a token signed by the wrong secret.
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('wrong-secret-is-at-least-32-bytes!'))

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      handled: 'signature verification failed',
    })
  })

  test('optional auth allows missing token', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret, optional: true })
    const req = zeroRequest('http://localhost/api/test')
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('optional auth still allows valid token', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret, optional: true })

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('optional auth passes through when API key is missing and token invalid', async () => {
    const middleware = createJWTAuth({
      apiKeys: ['key1'],
      optional: true,
    })
    const req = zeroRequest('http://localhost/api/test')
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('optional auth passes through in catch block with invalid token', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const middleware = createJWTAuth({ secret, optional: true })

    const req = zeroRequest('http://localhost/api/test', {
      authorization: 'Bearer not-a-valid-jwt',
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('supports inline JWKS resolver', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const spki = await exportSPKI(publicKey)
    const imported = await importSPKI(spki, 'RS256')

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const middleware = createJWTAuth({
      jwks: { getKey: async () => imported },
    })
    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('supports jwks provided as a raw key resolver function', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const spki = await exportSPKI(publicKey)
    const imported = await importSPKI(spki, 'RS256')

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const middleware = createJWTAuth({
      jwks: async () => imported as any,
    })
    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('supports jwksUri remote JWK set', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    jwk.kid = 'key-1'
    jwk.use = 'sig'

    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const server = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'content-type': 'application/json' },
        }),
    })

    try {
      const middleware = createJWTAuth({
        jwksUri: `http://localhost:${server.port}/.well-known/jwks.json`,
      })
      const req = zeroRequest('http://localhost/api/test', {
        authorization: `Bearer ${token}`,
      })
      const response = await middleware(req, () => new Response('OK'))
      expect(response.status).toBe(200)
    } finally {
      server.stop()
    }
  })

  test('supports secret resolver function', async () => {
    const secret = 'this-secret-is-at-least-32-bytes-long!'
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(secret))

    const middleware = createJWTAuth({
      secret: async () => new TextEncoder().encode(secret),
    })
    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(200)
  })

  test('rejects HS256 token signed with a PEM private key (algorithm confusion)', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const privateKeyPEM = await exportPKCS8(privateKey)

    // Attacker forges an HS256 token using the private key PEM string as secret.
    const forgedToken = await new SignJWT({ sub: 'attacker', role: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(privateKeyPEM))

    // Operator misconfigures the private key PEM as the HMAC secret.
    const middleware = createJWTAuth({ secret: privateKeyPEM })

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${forgedToken}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('rejects EC public key used as HMAC secret', async () => {
    const { publicKey } = await generateKeyPair('ES256')
    const publicKeyPEM = await exportSPKI(publicKey)

    const forgedToken = await new SignJWT({ sub: 'attacker' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(publicKeyPEM))

    const middleware = createJWTAuth({ secret: publicKeyPEM })
    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${forgedToken}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })

  test('maps JWTInvalid error to friendly message', async () => {
    const secret = new TextEncoder().encode(
      'this-secret-is-at-least-32-bytes-long!',
    )
    const middleware = createJWTAuth({ secret: secret })

    // Sign a non-JSON payload; jwtVerify will throw JWTInvalid after signature check.
    const jws = await new CompactSign(new TextEncoder().encode('not-json'))
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secret)

    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${jws}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toMatch(/invalid token format/i)
  })

  test('maps JWKSNoMatchingKey error to friendly message', async () => {
    const { privateKey } = await generateKeyPair('RS256')
    const token = await new SignJWT({ sub: 'user' })
      .setProtectedHeader({ alg: 'RS256' })
      .setExpirationTime('1h')
      .sign(privateKey)

    const middleware = createJWTAuth({
      jwks: { getKey: async () => null as any },
    })
    const req = zeroRequest('http://localhost/api/test', {
      authorization: `Bearer ${token}`,
    })
    const response = await middleware(req, () => new Response('OK'))
    expect(response.status).toBe(401)
  })
})

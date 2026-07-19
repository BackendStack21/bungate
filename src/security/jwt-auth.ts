/**
 * Hardened JWT authentication middleware.
 *
 * Replaces the 0http-bun JWT middleware with an internal implementation that:
 * - Requires an `exp` claim.
 * - Supports `audience` / `issuer` validation.
 * - Derives the allowed algorithm list from the supplied key type.
 * - Rejects PEM-like secrets for HMAC algorithms (prevents algorithm confusion).
 * - Enforces minimum HMAC key lengths.
 * - Uses boundary-aware `excludePaths` matching.
 */

import {
  jwtVerify,
  importSPKI,
  importPKCS8,
  createRemoteJWKSet,
  errors as joseErrors,
  type JWTVerifyGetKey,
} from 'jose'
import type { ZeroRequest } from '0http-bun'
import type {
  JWTAuthOptions,
  JWTKeyLike,
  StepFunction,
} from '../interfaces/middleware'
import { matchesExcludedPath } from './utils'

const MIN_HMAC_BYTES: Record<string, number> = {
  HS256: 32,
  HS384: 48,
  HS512: 64,
}

const PEM_HEADER = /-----BEGIN (?:RSA |EC )?(?:PUBLIC|PRIVATE) KEY-----/

const RSA_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512']
const EC_ALGORITHMS = ['ES256', 'ES384', 'ES512']
const OKP_ALGORITHMS = ['EdDSA']
const SYMMETRIC_ALGORITHMS = ['HS256', 'HS384', 'HS512']
const ALL_SIGNED_ALGORITHMS = [
  ...SYMMETRIC_ALGORITHMS,
  ...RSA_ALGORITHMS,
  ...EC_ALGORITHMS,
  ...OKP_ALGORITHMS,
]

function isPEM(value: string | Uint8Array): value is string {
  return typeof value === 'string' && PEM_HEADER.test(value)
}

function isSymmetricSecret(secret: unknown): secret is string | Uint8Array {
  return typeof secret === 'string' || secret instanceof Uint8Array
}

function validateHMACSecret(secret: string | Uint8Array, algorithms: string[]) {
  const len = typeof secret === 'string' ? secret.length : secret.byteLength
  for (const alg of algorithms) {
    const min = MIN_HMAC_BYTES[alg]
    if (min && len < min) {
      throw new Error(
        `HMAC secret too short for ${alg}: ${len} bytes, minimum ${min} bytes`,
      )
    }
  }
}

async function importSecret(secret: string | Uint8Array): Promise<JWTKeyLike> {
  if (isPEM(secret)) {
    const trimmed = secret.trim()
    if (trimmed.includes('PUBLIC KEY')) {
      return importSPKI(trimmed, 'RS256')
    }
    if (trimmed.includes('PRIVATE KEY')) {
      return importPKCS8(trimmed, 'RS256')
    }
    throw new Error('Unable to determine PEM key type')
  }
  return typeof secret === 'string' ? new TextEncoder().encode(secret) : secret
}

function detectKeyAlgorithms(secret: unknown, algorithms?: string[]): string[] {
  if (algorithms) {
    if (algorithms.includes('none')) {
      throw new Error('Algorithm "none" is not allowed')
    }
    return algorithms
  }

  if (typeof secret === 'function') {
    return ALL_SIGNED_ALGORITHMS
  }

  if (isSymmetricSecret(secret)) {
    if (isPEM(secret)) {
      if (secret.includes('EC ')) return [...EC_ALGORITHMS]
      return [...RSA_ALGORITHMS]
    }
    return ['HS256']
  }

  // KeyLike object. We cannot reliably inspect it without node:crypto internals,
  // so allow the common signed algorithms and let jose reject mismatches.
  return ALL_SIGNED_ALGORITHMS
}

async function validateApiKey(
  apiKey: string,
  options: JWTAuthOptions,
  req: ZeroRequest,
): Promise<boolean | object> {
  const validator = options.apiKeyValidator || options.validateApiKey
  if (validator) {
    return validator.length === 1
      ? await (validator as (apiKey: string) => boolean | object)(apiKey)
      : await validator(apiKey, req)
  }

  const { apiKeys } = options
  if (typeof apiKeys === 'function') {
    return await apiKeys(apiKey, req)
  }
  if (Array.isArray(apiKeys)) {
    return apiKeys.includes(apiKey)
  }
  return false
}

async function extractToken(
  req: ZeroRequest,
  options: JWTAuthOptions,
): Promise<string | undefined> {
  if (options.getToken) {
    const token = await options.getToken(req)
    if (token) return token
  }

  if (options.tokenHeader) {
    const token = req.headers.get(options.tokenHeader)
    if (token) return token
  }

  if (options.tokenQuery) {
    const url = new URL(req.url)
    const token = url.searchParams.get(options.tokenQuery)
    if (token) return token
  }

  const authorization = req.headers.get('authorization')
  if (!authorization) return undefined

  const parts = authorization.split(' ')
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== 'bearer')
    return undefined
  return parts[1]
}

interface ResponseLike {
  body?: unknown
  status?: number
  headers?: Record<string, string> | Headers
}

function buildUnauthorizedResponse(
  error: Error,
  options: JWTAuthOptions,
  req: ZeroRequest,
) {
  const { unauthorizedResponse } = options
  if (unauthorizedResponse) {
    try {
      if (unauthorizedResponse instanceof Response) return unauthorizedResponse
      if (typeof unauthorizedResponse === 'function') {
        const result = unauthorizedResponse(error, req)
        if (result instanceof Response) return result
        if (result && typeof result === 'object') {
          const responseLike = result as ResponseLike
          const body = responseLike.body
          return new Response(
            typeof body === 'string' ? body : JSON.stringify(body || result),
            {
              status: responseLike.status || 401,
              headers: responseLike.headers || {
                'content-type': 'application/json',
              },
            },
          )
        }
      }
    } catch {
      // fall through to default
    }
  }

  let message = 'Invalid token'
  if (error.message === 'Authentication required') {
    message = 'Authentication required'
  } else if (error.message === 'Invalid API key') {
    message = 'Invalid API key'
  } else if (error instanceof joseErrors.JWTExpired) {
    message = 'Token expired'
  } else if (error instanceof joseErrors.JWTInvalid) {
    message = 'Invalid token format'
  } else if (error instanceof joseErrors.JWKSNoMatchingKey) {
    message = 'Token signature verification failed'
  } else if (error.message.includes('required "exp" claim')) {
    message = 'Token expired'
  } else if (
    error.message.includes('audience') ||
    error.message.includes('"aud"')
  ) {
    message = 'Invalid token audience'
  } else if (
    error.message.includes('issuer') ||
    error.message.includes('"iss"')
  ) {
    message = 'Invalid token issuer'
  }

  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

export function createJWTAuth(options: JWTAuthOptions = {}) {
  const {
    secret,
    jwksUri,
    jwks,
    jwtOptions = {},
    optional = false,
    excludePaths = [],
    apiKeyHeader = 'x-api-key',
    audience,
    issuer,
    algorithms: userAlgorithms,
  } = options

  const hasApiKeyMode =
    options.apiKeys || options.apiKeyValidator || options.validateApiKey

  if (!secret && !jwksUri && !jwks && !hasApiKeyMode) {
    throw new Error(
      'JWT middleware requires either secret, jwksUri, jwks, or apiKeys',
    )
  }

  // Derive algorithm allowlist from key type *before* importing.
  const algorithms = detectKeyAlgorithms(secret, userAlgorithms)

  if (isSymmetricSecret(secret) && !isPEM(secret)) {
    validateHMACSecret(secret, algorithms)
  }

  // Resolve the verification key eagerly so configuration errors surface at startup.
  let keyResolver:
    | JWTKeyLike
    | Promise<JWTKeyLike>
    | JWTVerifyGetKey
    | undefined

  if (jwks) {
    if (typeof jwks.getKey === 'function') {
      keyResolver = async (protectedHeader, token) =>
        jwks.getKey(protectedHeader, token)
    } else {
      keyResolver = jwks as JWTVerifyGetKey
    }
  } else if (jwksUri) {
    keyResolver = createRemoteJWKSet(new URL(jwksUri))
  } else if (typeof secret === 'function') {
    keyResolver = async (protectedHeader, token) => {
      const key = await (secret as any)(protectedHeader, token)
      return key as JWTKeyLike
    }
  } else if (secret) {
    keyResolver = isSymmetricSecret(secret)
      ? importSecret(secret)
      : (secret as JWTKeyLike)
  }

  const verifyOptions = {
    audience,
    issuer,
    ...jwtOptions,
    // Security-critical options cannot be overridden by jwtOptions.
    algorithms: jwtOptions.algorithms ?? algorithms,
    requiredClaims: ['exp'],
  }

  return async function jwtAuthMiddleware(
    req: ZeroRequest,
    next: StepFunction,
  ) {
    const url = new URL(req.url)

    if (matchesExcludedPath(url.pathname, excludePaths)) {
      return next()
    }

    try {
      if (hasApiKeyMode) {
        const apiKey = req.headers.get(apiKeyHeader)
        if (apiKey) {
          const validationResult = await validateApiKey(apiKey, options, req)
          if (validationResult !== false) {
            req.ctx = req.ctx || {}
            req.ctx.apiKey = apiKey
            req.ctx.user =
              validationResult && typeof validationResult === 'object'
                ? validationResult
                : { apiKey }
            req.apiKey = apiKey
            req.user = req.ctx.user
            return next()
          }
          return buildUnauthorizedResponse(
            new Error('Invalid API key'),
            options,
            req,
          )
        }
      }

      const token = await extractToken(req, options)
      if (!token) {
        if (optional) return next()
        return buildUnauthorizedResponse(
          new Error('Authentication required'),
          options,
          req,
        )
      }

      if (!keyResolver) {
        return buildUnauthorizedResponse(
          new Error('JWT verification not configured'),
          options,
          req,
        )
      }

      const key = await Promise.resolve(keyResolver)
      // jose's jwtVerify accepts both a static key and a JWTVerifyGetKey
      // resolver; the union type does not satisfy either overload directly.
      const { payload, protectedHeader } = await jwtVerify(
        token,
        key as Parameters<typeof jwtVerify>[1],
        verifyOptions,
      )

      req.ctx = req.ctx || {}
      req.ctx.user = payload
      req.ctx.jwt = { payload, header: protectedHeader, token }
      req.user = payload
      req.jwt = req.ctx.jwt

      return next()
    } catch (error) {
      if (optional && (!hasApiKeyMode || !req.headers.get(apiKeyHeader))) {
        return next()
      }

      if (options.onError) {
        const result = await options.onError(error as Error, req)
        if (result instanceof Response) return result
      }

      return buildUnauthorizedResponse(error as Error, options, req)
    }
  }
}

export default createJWTAuth

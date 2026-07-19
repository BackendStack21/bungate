# 🔐 Authentication Guide

Comprehensive guide to authentication and authorization in Bungate.

## Table of Contents

- [Overview](#overview)
- [JWT Authentication](#jwt-authentication)
  - [Gateway-Level Auth](#gateway-level-auth)
  - [Route-Level Auth](#route-level-auth)
  - [Custom Token Extraction](#custom-token-extraction)
- [JWKS (JSON Web Key Set)](#jwks-json-web-key-set)
- [API Key Authentication](#api-key-authentication)
  - [Basic Setup](#basic-setup)
  - [Custom Validation](#custom-validation)
  - [Dynamic API Keys](#dynamic-api-keys)
- [OAuth2 / OpenID Connect](#oauth2--openid-connect)
- [Hybrid Authentication](#hybrid-authentication)
- [Best Practices](#best-practices)
- [Testing Authentication](#testing-authentication)
- [Known Limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

## Overview

Bungate provides comprehensive authentication support out of the box:

- ✅ **JWT (JSON Web Tokens)** - Standard token-based authentication
- ✅ **JWKS** - JSON Web Key Set for dynamic key management
- ✅ **API Keys** - Simple key-based authentication
- ✅ **OAuth2/OIDC** - Integration with external identity providers
- ✅ **Custom Validation** - Extensible authentication logic
- ✅ **Gateway & Route Level** - Flexible configuration options

## JWT Authentication

### Gateway-Level Auth

Apply JWT authentication to all routes (with exclusions):

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  auth: {
    // HS256 secrets must be at least 32 bytes. Bungate derives the allowed
    // algorithm from the key type when algorithms is omitted.
    secret: process.env.JWT_SECRET,
    issuer: 'https://auth.myapp.com',
    audience: 'https://api.myapp.com',
    // Paths that don't require authentication (boundary-aware matching)
    excludePaths: [
      '/health',
      '/metrics',
      '/auth/login',
      '/auth/register',
      '/public/*',
    ],
  },
})

// All routes automatically require JWT authentication
// (except excluded paths)
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3001',
})

await gateway.listen()
```

### Route-Level Auth

Override gateway authentication for specific routes:

```typescript
// Gateway with optional auth
const gateway = new BunGateway({
  server: { port: 3000 },
})

// Admin routes with stricter authentication
gateway.addRoute({
  pattern: '/admin/*',
  target: 'http://admin-service:3000',
  auth: {
    // For RS256/ES256, `secret` may be a PEM public key or a CryptoKey.
    secret: process.env.ADMIN_JWT_PUBLIC_KEY!,
    jwtOptions: {
      algorithms: ['RS256'],
    },
    issuer: 'https://auth.myapp.com',
    audience: 'https://admin.myapp.com',
    optional: false, // Authentication is required
  },
})

// User routes with different secret
gateway.addRoute({
  pattern: '/api/users/*',
  target: 'http://user-service:3000',
  auth: {
    secret: process.env.JWT_SECRET,
    issuer: 'https://auth.myapp.com',
    audience: 'https://api.myapp.com',
  },
})

// Public route with no authentication
gateway.addRoute({
  pattern: '/public/*',
  target: 'http://public-service:3000',
  // No auth configuration
})
```

### JWT Security Notes

- **Tokens must include an `exp` claim.** Bungate rejects tokens without an expiration time.
- **Pin `issuer` and `audience`** to prevent cross-service token replay, especially when using JWKS.
- **HS256 secrets must be at least 32 bytes.** Short secrets are rejected at startup.
- **Algorithm confusion is blocked.** PEM-like secrets cannot be used as HMAC keys; the allowed algorithm family is derived from the key type when `algorithms` is omitted.
- **`excludePaths` uses boundary-aware matching.** `/public/*` excludes `/public/foo` but not `/publicity/foo`.

### Custom Token Extraction

By default, JWT tokens are extracted from the `Authorization` header. You can customize this:

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3000',
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
    },
    // Custom token extraction
    getToken: (req) => {
      // Try multiple sources
      return (
        req.headers.get('authorization')?.replace('Bearer ', '') ||
        req.headers.get('x-access-token') ||
        req.headers.get('x-auth-token') ||
        new URL(req.url).searchParams.get('token') ||
        null
      )
    },
  },
})
```

**Testing:**

```bash
# Standard Authorization header
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:3000/api/users

# Custom header
curl -H "X-Access-Token: YOUR_JWT_TOKEN" http://localhost:3000/api/users

# Query parameter
curl "http://localhost:3000/api/users?token=YOUR_JWT_TOKEN"
```

## JWKS (JSON Web Key Set)

Use JWKS for dynamic key management with external identity providers:

```typescript
gateway.addRoute({
  pattern: '/secure/*',
  target: 'http://secure-service:3000',
  auth: {
    jwksUri: 'https://auth.myapp.com/.well-known/jwks.json',
    jwtOptions: {
      algorithms: ['RS256', 'RS384', 'RS512'],
      issuer: 'https://auth.myapp.com',
      audience: 'https://api.myapp.com',
    },
  },
})
```

### JWKS with Caching

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3000',
  auth: {
    jwksUri: 'https://auth.myapp.com/.well-known/jwks.json',
    jwtOptions: {
      algorithms: ['RS256'],
      issuer: 'https://auth.myapp.com',
    },
    // Optional: Custom error handling
    onError: (error, req) => {
      console.error('JWKS validation failed:', error)
      return new Response(JSON.stringify({ error: 'Authentication failed' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  },
})
```

## API Key Authentication

### Basic Setup

Simple API key authentication for service-to-service communication:

```typescript
gateway.addRoute({
  pattern: '/api/public/*',
  target: 'http://public-api:3000',
  auth: {
    apiKeys: ['key1', 'key2', 'key3'],
    apiKeyHeader: 'X-API-Key', // Header name
  },
})
```

**Testing:**

```bash
# Valid request
curl -H "X-API-Key: key1" http://localhost:3000/api/public/data

# Invalid - missing key
curl http://localhost:3000/api/public/data
# Returns: 401 Unauthorized

# Invalid - wrong key
curl -H "X-API-Key: wrong-key" http://localhost:3000/api/public/data
# Returns: 401 Unauthorized
```

### Custom Validation

Add custom validation logic for API keys:

```typescript
gateway.addRoute({
  pattern: '/api/partners/*',
  target: 'http://partner-api:3000',
  auth: {
    apiKeys: ['partner-key-1', 'partner-key-2'],
    apiKeyHeader: 'X-API-Key',

    // Custom validator
    apiKeyValidator: async (key: string, req: Request) => {
      // Format validation
      if (!key.startsWith('partner-')) {
        return false
      }

      // Length check
      if (key.length < 16) {
        return false
      }

      // Database validation (example)
      try {
        const isValid = await database.validateApiKey(key)
        return isValid
      } catch (error) {
        console.error('API key validation error:', error)
        return false
      }
    },
  },
})
```

### Dynamic API Keys

Load API keys from environment or database:

```typescript
// From environment variables
const apiKeys = process.env.API_KEYS?.split(',') || []

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  auth: {
    apiKeys,
    apiKeyHeader: 'X-API-Key',
  },
})

// With metadata and expiration
interface ApiKeyConfig {
  key: string
  name: string
  createdAt: Date
  expiresAt?: Date
  rateLimit?: number
}

const apiKeyConfigs: ApiKeyConfig[] = [
  {
    key: 'current-key',
    name: 'prod-v2',
    createdAt: new Date('2024-01-01'),
    rateLimit: 1000,
  },
  {
    key: 'old-key',
    name: 'prod-v1',
    createdAt: new Date('2023-01-01'),
    expiresAt: new Date('2024-12-31'),
    rateLimit: 500,
  },
]

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  auth: {
    apiKeys: apiKeyConfigs.map((k) => k.key),
    apiKeyHeader: 'X-API-Key',
    apiKeyValidator: async (key: string) => {
      const config = apiKeyConfigs.find((k) => k.key === key)
      if (!config) return false

      // Check expiration
      if (config.expiresAt && config.expiresAt < new Date()) {
        console.warn(`Expired API key: ${config.name}`)
        return false
      }

      return true
    },
  },
  rateLimit: {
    max: 1000,
    windowMs: 60000,
    keyGenerator: (req) => {
      const key = req.headers.get('x-api-key') || ''
      const config = apiKeyConfigs.find((k) => k.key === key)
      // Use key-specific rate limit
      return key
    },
  },
})
```

## OAuth2 / OpenID Connect

Integrate with external identity providers:

### Google OAuth2

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3000',
  auth: {
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    jwtOptions: {
      algorithms: ['RS256'],
      issuer: 'https://accounts.google.com',
      audience: process.env.GOOGLE_CLIENT_ID,
    },
  },
})
```

### Auth0

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3000',
  auth: {
    jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
    jwtOptions: {
      algorithms: ['RS256'],
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      audience: process.env.AUTH0_AUDIENCE,
    },
  },
})
```

### Okta

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3000',
  auth: {
    jwksUri: `https://${process.env.OKTA_DOMAIN}/oauth2/default/v1/keys`,
    jwtOptions: {
      algorithms: ['RS256'],
      issuer: `https://${process.env.OKTA_DOMAIN}/oauth2/default`,
      audience: 'api://default',
    },
  },
})
```

## Hybrid Authentication

### Important Note

⚠️ **When both `secret` (JWT) and `apiKeys` are configured, the API key becomes REQUIRED.** JWT alone will not work. This is the current behavior.

### Combined JWT + API Key

```typescript
gateway.addRoute({
  pattern: '/api/hybrid/*',
  target: 'http://hybrid-service:3000',
  auth: {
    // JWT configuration
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
      issuer: 'https://auth.myapp.com',
    },

    // API key configuration
    // ⚠️ API key is REQUIRED when both are configured
    apiKeys: ['service-key-1', 'service-key-2'],
    apiKeyHeader: 'X-API-Key',
  },
})
```

**Testing hybrid auth:**

```bash
# Both JWT and API key required
curl -H "Authorization: Bearer YOUR_JWT" \
     -H "X-API-Key: service-key-1" \
     http://localhost:3000/api/hybrid/data
```

### Separate Routes for Different Auth Methods

**Recommended approach** for supporting either JWT or API keys:

```typescript
// JWT-only route
gateway.addRoute({
  pattern: '/api/jwt/*',
  target: 'http://backend:3000',
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: { algorithms: ['HS256'] },
  },
})

// API key-only route
gateway.addRoute({
  pattern: '/api/key/*',
  target: 'http://backend:3000',
  auth: {
    apiKeys: ['key1', 'key2'],
    apiKeyHeader: 'X-API-Key',
  },
})

// Public route
gateway.addRoute({
  pattern: '/api/public/*',
  target: 'http://backend:3000',
  // No authentication
})
```

## Best Practices

### 1. Use Environment Variables

```typescript
// ❌ DON'T hardcode secrets
auth: {
  apiKeys: ['hardcoded-key-123'],
  secret: 'my-secret-key',
}

// ✅ DO use environment variables
auth: {
  apiKeys: process.env.API_KEYS?.split(',') || [],
  secret: process.env.JWT_SECRET,
}
```

### 2. Implement Key Rotation

```typescript
auth: {
  apiKeys: [
    process.env.CURRENT_API_KEY,    // Active key
    process.env.PREVIOUS_API_KEY,    // Grace period for rotation
  ].filter(Boolean), // Remove undefined values
  apiKeyHeader: 'X-API-Key',
}
```

### 3. Rate Limit by User/Key

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  auth: {
    apiKeys: ['key1', 'key2'],
    apiKeyHeader: 'X-API-Key',
  },
  rateLimit: {
    max: 1000,
    windowMs: 60000,
    // Rate limit per API key
    keyGenerator: (req) => req.headers.get('x-api-key') || 'anonymous',
  },
})
```

### 4. Monitor Authentication Failures

```typescript
import { PinoLogger } from 'bungate'

const logger = new PinoLogger({ level: 'info' })

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  auth: {
    apiKeys: ['key1'],
    apiKeyHeader: 'X-API-Key',
    apiKeyValidator: async (key: string, req) => {
      const isValid = key === 'key1'

      if (!isValid) {
        logger.warn({
          event: 'auth_failure',
          key: key.substring(0, 4) + '***', // Partial key for debugging
          path: new URL(req.url).pathname,
          ip: req.headers.get('x-forwarded-for'),
          timestamp: new Date().toISOString(),
        })
      }

      return isValid
    },
  },
})
```

### 5. Environment-Specific Configuration

```typescript
const isDev = process.env.NODE_ENV !== 'production'

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  auth: isDev
    ? {
        // Development: More permissive
        apiKeys: ['dev-key-1', 'dev-key-2'],
        apiKeyHeader: 'X-API-Key',
      }
    : {
        // Production: Strict
        apiKeys: process.env.PROD_API_KEYS?.split(',') || [],
        apiKeyHeader: 'X-API-Key',
        apiKeyValidator: async (key: string) => {
          // Additional production validation
          return await productionKeyValidator(key)
        },
      },
})
```

### 6. Validate Key Format

```typescript
auth: {
  apiKeys: ['prod-key-abc123', 'prod-key-xyz789'],
  apiKeyHeader: 'X-API-Key',
  apiKeyValidator: async (key: string) => {
    // Enforce prefix
    if (!key.startsWith('prod-key-')) {
      return false
    }

    // Enforce minimum length
    if (key.length < 16) {
      return false
    }

    // Verify against whitelist
    const validKeys = ['prod-key-abc123', 'prod-key-xyz789']
    return validKeys.includes(key)
  },
}
```

### 7. Separate Public and Protected Routes

```typescript
// Public - no auth
gateway.addRoute({
  pattern: '/public/*',
  target: 'http://public-api:3000',
})

gateway.addRoute({
  pattern: '/health',
  handler: async () => new Response(JSON.stringify({ status: 'ok' })),
})

// Protected - auth required
gateway.addRoute({
  pattern: '/api/users/*',
  target: 'http://user-service:3000',
  auth: {
    apiKeys: process.env.API_KEYS?.split(',') || [],
    apiKeyHeader: 'X-API-Key',
  },
})

// Admin - stricter auth
gateway.addRoute({
  pattern: '/api/admin/*',
  target: 'http://admin-service:3000',
  auth: {
    apiKeys: process.env.ADMIN_API_KEYS?.split(',') || [],
    apiKeyHeader: 'X-Admin-Key',
  },
})
```

### 8. Secure Storage

```bash
# Use secrets manager in production
export API_KEYS=$(aws secretsmanager get-secret-value \
  --secret-id prod/api-keys \
  --query SecretString \
  --output text)

# Or encrypted environment files with SOPS
export $(sops -d .env.production.encrypted | xargs)
```

## Testing Authentication

### Unit Tests

```typescript
import { test, expect } from 'bun:test'

test('API key authentication - valid key', async () => {
  const response = await fetch('http://localhost:3000/api/data', {
    headers: { 'X-API-Key': 'valid-key' },
  })
  expect(response.status).toBe(200)
})

test('API key authentication - invalid key', async () => {
  const response = await fetch('http://localhost:3000/api/data', {
    headers: { 'X-API-Key': 'invalid-key' },
  })
  expect(response.status).toBe(401)
})

test('API key authentication - missing key', async () => {
  const response = await fetch('http://localhost:3000/api/data')
  expect(response.status).toBe(401)
})

test('JWT authentication', async () => {
  const token = 'valid-jwt-token'
  const response = await fetch('http://localhost:3000/api/data', {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(response.status).toBe(200)
})
```

### Manual Testing

```bash
# Test API key auth
curl -v -H "X-API-Key: your-key" http://localhost:3000/api/data

# Test JWT auth
curl -v -H "Authorization: Bearer YOUR_JWT" http://localhost:3000/api/data

# Test without auth (should fail)
curl -v http://localhost:3000/api/data

# Test public endpoint (should work)
curl -v http://localhost:3000/public/data
```

## Troubleshooting

### 401 Unauthorized with Valid API Key

**Check:**

1. API key is in the configured list
2. Header name matches (case-insensitive)
3. No extra spaces or hidden characters
4. Custom validator (if configured) returns true

**Debug:**

```typescript
auth: {
  apiKeys: ['key1'],
  apiKeyHeader: 'X-API-Key',
  apiKeyValidator: async (key: string, req) => {
    console.log('Received key:', key)
    console.log('Expected keys:', ['key1'])
    console.log('Match:', key === 'key1')
    return key === 'key1'
  },
}
```

### JWT Validation Fails

**Check:**

1. Token is not expired
2. Issuer matches configuration
3. Audience matches configuration
4. Algorithm is in allowed list
5. Secret/JWKS URI is correct

**Debug:**

```typescript
auth: {
  secret: process.env.JWT_SECRET,
  jwtOptions: {
    algorithms: ['HS256'],
  },
  onError: (error, req) => {
    console.error('JWT validation error:', error)
    return new Response('Auth failed', { status: 401 })
  },
}
```

### Hybrid Auth Not Working

**Issue**: When both JWT and API keys are configured, API key becomes required.

**Solution**: Use separate routes:

```typescript
// JWT route
gateway.addRoute({
  pattern: '/api/jwt/*',
  auth: { secret: process.env.JWT_SECRET },
})

// API key route
gateway.addRoute({
  pattern: '/api/key/*',
  auth: { apiKeys: ['key1'] },
})
```

## Related Documentation

- **[Quick Start](./QUICK_START.md)** - Get started with Bungate
- **[Security Guide](./SECURITY.md)** - Enterprise security features
- **[TLS Configuration](./TLS_CONFIGURATION.md)** - HTTPS setup
- **[API Reference](./API_REFERENCE.md)** - Complete API documentation
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues

---

**Need help?** Check out [Troubleshooting](./TROUBLESHOOTING.md) or [open an issue](https://github.com/BackendStack21/bungate/issues).

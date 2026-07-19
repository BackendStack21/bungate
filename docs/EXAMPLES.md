# 💡 Examples

Real-world examples and use cases for Bungate.

## Table of Contents

- [Microservices Gateway](#microservices-gateway)
- [E-Commerce Platform](#e-commerce-platform)
- [Multi-Tenant SaaS](#multi-tenant-saas)
- [API Marketplace](#api-marketplace)
- [Content Delivery](#content-delivery)
- [WebSocket Gateway](#websocket-gateway)
- [Development Proxy](#development-proxy)
- [Canary Deployments](#canary-deployments)

## Microservices Gateway

Enterprise-grade gateway for microservices architecture.

```typescript
import { BunGateway, PinoLogger } from 'bungate'

const logger = new PinoLogger({
  level: 'info',
  enableRequestLogging: true,
})

const gateway = new BunGateway({
  server: { port: 8080 },
  cluster: {
    enabled: true,
    workers: 4,
  },
  security: {
    tls: {
      enabled: true,
      cert: './certs/cert.pem',
      key: './certs/key.pem',
      redirectHTTP: true,
      redirectPort: 80,
      redirectAllowedHosts: ['api.myapp.com', '*.myapp.com'],
    },
  },
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
    },
    issuer: 'https://auth.myapp.com',
    audience: 'https://api.myapp.com',
    excludePaths: ['/health', '/metrics', '/auth/*', '/public/*'],
  },
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  },
  metrics: { enabled: true },
  logger,
})

// User service
gateway.addRoute({
  pattern: '/users/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://user-service-1:3001' },
      { url: 'http://user-service-2:3001' },
    ],
    healthCheck: {
      enabled: true,
      interval: 15000,
      path: '/health',
    },
  },
  rateLimit: {
    max: 100,
    windowMs: 60000,
    keyGenerator: (req) => (req as any).user?.id || 'anonymous',
  },
})

// Payment service with circuit breaker
gateway.addRoute({
  pattern: '/payments/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://payment-service-1:3002' },
      { url: 'http://payment-service-2:3002' },
    ],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    timeout: 5000,
    resetTimeout: 30000,
  },
  timeout: 30000,
  hooks: {
    onError: async (req, error) => {
      logger.error({ error }, 'Payment service error')
      return new Response(
        JSON.stringify({
          error: 'Payment service temporarily unavailable',
          retryAfter: 30,
        }),
        {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    },
  },
})

// Order service
gateway.addRoute({
  pattern: '/orders/*',
  target: 'http://order-service:3003',
  middlewares: [
    async (req, next) => {
      // Inject trace ID
      const traceId = crypto.randomUUID()
      req.headers.set('X-Trace-ID', traceId)

      const response = await next()
      response.headers.set('X-Trace-ID', traceId)

      return response
    },
  ],
})

// Public endpoints
gateway.addRoute({
  pattern: '/public/*',
  target: 'http://public-api:3004',
  rateLimit: {
    max: 1000,
    windowMs: 60000,
    // Prefer a trusted client identifier. Avoid raw X-Forwarded-For unless
    // trusted proxies are explicitly configured.
    keyGenerator: (req) => req.headers.get('cf-connecting-ip') || 'unknown',
  },
})

await gateway.listen()
console.log('Microservices gateway running on port 8080')
```

## E-Commerce Platform

High-traffic e-commerce gateway with caching and canary deployments.

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 8,
  },
})

// Product catalog with caching
const productCache = new Map<string, { data: string; expires: number }>()

gateway.addRoute({
  pattern: '/products/*',
  loadBalancer: {
    strategy: 'latency',
    targets: [
      { url: 'http://products-us-east:3000' },
      { url: 'http://products-us-west:3000' },
      { url: 'http://products-eu:3000' },
    ],
    healthCheck: {
      enabled: true,
      interval: 10000,
      path: '/health',
    },
  },
  middlewares: [
    // Cache middleware
    async (req, next) => {
      const cacheKey = req.url
      const cached = productCache.get(cacheKey)

      if (cached && cached.expires > Date.now()) {
        return new Response(cached.data, {
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'HIT',
          },
        })
      }

      const response = await next()
      const data = await response.text()

      // Cache for 5 minutes
      productCache.set(cacheKey, {
        data,
        expires: Date.now() + 300000,
      })

      return new Response(data, {
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'MISS',
        },
      })
    },
  ],
  rateLimit: {
    max: 10000,
    windowMs: 60000,
  },
})

// Shopping cart with sticky sessions
gateway.addRoute({
  pattern: '/cart/*',
  loadBalancer: {
    strategy: 'ip-hash',
    targets: [
      { url: 'http://cart-service-1:3001' },
      { url: 'http://cart-service-2:3001' },
      { url: 'http://cart-service-3:3001' },
    ],
    stickySession: {
      enabled: true,
      cookieName: 'cart_session',
      ttl: 3600000,
      secure: true,
      httpOnly: true,
      maxSessions: 10000,
      unknownCookiePolicy: 'ignore',
    },
  },
})

// Checkout with weighted routing (canary deployment)
gateway.addRoute({
  pattern: '/checkout/*',
  loadBalancer: {
    strategy: 'weighted',
    targets: [
      { url: 'http://checkout-v1:3002', weight: 95 }, // Stable
      { url: 'http://checkout-v2:3003', weight: 5 }, // Canary (5%)
    ],
  },
  timeout: 45000,
})

// Order tracking
gateway.addRoute({
  pattern: '/orders/*',
  target: 'http://order-service:3004',
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: { algorithms: ['HS256'] },
  },
})

await gateway.listen()
console.log('E-commerce gateway running')
```

## Multi-Tenant SaaS

Multi-tenant SaaS with tenant-based routing and rate limiting.

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
})

// Extract tenant ID from subdomain or header
function getTenantId(req: Request): string {
  // From subdomain: tenant1.api.example.com
  const host = req.headers.get('host') || ''
  const subdomain = host.split('.')[0]

  // Or from header
  const tenantHeader = req.headers.get('x-tenant-id')

  return tenantHeader || subdomain || 'default'
}

// Tenant configuration
const tenantConfig = {
  'premium-tenant': { rateLimit: 10000, timeout: 60000 },
  'standard-tenant': { rateLimit: 1000, timeout: 30000 },
  'free-tenant': { rateLimit: 100, timeout: 10000 },
}

// API routes with tenant-aware rate limiting
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://api-server-1:3001' },
      { url: 'http://api-server-2:3001' },
    ],
  },
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: { algorithms: ['HS256'] },
  },
  rateLimit: {
    max: 1000,
    windowMs: 60000,
    keyGenerator: (req) => {
      const tenantId = getTenantId(req)
      const userId = (req as any).user?.id || 'anonymous'
      return `${tenantId}:${userId}`
    },
  },
  middlewares: [
    // Tenant validation
    async (req, next) => {
      const tenantId = getTenantId(req)
      const config = tenantConfig[tenantId as keyof typeof tenantConfig]

      if (!config) {
        return new Response('Invalid tenant', { status: 403 })
      }

      // Inject tenant context
      req.headers.set('X-Tenant-ID', tenantId)
      req.headers.set(
        'X-Tenant-Tier',
        tenantId.startsWith('premium') ? 'premium' : 'standard',
      )

      return next()
    },
    // Usage tracking
    async (req, next) => {
      const tenantId = getTenantId(req)
      const start = Date.now()

      const response = await next()

      const duration = Date.now() - start

      // Track usage per tenant
      await trackUsage(tenantId, {
        endpoint: new URL(req.url).pathname,
        duration,
        status: response.status,
      })

      return response
    },
  ],
})

// Tenant-specific admin routes
gateway.addRoute({
  pattern: '/admin/*',
  target: 'http://admin-service:3002',
  auth: {
    secret: process.env.ADMIN_JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
      audience: 'admin',
    },
  },
  middlewares: [
    async (req, next) => {
      const user = (req as any).user

      if (user?.role !== 'admin') {
        return new Response('Forbidden', { status: 403 })
      }

      return next()
    },
  ],
})

async function trackUsage(tenantId: string, usage: any) {
  // Store usage metrics
  console.log('Usage:', { tenantId, ...usage })
}

await gateway.listen()
```

## API Marketplace

API marketplace with per-API authentication and billing.

```typescript
import { BunGateway } from 'bungate'

interface APIConfig {
  id: string
  name: string
  target: string
  rateLimit: number
  pricePerRequest: number
  requiresAuth: boolean
}

const apis: Record<string, APIConfig> = {
  weather: {
    id: 'weather',
    name: 'Weather API',
    target: 'http://weather-api:3001',
    rateLimit: 1000,
    pricePerRequest: 0.001,
    requiresAuth: true,
  },
  geocoding: {
    id: 'geocoding',
    name: 'Geocoding API',
    target: 'http://geocoding-api:3002',
    rateLimit: 500,
    pricePerRequest: 0.002,
    requiresAuth: true,
  },
  currency: {
    id: 'currency',
    name: 'Currency Exchange API',
    target: 'http://currency-api:3003',
    rateLimit: 10000,
    pricePerRequest: 0.0001,
    requiresAuth: false,
  },
}

const gateway = new BunGateway({
  server: { port: 3000 },
})

// Register routes for each API
Object.values(apis).forEach((api) => {
  gateway.addRoute({
    pattern: `/api/${api.id}/*`,
    target: api.target,
    auth: api.requiresAuth
      ? {
          apiKeys: async (key: string) => {
            return await validateApiKey(key, api.id)
          },
          apiKeyHeader: 'X-API-Key',
        }
      : undefined,
    rateLimit: {
      max: api.rateLimit,
      windowMs: 60000,
      keyGenerator: (req) => {
        const apiKey = req.headers.get('x-api-key') || 'anonymous'
        return `${api.id}:${apiKey}`
      },
    },
    middlewares: [
      // Billing middleware
      async (req, next) => {
        const apiKey = req.headers.get('x-api-key')

        if (apiKey) {
          // Track request for billing
          await trackRequest(apiKey, api.id, api.pricePerRequest)
        }

        const response = await next()

        // Add usage headers
        response.headers.set('X-API-Name', api.name)
        response.headers.set('X-Cost', api.pricePerRequest.toString())

        return response
      },
      // Analytics middleware
      async (req, next) => {
        const start = Date.now()
        const response = await next()
        const duration = Date.now() - start

        await trackAnalytics(api.id, {
          path: new URL(req.url).pathname,
          method: req.method,
          status: response.status,
          duration,
        })

        return response
      },
    ],
  })
})

async function validateApiKey(key: string, apiId: string): Promise<boolean> {
  // Validate key has access to this API
  // Check subscription status, quotas, etc.
  return true // Placeholder
}

async function trackRequest(apiKey: string, apiId: string, cost: number) {
  // Track request for billing
  console.log('Billing:', { apiKey, apiId, cost })
}

async function trackAnalytics(apiId: string, data: any) {
  // Store analytics
  console.log('Analytics:', { apiId, ...data })
}

await gateway.listen()
```

## Content Delivery

CDN-like content delivery with caching and geo-routing.

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 8,
  },
})

// In-memory cache
const cache = new Map<
  string,
  { data: Buffer; contentType: string; expires: number }
>()

// Static assets with aggressive caching
gateway.addRoute({
  pattern: '/static/*',
  loadBalancer: {
    strategy: 'latency',
    targets: [
      { url: 'http://cdn-us:3001' },
      { url: 'http://cdn-eu:3001' },
      { url: 'http://cdn-asia:3001' },
    ],
  },
  middlewares: [
    // Cache middleware
    async (req, next) => {
      const cacheKey = req.url
      const cached = cache.get(cacheKey)

      if (cached && cached.expires > Date.now()) {
        return new Response(cached.data, {
          headers: {
            'Content-Type': cached.contentType,
            'Cache-Control': 'public, max-age=31536000',
            'X-Cache': 'HIT',
          },
        })
      }

      const response = await next()
      const data = await response.arrayBuffer()
      const contentType =
        response.headers.get('content-type') || 'application/octet-stream'

      // Cache for 1 hour
      cache.set(cacheKey, {
        data: Buffer.from(data),
        contentType,
        expires: Date.now() + 3600000,
      })

      return new Response(data, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000',
          'X-Cache': 'MISS',
        },
      })
    },
  ],
})

// Images with optimization
gateway.addRoute({
  pattern: '/images/*',
  target: 'http://image-service:3002',
  middlewares: [
    async (req, next) => {
      // Add image optimization parameters
      const url = new URL(req.url)
      const width = url.searchParams.get('w')
      const quality = url.searchParams.get('q') || '80'

      if (width) {
        url.searchParams.set('width', width)
      }
      url.searchParams.set('quality', quality)

      return next()
    },
  ],
})

// Videos with streaming
gateway.addRoute({
  pattern: '/videos/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://video-server-1:3003' },
      { url: 'http://video-server-2:3003' },
    ],
  },
  timeout: 300000, // 5 minutes for large videos
})

await gateway.listen()
```

## WebSocket Gateway

WebSocket gateway with connection management.

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
})

// WebSocket connections with sticky sessions
gateway.addRoute({
  pattern: '/ws',
  loadBalancer: {
    strategy: 'ip-hash', // Ensure same client goes to same server
    targets: [
      { url: 'ws://ws-server-1:3001' },
      { url: 'ws://ws-server-2:3001' },
      { url: 'ws://ws-server-3:3001' },
    ],
    healthCheck: {
      enabled: true,
      interval: 10000,
      path: '/health',
    },
  },
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: { algorithms: ['HS256'] },
    getToken: (req) => {
      // Get token from query parameter for WebSocket
      return new URL(req.url).searchParams.get('token')
    },
  },
})

// REST API for WebSocket management
gateway.addRoute({
  pattern: '/api/connections',
  target: 'http://connection-manager:3002',
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: { algorithms: ['HS256'] },
  },
})

await gateway.listen()
```

## Development Proxy

Development proxy with hot reload support.

```typescript
import { BunGateway } from 'bungate'

const isDev = process.env.NODE_ENV !== 'production'

const gateway = new BunGateway({
  server: {
    port: 3000,
    development: isDev,
  },
})

// Frontend dev server
gateway.addRoute({
  pattern: '/',
  target: 'http://localhost:5173', // Vite dev server
  proxy: {
    preserveHostHeader: true,
  },
})

// Backend API
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://localhost:3001',
  middlewares: [
    // Logging middleware for development
    async (req, next) => {
      console.log('→', req.method, req.url)
      const start = Date.now()

      const response = await next()

      const duration = Date.now() - start
      console.log('←', response.status, `(${duration}ms)`)

      return response
    },
  ],
})

// Mock API endpoints for development
if (isDev) {
  gateway.addRoute({
    pattern: '/api/mock/*',
    handler: async (req) => {
      return new Response(JSON.stringify({ mock: true, data: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    },
  })
}

await gateway.listen()
console.log('Development proxy running on http://localhost:3000')
```

## Canary Deployments

Gradual rollout with monitoring and automatic rollback.

```typescript
import { BunGateway } from 'bungate'

let canaryWeight = 5 // Start with 5%
const gateway = new BunGateway({
  server: { port: 3000 },
})

gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'weighted',
    targets: [
      { url: 'http://app-v1:3001', weight: 100 - canaryWeight },
      { url: 'http://app-v2:3002', weight: canaryWeight },
    ],
    healthCheck: {
      enabled: true,
      interval: 10000,
      path: '/health',
    },
  },
  middlewares: [
    // Track errors per version
    async (req, next) => {
      const response = await next()

      const version = response.headers.get('x-app-version') || 'unknown'

      if (response.status >= 500) {
        await trackError(version)
      }

      return response
    },
  ],
})

// Gradually increase canary traffic
setInterval(async () => {
  const errorRate = await getErrorRate('v2')

  if (errorRate < 0.01) {
    // Less than 1% error rate
    if (canaryWeight < 100) {
      canaryWeight = Math.min(100, canaryWeight + 10)
      console.log(`Increasing canary to ${canaryWeight}%`)

      // Update route (requires restart or dynamic update)
      // In production, use configuration management
    }
  } else {
    console.log('High error rate detected, pausing rollout')
  }
}, 60000) // Every minute

async function trackError(version: string) {
  // Track errors
  console.log('Error in version:', version)
}

async function getErrorRate(version: string): Promise<number> {
  // Get error rate from metrics
  return 0.005 // Placeholder
}

await gateway.listen()
```

## Related Documentation

- **[Quick Start](./QUICK_START.md)** - Get started with Bungate
- **[Authentication](./AUTHENTICATION.md)** - Auth configuration
- **[Load Balancing](./LOAD_BALANCING.md)** - Load balancing strategies
- **[API Reference](./API_REFERENCE.md)** - Complete API docs
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues

---

**More examples?** Check the [examples directory](../examples/) for working code samples.

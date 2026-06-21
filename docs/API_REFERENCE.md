# 📚 API Reference

Complete API documentation for Bungate.

## Table of Contents

- [BunGateway](#bungateway)
- [Configuration](#configuration)
- [Routes](#routes)
- [Middleware](#middleware)
- [Logger](#logger)
- [Types](#types)

## BunGateway

### Constructor

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway(config: GatewayConfig)
```

### Methods

#### `addRoute(config: RouteConfig): void`

Add a route to the gateway.

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
})
```

#### `listen(port?: number): Promise<void>`

Start the gateway server.

```typescript
await gateway.listen()
await gateway.listen(3000) // Override port
```

#### `close(): Promise<void>`

Gracefully shutdown the gateway.

```typescript
await gateway.close()
```

#### `getTargetStatus(): TargetStatus[]`

Get the health status of all load balancer targets.

```typescript
const targets = gateway.getTargetStatus()
targets.forEach((target) => {
  console.log(`${target.url}: ${target.healthy ? '✓' : '✗'}`)
})
```

## Configuration

### GatewayConfig

Complete configuration interface:

```typescript
interface GatewayConfig {
  server?: ServerConfig
  cluster?: ClusterConfig
  security?: SecurityConfig
  auth?: AuthConfig
  cors?: CorsConfig
  metrics?: MetricsConfig
  logger?: LoggerInterface
}
```

### ServerConfig

```typescript
interface ServerConfig {
  port?: number // Default: 3000
  hostname?: string // Default: '0.0.0.0'
  development?: boolean // Default: false
}
```

**Example:**

```typescript
const gateway = new BunGateway({
  server: {
    port: 8080,
    hostname: 'localhost',
    development: true,
  },
})
```

### ClusterConfig

```typescript
interface ClusterConfig {
  enabled: boolean // Enable cluster mode
  workers?: number // Default: CPU cores
  restartWorkers?: boolean // Default: true
  restartDelay?: number // Default: 1000ms
  maxRestarts?: number // Default: 10
  respawnThreshold?: number // Default: 5
  respawnThresholdTime?: number // Default: 60000ms
  shutdownTimeout?: number // Default: 30000ms
  exitOnShutdown?: boolean // Default: true
  allowedEnvVars?: string[] // Allow-list of env vars forwarded to workers
  workerScriptAllowlist?: string[] // Allow-list of worker script paths
}
```

**Example:**

```typescript
const gateway = new BunGateway({
  cluster: {
    enabled: true,
    workers: 4,
    restartWorkers: true,
    maxRestarts: 10,
    shutdownTimeout: 30000,
  },
})
```

### SecurityConfig

```typescript
interface SecurityConfig {
  tls?: TLSConfig
  securityHeaders?: SecurityHeadersConfig
  inputValidation?: InputValidationConfig
  sizeLimits?: SizeLimitsConfig
  trustedProxies?: TrustedProxiesConfig
  jwtKeyRotation?: JWTKeyRotationConfig
}
```

#### TLSConfig

```typescript
interface TLSConfig {
  enabled: boolean
  cert: string | Buffer
  key: string | Buffer
  ca?: string | Buffer
  minVersion?: 'TLSv1.2' | 'TLSv1.3'
  cipherSuites?: string[]
  redirectHTTP?: boolean
  redirectPort?: number
}
```

**Example:**

```typescript
const gateway = new BunGateway({
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
      redirectHTTP: true,
      redirectPort: 80,
    },
  },
})
```

#### SecurityHeadersConfig

```typescript
interface SecurityHeadersConfig {
  enabled: boolean
  hsts?: {
    maxAge: number
    includeSubDomains?: boolean
    preload?: boolean
  }
  contentSecurityPolicy?: {
    directives: Record<string, string[]>
  }
  xFrameOptions?: 'DENY' | 'SAMEORIGIN'
  xContentTypeOptions?: boolean
}
```

**Example:**

```typescript
security: {
  securityHeaders: {
    enabled: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: {
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
      },
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: true,
  },
}
```

#### SizeLimitsConfig

```typescript
interface SizeLimitsConfig {
  maxBodySize?: number // Default: 10MB
  maxHeaderSize?: number // Default: 16KB
  maxUrlLength?: number // Default: 2048
}
```

**Example:**

```typescript
security: {
  sizeLimits: {
    maxBodySize: 50 * 1024 * 1024, // 50 MB
    maxHeaderSize: 32 * 1024,       // 32 KB
    maxUrlLength: 4096,
  },
}
```

### AuthConfig

```typescript
interface AuthConfig {
  secret?: string
  jwksUri?: string
  jwtOptions?: {
    algorithms: string[]
    issuer?: string
    audience?: string
    maxAge?: string | number
  }
  apiKeys?: string[]
  apiKeyHeader?: string
  apiKeyValidator?: (key: string, req: Request) => Promise<boolean> | boolean
  excludePaths?: string[]
  optional?: boolean
  getToken?: (req: Request) => string | null
  onError?: (error: Error, req: Request) => Response
}
```

**Example:**

```typescript
const gateway = new BunGateway({
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
      issuer: 'https://auth.example.com',
      audience: 'https://api.example.com',
    },
    excludePaths: ['/health', '/public/*'],
  },
})
```

### CorsConfig

```typescript
interface CorsConfig {
  origin: string | string[] | boolean
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}
```

**Example:**

```typescript
const gateway = new BunGateway({
  cors: {
    origin: ['https://app.example.com', 'https://admin.example.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
    maxAge: 86400,
  },
})
```

### MetricsConfig

```typescript
interface MetricsConfig {
  enabled: boolean
  path?: string // Default: '/metrics'
}
```

**Example:**

```typescript
const gateway = new BunGateway({
  metrics: {
    enabled: true,
    path: '/metrics',
  },
})
```

## Routes

### RouteConfig

```typescript
interface RouteConfig {
  pattern: string
  target?: string
  loadBalancer?: LoadBalancerConfig
  handler?: (req: Request) => Promise<Response> | Response
  auth?: AuthConfig
  rateLimit?: RateLimitConfig
  circuitBreaker?: CircuitBreakerConfig
  timeout?: number
  middlewares?: Middleware[]
  proxy?: ProxyConfig
  hooks?: RouteHooks
}
```

### LoadBalancerConfig

```typescript
interface LoadBalancerConfig {
  strategy:
    | 'round-robin'
    | 'least-connections'
    | 'weighted'
    | 'ip-hash'
    | 'random'
    | 'p2c'
    | 'latency'
    | 'weighted-least-connections'
  targets: TargetConfig[]
  healthCheck?: HealthCheckConfig
  stickySession?: StickySessionConfig
}
```

#### TargetConfig

```typescript
interface TargetConfig {
  url: string
  weight?: number // For weighted strategies
}
```

**Example:**

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'weighted',
    targets: [
      { url: 'http://api1.example.com', weight: 70 },
      { url: 'http://api2.example.com', weight: 30 },
    ],
  },
})
```

#### HealthCheckConfig

```typescript
interface HealthCheckConfig {
  enabled: boolean
  interval?: number // Default: 30000ms, clamped to 1000ms–300000ms
  timeout?: number // Default: 5000ms, must be less than interval
  path?: string // Default: '/health'
  method?: 'GET' | 'HEAD' // Default: 'GET'
  expectedStatus?: number // Default: 200
  expectedBody?: string // Optional body substring required for healthy status
  failureThreshold?: number // Default: 3, max 20
  successThreshold?: number // Default: 2, max 20
  minHealthyTargets?: number // Default: 1
  allowedSchemes?: string[] // Default: ['http', 'https']
  allowedHosts?: string[] // CIDR or exact hosts allowed for health checks
  validator?: (response: Response) => Promise<boolean> | boolean
}
```

**Example:**

```typescript
loadBalancer: {
  strategy: 'least-connections',
  targets: [/* ... */],
  healthCheck: {
    enabled: true,
    interval: 15000,
    timeout: 5000,
    path: '/health',
    expectedStatus: 200,
    validator: async (response) => {
      if (response.status !== 200) return false
      const data = await response.json()
      return data.status === 'healthy'
    },
  },
}
```

#### StickySessionConfig

```typescript
interface StickySessionConfig {
  enabled: boolean
  cookieName?: string // Default: 'bungate_session'
  ttl?: number // Default: 3600000ms (1 hour)
  secure?: boolean // Default: false
  httpOnly?: boolean // Default: true
  sameSite?: 'strict' | 'lax' | 'none'
}
```

**Example:**

```typescript
loadBalancer: {
  strategy: 'least-connections',
  targets: [/* ... */],
  stickySession: {
    enabled: true,
    cookieName: 'app_session',
    ttl: 7200000, // 2 hours
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
  },
}
```

### RateLimitConfig

```typescript
interface RateLimitConfig {
  max: number // Max requests
  windowMs: number // Time window in ms
  keyGenerator?: (req: Request) => string
  message?: string
  statusCode?: number
}
```

**Example:**

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  rateLimit: {
    max: 100,
    windowMs: 60000, // 1 minute
    keyGenerator: (req) => {
      return (
        req.headers.get('x-api-key') ||
        req.headers.get('x-forwarded-for') ||
        'unknown'
      )
    },
    message: 'Too many requests',
    statusCode: 429,
  },
})
```

### CircuitBreakerConfig

```typescript
interface CircuitBreakerConfig {
  enabled: boolean
  failureThreshold?: number // Default: 5
  timeout?: number // Default: 10000ms
  resetTimeout?: number // Default: 30000ms
  halfOpenRequests?: number // Default: 3
}
```

**Example:**

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    timeout: 10000,
    resetTimeout: 30000,
  },
  hooks: {
    onError: async (req, error) => {
      return new Response(JSON.stringify({ error: 'Service unavailable' }), {
        status: 503,
      })
    },
  },
})
```

### ProxyConfig

```typescript
interface ProxyConfig {
  timeout?: number
  headers?: Record<string, string | (() => string)>
  stripPath?: boolean
  preserveHostHeader?: boolean
}
```

**Example:**

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  proxy: {
    timeout: 30000,
    headers: {
      'X-Gateway-Version': '1.0.0',
      'X-Request-ID': () => crypto.randomUUID(),
    },
    stripPath: false,
    preserveHostHeader: true,
  },
})
```

### RouteHooks

```typescript
interface RouteHooks {
  onRequest?: (req: Request) => Promise<Request | Response> | Request | Response
  onResponse?: (req: Request, res: Response) => Promise<Response> | Response
  onError?: (req: Request, error: Error) => Promise<Response> | Response
}
```

**Example:**

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  hooks: {
    onRequest: async (req) => {
      console.log('Request:', req.method, req.url)
      return req
    },
    onResponse: async (req, res) => {
      console.log('Response:', res.status)
      return res
    },
    onError: async (req, error) => {
      console.error('Error:', error)
      return new Response('Internal Server Error', { status: 500 })
    },
  },
})
```

## Middleware

### Middleware Type

```typescript
type Middleware = (
  req: Request,
  next: () => Promise<Response>,
) => Promise<Response> | Response
```

### Example Middleware

```typescript
// Logging middleware
const loggingMiddleware: Middleware = async (req, next) => {
  const start = Date.now()
  console.log('→', req.method, req.url)

  const response = await next()

  const duration = Date.now() - start
  console.log('←', response.status, `(${duration}ms)`)

  return response
}

// Authentication middleware
const authMiddleware: Middleware = async (req, next) => {
  const token = req.headers.get('authorization')

  if (!token) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Validate token...

  return next()
}

// Use middleware
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api:3000',
  middlewares: [loggingMiddleware, authMiddleware],
})
```

## Logger

### PinoLogger

```typescript
import { PinoLogger } from 'bungate'

const logger = new PinoLogger(config: LoggerConfig)
```

### LoggerConfig

```typescript
interface LoggerConfig {
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  prettyPrint?: boolean
  enableRequestLogging?: boolean
}
```

**Example:**

```typescript
import { BunGateway, PinoLogger } from 'bungate'

const logger = new PinoLogger({
  level: 'info',
  prettyPrint: true,
  enableRequestLogging: true,
})

const gateway = new BunGateway({
  server: { port: 3000 },
  logger,
})
```

### Logger Methods

```typescript
logger.trace(obj, msg?)
logger.debug(obj, msg?)
logger.info(obj, msg?)
logger.warn(obj, msg?)
logger.error(obj, msg?)
logger.fatal(obj, msg?)
```

**Example:**

```typescript
logger.info({ userId: 123 }, 'User logged in')
logger.error({ error: err }, 'Request failed')
logger.debug({ request: req }, 'Processing request')
```

## Types

### Common Types

```typescript
// Target status
interface TargetStatus {
  url: string
  healthy: boolean
  connections: number
  latency?: number
}

// Request with user
interface AuthenticatedRequest extends Request {
  user?: {
    id: string
    email?: string
    [key: string]: any
  }
}

// Error response
interface ErrorResponse {
  error: string
  message?: string
  statusCode: number
}
```

### Type Guards

```typescript
// Check if request is authenticated
function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return 'user' in req
}

// Use in middleware
const middleware: Middleware = async (req, next) => {
  if (isAuthenticated(req)) {
    console.log('User:', req.user.id)
  }
  return next()
}
```

## Related Documentation

- **[Quick Start](./QUICK_START.md)** - Get started with Bungate
- **[Authentication](./AUTHENTICATION.md)** - Auth configuration
- **[Load Balancing](./LOAD_BALANCING.md)** - Load balancing strategies
- **[Clustering](./CLUSTERING.md)** - Multi-process scaling
- **[Security](./SECURITY.md)** - Security features
- **[TLS Configuration](./TLS_CONFIGURATION.md)** - HTTPS setup
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues

---

**Need more examples?** Check the [examples directory](../examples/).

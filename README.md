# 🚀 Bungate

> **The Lightning-Fast HTTP Gateway & Load Balancer for the Modern Web**

[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f472b6?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Performance](https://img.shields.io/badge/Performance-Blazing%20Fast-orange)](https://github.com/BackendStack21/bungate)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)

**Bungate** is a next-generation HTTP gateway and load balancer that harnesses the incredible speed of Bun to deliver unparalleled performance for modern web applications. Built from the ground up with TypeScript, it provides enterprise-grade features with zero-config simplicity.

<img src="https://raw.githubusercontent.com/BackendStack21/bungate/main/bungate-logo.png" alt="Bungate Logo" width="200"/>

> **Landing page:** [https://bungate.21no.de](https://bungate.21no.de)  
> **Full Documentation:** [docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)

---

## ⚡ Why Bungate?

- **🔥 Blazing Fast** - Built on Bun, up to 4x faster than Node.js alternatives
- **🎯 Zero Config** - Works out of the box with sensible defaults
- **🧠 Smart Load Balancing** - 8+ algorithms including round-robin, least-connections, weighted, ip-hash, p2c, latency
- **🛡️ Production Ready** - Circuit breakers, health checks, auto-failover
- **🔐 Built-in Auth** - JWT, API keys, JWKS, OAuth2 support out of the box
- **🔒 Enterprise Security** - TLS 1.3, input validation, security headers, OWASP Top 10 protection
- **🎨 Developer Friendly** - Full TypeScript support with intuitive APIs
- **📊 Observable** - Built-in Prometheus metrics, structured logging, monitoring
- **🔧 Extensible** - Powerful middleware system for custom logic
- **⚡ Cluster Mode** - Multi-process scaling with zero-downtime restarts

> See [benchmarks](./benchmark) comparing Bungate with Nginx and Envoy.

---

## 🚀 Quick Start

Get up and running in less than 60 seconds:

```bash
# Install Bungate
bun add bungate

# Create your gateway
touch gateway.ts
```

```typescript
import { BunGateway } from 'bungate'

// Create a production-ready gateway with zero config
const gateway = new BunGateway({
  server: { port: 3000 },
  metrics: { enabled: true },
})

// Add intelligent load balancing
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://api1.example.com' },
      { url: 'http://api2.example.com' },
      { url: 'http://api3.example.com' },
    ],
    healthCheck: {
      enabled: true,
      interval: 30000,
      path: '/health',
    },
  },
})

// Add rate limiting
gateway.addRoute({
  pattern: '/public/*',
  target: 'http://backend.example.com',
  rateLimit: {
    max: 1000,
    windowMs: 60000,
  },
})

// Start the gateway
await gateway.listen()
console.log('🚀 Bungate running on http://localhost:3000')
```

**That's it!** Your high-performance gateway is now handling traffic with:
✅ Automatic load balancing  
✅ Health monitoring  
✅ Rate limiting  
✅ Circuit breaker protection  
✅ Prometheus metrics

**👉 [Full Quick Start Guide](./docs/QUICK_START.md)**

---

## 🌟 Key Features

### 🚀 **Performance & Scalability**

- **High Throughput** - Handle thousands of requests per second
- **Low Latency** - Minimal overhead routing with optimized request processing
- **Memory Efficient** - Optimized for high-concurrent workloads
- **Cluster Mode** - Multi-process clustering for maximum CPU utilization

### 🎯 **Load Balancing Strategies**

- **Round Robin** - Equal distribution across all targets
- **Weighted** - Distribute based on server capacity
- **Least Connections** - Route to the least busy server
- **IP Hash** - Consistent routing for session affinity
- **Random** - Randomized distribution
- **Power of Two Choices (P2C)** - Pick better of two random targets
- **Latency** - Prefer the fastest server
- **Weighted Least Connections** - Combine capacity with load awareness
- **Sticky Sessions** - Cookie-based session persistence

**👉 [Load Balancing Guide](./docs/LOAD_BALANCING.md)**

### 🛡️ **Reliability & Resilience**

- **Circuit Breaker Pattern** - Automatic failure detection and recovery
- **Health Checks** - Active monitoring with custom validation
- **Timeout Management** - Route-level and global timeout controls
- **Auto-failover** - Automatic traffic rerouting on service failures

### 🔐 **Built-in Authentication**

- **JWT** - Full JWT support with HS256, RS256, and more
- **JWKS** - JSON Web Key Set for dynamic key management
- **API Keys** - Simple key-based authentication
- **OAuth2/OIDC** - Integration with external identity providers
- **Custom Validation** - Extensible authentication logic

**👉 [Authentication Guide](./docs/AUTHENTICATION.md)**

### 🔒 **Enterprise Security**

- **TLS/HTTPS** - Full TLS 1.3 support with automatic HTTP redirect
- **Input Validation** - Comprehensive validation and sanitization
- **Security Headers** - HSTS, CSP, X-Frame-Options, and more
- **Session Management** - Cryptographically secure session IDs
- **Trusted Proxies** - IP validation and forwarded header verification
- **Request Size Limits** - Protection against DoS attacks
- **JWT Key Rotation** - Zero-downtime key rotation support

**👉 [Security Guide](./docs/SECURITY.md) | [TLS Configuration](./docs/TLS_CONFIGURATION.md)**

### 📊 **Monitoring & Observability**

- **Prometheus Metrics** - Out-of-the-box performance metrics
- **Structured Logging** - JSON logging with request tracing
- **Health Endpoints** - Built-in health check APIs
- **Real-time Statistics** - Live performance monitoring

---

## 🔒 Quick Start with TLS/HTTPS

For production deployments with HTTPS:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 443, hostname: 'localhost' },
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
      redirectHTTP: true,
      redirectPort: 80,
      // Prevent open redirects via Host header
      redirectAllowedHosts: ['localhost'],
    },
  },
})

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
      issuer: 'https://auth.example.com',
      audience: 'https://api.example.com',
    },
  },
})

await gateway.listen()
console.log('🔒 Secure gateway running on https://localhost')
```

**👉 [TLS Configuration Guide](./docs/TLS_CONFIGURATION.md)**

---

## ⚡ Cluster Mode

Scale horizontally with multi-process clustering:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 4, // Number of worker processes
    restartWorkers: true,
    maxRestarts: 10,
    shutdownTimeout: 30000,
  },
})

gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://api-server-1:8080' },
      { url: 'http://api-server-2:8080' },
    ],
  },
})

await gateway.listen()
console.log('Cluster started with 4 workers')
```

**Features:**

- ✅ Zero-downtime rolling restarts (SIGUSR2)
- ✅ Dynamic scaling (scale up/down at runtime)
- ✅ Automatic worker respawn
- ✅ Graceful shutdown
- ✅ Signal-based control

**👉 [Clustering Guide](./docs/CLUSTERING.md)**

---

## 📦 Installation

### Prerequisites

- **Bun** >= 1.2.18 ([Install Bun](https://bun.sh/docs/installation))

### Install Bungate

```bash
# Using Bun (recommended)
bun add bungate

# Using npm
npm install bungate

# Using yarn
yarn add bungate
```

---

## 📚 Documentation

### **[📖 Complete Documentation](./docs/DOCUMENTATION.md)**

**Getting Started:**

- **[Quick Start Guide](./docs/QUICK_START.md)** - Get up and running in 5 minutes
- **[Examples](./docs/EXAMPLES.md)** - Real-world use cases and patterns

**Core Features:**

- **[Load Balancing](./docs/LOAD_BALANCING.md)** - 8+ strategies and configuration
- **[Clustering](./docs/CLUSTERING.md)** - Multi-process scaling
- **[Authentication](./docs/AUTHENTICATION.md)** - JWT, API keys, OAuth2

**Security:**

- **[Security Guide](./docs/SECURITY.md)** - Enterprise security features
- **[TLS Configuration](./docs/TLS_CONFIGURATION.md)** - HTTPS setup

**Reference:**

- **[API Reference](./docs/API_REFERENCE.md)** - Complete API documentation
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues and solutions

---

## 🏗️ Real-World Examples

### Microservices Gateway

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 8080 },
  cluster: { enabled: true, workers: 4 },
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
      issuer: 'https://auth.myapp.com',
      audience: 'https://api.myapp.com',
    },
    excludePaths: ['/health', '/auth/*'],
  },
  cors: {
    origin: ['https://myapp.com', 'https://admin.myapp.com'],
    credentials: true,
  },
})

// User service
gateway.addRoute({
  pattern: '/users/*',
  target: 'http://user-service:3001',
  rateLimit: { max: 100, windowMs: 60000 },
})

// Payment service with circuit breaker
gateway.addRoute({
  pattern: '/payments/*',
  target: 'http://payment-service:3002',
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
  },
})

await gateway.listen()
```

**👉 [More Examples](./docs/EXAMPLES.md)**

---

## 🔧 Advanced Features

### Custom Middleware

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  middlewares: [
    async (req, next) => {
      // Custom logic before request
      console.log('Request:', req.method, req.url)
      const response = await next()
      // Custom logic after response
      console.log('Response:', response.status)
      return response
    },
  ],
})
```

### Circuit Breaker with Fallback

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    timeout: 10000,
    resetTimeout: 30000,
  },
  hooks: {
    onError: async (req, error) => {
      // Return cached data or fallback response
      return new Response(
        JSON.stringify({ cached: true, data: getCachedData() }),
        { status: 200 },
      )
    },
  },
})
```

### Rate Limiting by User

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: { algorithms: ['HS256'] },
  },
  rateLimit: {
    max: 1000,
    windowMs: 60000,
    keyGenerator: (req) => (req as any).user?.id || 'anonymous',
  },
})
```

---

## 📊 Benchmarks

Bungate delivers exceptional performance:

- **18K+ requests/second** with load balancing
- **Single-digit millisecond** average latency
- **Sub-30ms** 99th percentile response times
- **Lower memory footprint** vs alternatives

See detailed [benchmark results](./benchmark) comparing Bungate with Nginx and Envoy.

---

## 🤝 Contributing

Contributions are welcome! Please check out our [contributing guidelines](./CONTRIBUTING.md) (if available).

### Reporting Issues

Found a bug or have a feature request?

- 🐛 **[Report Issues](https://github.com/BackendStack21/bungate/issues)**
- 💬 **[Discussions](https://github.com/BackendStack21/bungate/discussions)**

---

## 📄 License

MIT Licensed - see [LICENSE](LICENSE) for details.

---

## 🌟 Star History

If you find Bungate useful, please consider giving it a star on GitHub!

[![Star History Chart](https://api.star-history.com/svg?repos=BackendStack21/bungate&type=Date)](https://star-history.com/#BackendStack21/bungate&Date)

---

<div align="center">

**Built with ❤️ by [21no.de](https://21no.de) for the JavaScript Community**

[🏠 Homepage](https://bungate.21no.de) | [📚 Documentation](./docs/DOCUMENTATION.md) | [🐛 Issues](https://github.com/BackendStack21/bungate/issues) | [💬 Discussions](https://github.com/BackendStack21/bungate/discussions)

⭐ **[Star on GitHub](https://github.com/BackendStack21/bungate)** ⭐

</div>

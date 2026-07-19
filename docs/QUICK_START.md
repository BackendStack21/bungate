# 🚀 Quick Start Guide

Get up and running with Bungate in less than 5 minutes!

## Table of Contents

- [Installation](#installation)
- [Your First Gateway](#your-first-gateway)
- [Adding Routes](#adding-routes)
- [Load Balancing](#load-balancing)
- [Adding Security](#adding-security)
- [Running Your Gateway](#running-your-gateway)
- [Testing Your Setup](#testing-your-setup)
- [Next Steps](#next-steps)

## Installation

### Prerequisites

- **Bun** >= 1.2.18 ([Install Bun](https://bun.sh/docs/installation))

### Install Bungate

```bash
# Create a new project
mkdir my-gateway && cd my-gateway
bun init -y

# Install Bungate
bun add bungate
```

## Your First Gateway

Create a file called `gateway.ts`:

```typescript
import { BunGateway } from 'bungate'

// Create a simple gateway
const gateway = new BunGateway({
  server: { port: 3000 },
})

// Add your first route
gateway.addRoute({
  pattern: '/api/*',
  target: 'https://jsonplaceholder.typicode.com',
})

// Start the gateway
await gateway.listen()
console.log('🚀 Gateway running on http://localhost:3000')
```

Run it:

```bash
bun run gateway.ts
```

Test it:

```bash
curl http://localhost:3000/api/posts/1
```

## Adding Routes

Routes define how traffic is forwarded. You can add multiple routes with different patterns:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
})

// API route
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3001',
})

// Static content route
gateway.addRoute({
  pattern: '/static/*',
  target: 'http://cdn-service:3002',
})

// Health check route
gateway.addRoute({
  pattern: '/health',
  handler: async () =>
    new Response(JSON.stringify({ status: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
})

await gateway.listen()
```

## Load Balancing

Distribute traffic across multiple backend servers:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
})

gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections', // or 'round-robin', 'weighted', etc.
    targets: [
      { url: 'http://api-server-1:3001' },
      { url: 'http://api-server-2:3001' },
      { url: 'http://api-server-3:3001' },
    ],
    healthCheck: {
      enabled: true,
      interval: 15000, // Check every 15 seconds
      timeout: 5000, // 5 second timeout
      path: '/health', // Health check endpoint
    },
  },
})

await gateway.listen()
console.log('🚀 Load-balanced gateway running!')
```

**Available strategies:**

- `round-robin` - Distribute evenly across all targets
- `least-connections` - Route to server with fewest connections
- `weighted` - Distribute based on server weights
- `ip-hash` - Session affinity based on client IP
- `random` - Random distribution
- `p2c` - Power of two choices
- `latency` - Route to fastest server
- `weighted-least-connections` - Weighted by connections and capacity

See [Load Balancing Guide](./LOAD_BALANCING.md) for detailed information.

## Adding Security

### Rate Limiting

Protect your services from abuse:

```typescript
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3001',
  rateLimit: {
    max: 100, // 100 requests
    windowMs: 60000, // per minute
    keyGenerator: (req) => {
      // Use a trusted client identifier. Avoid raw X-Forwarded-For unless
      // trusted proxies are explicitly configured.
      return req.headers.get('cf-connecting-ip') || 'unknown'
    },
  },
})
```

### Authentication

Add JWT authentication:

```typescript
const gateway = new BunGateway({
  server: { port: 3000 },
  auth: {
    secret: process.env.JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
    },
    issuer: 'https://auth.myapp.com',
    audience: 'https://api.myapp.com',
    excludePaths: ['/health', '/auth/login'],
  },
})

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3001',
  // This route automatically requires JWT authentication
})
```

See [Authentication Guide](./AUTHENTICATION.md) for more options including API keys and OAuth2.

### TLS/HTTPS

Enable HTTPS with TLS:

```typescript
const gateway = new BunGateway({
  server: { port: 443, hostname: 'example.com' },
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
      redirectHTTP: true,
      redirectPort: 80,
      redirectAllowedHosts: ['example.com', '*.example.com'],
    },
  },
})
```

See [TLS Configuration Guide](./TLS_CONFIGURATION.md) for detailed setup.

## Running Your Gateway

### Development Mode

```bash
# Run with hot reload
bun --watch gateway.ts
```

### Production Mode

```bash
# Build (optional)
bun build gateway.ts --outfile dist/gateway.js

# Run in production
NODE_ENV=production bun run gateway.ts
```

### With Cluster Mode

Scale horizontally with multiple worker processes:

```typescript
const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 4, // Number of worker processes
  },
})
```

See [Clustering Guide](./CLUSTERING.md) for advanced cluster management.

## Testing Your Setup

### Basic Health Check

```bash
curl http://localhost:3000/health
```

### Test API Routes

```bash
# GET request
curl http://localhost:3000/api/users

# POST request
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe"}'

# With authentication
curl http://localhost:3000/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Check Metrics

If you enabled metrics:

```bash
curl http://localhost:3000/metrics
```

### Load Testing

```bash
# Install wrk
brew install wrk  # macOS
# or
apt-get install wrk  # Linux

# Run load test
wrk -t4 -c100 -d30s http://localhost:3000/api/health
```

## Next Steps

Now that you have a basic gateway running, explore more features:

### 📚 **Documentation**

- **[Authentication Guide](./AUTHENTICATION.md)** - JWT, API keys, OAuth2
- **[Load Balancing](./LOAD_BALANCING.md)** - Strategies and configuration
- **[Clustering](./CLUSTERING.md)** - Multi-process scaling
- **[Security Guide](./SECURITY.md)** - Enterprise security features
- **[TLS Configuration](./TLS_CONFIGURATION.md)** - HTTPS setup
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues and solutions
- **[API Reference](./API_REFERENCE.md)** - Complete API documentation
- **[Examples](./EXAMPLES.md)** - Real-world use cases

### 🎯 **Common Next Steps**

1. **Enable Metrics & Monitoring**

   ```typescript
   const gateway = new BunGateway({
     metrics: { enabled: true },
     logger: new PinoLogger({ level: 'info' }),
   })
   ```

2. **Add Circuit Breakers**

   ```typescript
   gateway.addRoute({
     pattern: '/api/*',
     target: 'http://api-service:3001',
     circuitBreaker: {
       enabled: true,
       failureThreshold: 5,
       timeout: 5000,
       resetTimeout: 30000,
     },
   })
   ```

3. **Configure CORS**

   ```typescript
   const gateway = new BunGateway({
     cors: {
       origin: ['https://myapp.com'],
       credentials: true,
       methods: ['GET', 'POST', 'PUT', 'DELETE'],
     },
   })
   ```

4. **Add Custom Middleware**
   ```typescript
   gateway.addRoute({
     pattern: '/api/*',
     target: 'http://api-service:3001',
     middlewares: [
       async (req, next) => {
         console.log(`Request: ${req.method} ${req.url}`)
         const response = await next()
         console.log(`Response: ${response.status}`)
         return response
       },
     ],
   })
   ```

### 🛠️ **Development Tools**

- **VS Code Extension**: Enable Bun extension for better TypeScript support
- **Testing**: Use `bun:test` for testing your gateway configuration
- **Debugging**: Set `level: 'debug'` in logger for detailed logs

### 🌐 **Community & Support**

- 📖 [GitHub Repository](https://github.com/BackendStack21/bungate)
- 🐛 [Report Issues](https://github.com/BackendStack21/bungate/issues)
- 💬 [Discussions](https://github.com/BackendStack21/bungate/discussions)
- 🌟 [Star on GitHub](https://github.com/BackendStack21/bungate)

---

**Ready to build something amazing?** Check out the [Examples](./EXAMPLES.md) for real-world implementations!

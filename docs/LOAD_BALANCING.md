# 🧠 Load Balancing Guide

Comprehensive guide to load balancing strategies and configuration in Bungate.

## Table of Contents

- [Overview](#overview)
- [Load Balancing Strategies](#load-balancing-strategies)
  - [Round Robin](#round-robin)
  - [Least Connections](#least-connections)
  - [Weighted](#weighted)
  - [IP Hash](#ip-hash)
  - [Random](#random)
  - [Power of Two Choices (P2C)](#power-of-two-choices-p2c)
  - [Latency-Based](#latency-based)
  - [Weighted Least Connections](#weighted-least-connections)
- [Health Checks](#health-checks)
- [Circuit Breakers](#circuit-breakers)
- [Sticky Sessions](#sticky-sessions)
- [Advanced Configuration](#advanced-configuration)
- [Performance Comparison](#performance-comparison)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

Bungate provides 8+ intelligent load balancing strategies to distribute traffic across multiple backend servers. Each strategy is optimized for different traffic patterns and architectures.

### Basic Load Balancer Setup

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
})

gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://api-server-1:3001' },
      { url: 'http://api-server-2:3001' },
      { url: 'http://api-server-3:3001' },
    ],
    healthCheck: {
      enabled: true,
      interval: 15000,
      timeout: 5000,
      path: '/health',
    },
  },
})

await gateway.listen()
```

## Load Balancing Strategies

### Round Robin

**Use case**: Stateless services with uniform capacity

Distributes requests evenly across all targets in a circular pattern. Each target receives an equal number of requests.

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'round-robin',
    targets: [
      { url: 'http://api1.example.com' },
      { url: 'http://api2.example.com' },
      { url: 'http://api3.example.com' },
    ],
  },
})
```

**Pros:**

- Simple and predictable
- Equal distribution
- Low overhead

**Cons:**

- Doesn't consider server load
- Not ideal for varying request durations
- No session affinity

### Least Connections

**Use case**: Variable request durations, long-lived connections

Routes traffic to the server with the fewest active connections. Ideal when requests have varying processing times.

```typescript
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
      interval: 10000,
      path: '/health',
    },
  },
})
```

**Pros:**

- Adapts to server load
- Good for variable request times
- Prevents server overload

**Cons:**

- Slightly more overhead
- Requires connection tracking

**Best for:**

- WebSocket connections
- Streaming APIs
- File uploads/downloads
- Database queries

### Weighted

**Use case**: Heterogeneous server specifications

Distributes traffic based on server capacity. Servers with higher weights receive proportionally more requests.

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'weighted',
    targets: [
      { url: 'http://api-large:3000', weight: 70 }, // Powerful server
      { url: 'http://api-medium:3001', weight: 20 }, // Medium server
      { url: 'http://api-small:3002', weight: 10 }, // Small server
    ],
  },
})
```

**Weight distribution:**

- Server 1 (weight: 70) → 70% of traffic
- Server 2 (weight: 20) → 20% of traffic
- Server 3 (weight: 10) → 10% of traffic

**Pros:**

- Optimal for mixed hardware
- Fine-grained control
- Gradual rollouts (canary deployments)

**Cons:**

- Requires capacity planning
- Static configuration

**Example: Canary Deployment**

```typescript
// Roll out new version gradually
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'weighted',
    targets: [
      { url: 'http://api-v1:3000', weight: 95 }, // Stable version
      { url: 'http://api-v2:3001', weight: 5 }, // New version (5% traffic)
    ],
  },
})
```

### IP Hash

**Use case**: Session affinity, stateful applications

Routes requests from the same client IP to the same backend server. Ensures session persistence.

```typescript
gateway.addRoute({
  pattern: '/app/*',
  loadBalancer: {
    strategy: 'ip-hash',
    targets: [
      { url: 'http://app-server-1:3000' },
      { url: 'http://app-server-2:3000' },
      { url: 'http://app-server-3:3000' },
    ],
  },
})
```

**Pros:**

- Consistent routing per client
- Session affinity without cookies
- Good for stateful apps

**Cons:**

- Uneven distribution with NAT/proxies
- Server removal affects routing
- No failover for sessions

**Best for:**

- Shopping carts
- User sessions
- Real-time applications
- WebSocket connections

### Random

**Use case**: Simple, low-overhead distribution

Randomly selects a backend server for each request. Simple and effective for most use cases.

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'random',
    targets: [
      { url: 'http://api1.example.com' },
      { url: 'http://api2.example.com' },
      { url: 'http://api3.example.com' },
    ],
  },
})
```

**Pros:**

- Very low overhead
- Good distribution over time
- No state tracking needed

**Cons:**

- Short-term distribution may vary
- No load awareness

### Power of Two Choices (P2C)

**Use case**: Balance between performance and efficiency

Randomly picks two servers and routes to the one with fewer connections or lower latency. Provides good load distribution with minimal overhead.

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'p2c',
    targets: [
      { url: 'http://api1.example.com' },
      { url: 'http://api2.example.com' },
      { url: 'http://api3.example.com' },
      { url: 'http://api4.example.com' },
    ],
  },
})
```

**How it works:**

1. Randomly select two servers
2. Compare their load/latency
3. Route to the better one

**Pros:**

- Better than random
- Lower overhead than least-connections
- Good load distribution

**Cons:**

- Requires 3+ servers for best results
- Slightly more complex than random

**Best for:**

- Large server pools
- Microservices
- High-throughput APIs

### Latency-Based

**Use case**: Optimize for response time

Routes traffic to the server with the lowest average response time. Automatically adapts to server performance.

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'latency',
    targets: [
      { url: 'http://api-us-east:3000' },
      { url: 'http://api-us-west:3000' },
      { url: 'http://api-eu:3000' },
    ],
    healthCheck: {
      enabled: true,
      interval: 5000,
      path: '/health',
    },
  },
})
```

**Pros:**

- Optimizes user experience
- Adapts to performance changes
- Good for geo-distributed servers

**Cons:**

- Requires latency tracking
- May favor consistently fast servers

**Best for:**

- Geo-distributed backends
- CDN-like scenarios
- Performance-critical applications

### Weighted Least Connections

**Use case**: Mixed capacity servers with load awareness

Combines weighted and least-connections strategies. Routes to servers based on both capacity (weight) and current load (connections).

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'weighted-least-connections',
    targets: [
      { url: 'http://api-large:3000', weight: 100 }, // 8 cores, 16GB RAM
      { url: 'http://api-medium:3001', weight: 50 }, // 4 cores, 8GB RAM
      { url: 'http://api-small:3002', weight: 25 }, // 2 cores, 4GB RAM
    ],
  },
})
```

**Formula**: `score = connections / weight` (lower is better)

**Pros:**

- Best of both worlds
- Optimal for mixed hardware
- Load-aware distribution

**Cons:**

- Most complex algorithm
- Requires weight configuration

**Best for:**

- Production environments
- Mixed server specifications
- Cost optimization

## Health Checks

Monitor backend health and automatically remove unhealthy servers:

```typescript
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
      interval: 15000, // Check every 15 seconds
      timeout: 5000, // 5 second timeout
      path: '/health', // Health check endpoint
      expectedStatus: 200, // Expected status code
      failureThreshold: 3, // Failures before marking unhealthy
      successThreshold: 2, // Successes before marking healthy
    },
  },
})
```

### Custom Health Check Logic

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://api1.example.com' },
      { url: 'http://api2.example.com' },
    ],
    healthCheck: {
      enabled: true,
      interval: 10000,
      path: '/health',
      validator: async (response: Response) => {
        // Custom validation logic
        if (response.status !== 200) return false

        const data = await response.json()
        // Check specific health indicators
        return (
          data.status === 'healthy' &&
          data.database === 'connected' &&
          data.memoryUsage < 90
        )
      },
    },
  },
})
```

## Circuit Breakers

Prevent cascading failures with circuit breakers:

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://api1.example.com' },
      { url: 'http://api2.example.com' },
    ],
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5, // Open after 5 failures
    timeout: 10000, // 10 second request timeout
    resetTimeout: 30000, // Try again after 30 seconds
    halfOpenRequests: 3, // Test with 3 requests when half-open
  },
  hooks: {
    onError: async (req, error) => {
      // Fallback response when circuit is open
      return new Response(
        JSON.stringify({
          error: 'Service temporarily unavailable',
          retryAfter: 30,
        }),
        {
          status: 503,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '30',
          },
        },
      )
    },
  },
})
```

## Sticky Sessions

Maintain session affinity with cookie-based persistence:

```typescript
gateway.addRoute({
  pattern: '/app/*',
  loadBalancer: {
    strategy: 'least-connections', // Base strategy
    targets: [
      { url: 'http://app-server-1:3000' },
      { url: 'http://app-server-2:3000' },
      { url: 'http://app-server-3:3000' },
    ],
    stickySession: {
      enabled: true,
      cookieName: 'app_session',
      ttl: 3600000, // 1 hour
      secure: true, // HTTPS only
      httpOnly: true, // No JavaScript access
      sameSite: 'lax',
    },
  },
})
```

**How it works:**

1. First request uses base strategy (e.g., least-connections)
2. Gateway sets a cookie identifying the chosen server
3. Subsequent requests with the cookie go to the same server
4. If server is unhealthy, fallback to base strategy

## Advanced Configuration

### Multiple Load Balancers

Different strategies for different routes:

```typescript
// Public API - Round robin
gateway.addRoute({
  pattern: '/api/public/*',
  loadBalancer: {
    strategy: 'round-robin',
    targets: [
      { url: 'http://public-api-1:3000' },
      { url: 'http://public-api-2:3000' },
    ],
  },
})

// User sessions - IP hash
gateway.addRoute({
  pattern: '/api/users/*',
  loadBalancer: {
    strategy: 'ip-hash',
    targets: [
      { url: 'http://user-api-1:3001' },
      { url: 'http://user-api-2:3001' },
    ],
  },
})

// Heavy computation - Least connections
gateway.addRoute({
  pattern: '/api/compute/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      { url: 'http://compute-1:3002' },
      { url: 'http://compute-2:3002' },
    ],
  },
})
```

### Dynamic Target Management

```typescript
// Get current target status
const status = gateway.getTargetStatus()
console.log('Healthy targets:', status.filter((t) => t.healthy).length)

// Monitor health
setInterval(() => {
  const targets = gateway.getTargetStatus()
  targets.forEach((target) => {
    console.log(`${target.url}: ${target.healthy ? '✓' : '✗'}`)
  })
}, 30000)
```

### Failover Configuration

```typescript
gateway.addRoute({
  pattern: '/api/*',
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      // Primary data center
      { url: 'http://api-primary-1:3000' },
      { url: 'http://api-primary-2:3000' },
      // Failover data center (lower weight)
      { url: 'http://api-backup-1:3001', weight: 10 },
      { url: 'http://api-backup-2:3001', weight: 10 },
    ],
    healthCheck: {
      enabled: true,
      interval: 10000,
      path: '/health',
      failureThreshold: 2, // Fast failover
    },
  },
})
```

## Performance Comparison

### Strategy Performance Characteristics

| Strategy          | Overhead | Distribution | Load Aware | Session Affinity |
| ----------------- | -------- | ------------ | ---------- | ---------------- |
| Round Robin       | Lowest   | Even         | ❌         | ❌               |
| Random            | Lowest   | Good         | ❌         | ❌               |
| Least Connections | Low      | Excellent    | ✅         | ❌               |
| IP Hash           | Low      | Variable     | ❌         | ✅               |
| Weighted          | Low      | Controlled   | ❌         | ❌               |
| P2C               | Low      | Good         | ✅         | ❌               |
| Latency           | Medium   | Optimal      | ✅         | ❌               |
| Weighted LC       | Medium   | Excellent    | ✅         | ❌               |

### Choosing the Right Strategy

```typescript
// High throughput, stateless API
strategy: 'round-robin' or 'random'

// Variable request times
strategy: 'least-connections'

// Mixed server specs
strategy: 'weighted' or 'weighted-least-connections'

// Session-based applications
strategy: 'ip-hash' + stickySession

// Geo-distributed servers
strategy: 'latency'

// Large server pools
strategy: 'p2c'

// Production (best overall)
strategy: 'weighted-least-connections'
```

## Best Practices

### 1. Always Enable Health Checks

```typescript
healthCheck: {
  enabled: true,
  interval: 15000,
  timeout: 5000,
  path: '/health',
  failureThreshold: 3,
  successThreshold: 2,
}
```

### 2. Restrict Health Check Targets

For security, limit which schemes and hosts the load balancer may probe.

```typescript
healthCheck: {
  enabled: true,
  interval: 15000,
  timeout: 5000,
  path: '/health',
  failureThreshold: 3,
  successThreshold: 2,
  allowedSchemes: ['http', 'https'],
  allowedHosts: ['10.0.0.0/8', 'api.internal.example.com'],
}
```

### 3. Use Circuit Breakers for External Services

```typescript
circuitBreaker: {
  enabled: true,
  failureThreshold: 5,
  timeout: 10000,
  resetTimeout: 30000,
}
```

### 4. Configure Timeouts

```typescript
gateway.addRoute({
  pattern: '/api/*',
  timeout: 30000, // 30 second timeout
  loadBalancer: {
    strategy: 'least-connections',
    targets: [
      /* ... */
    ],
  },
})
```

### 5. Monitor Target Health

```typescript
import { PinoLogger } from 'bungate'

const logger = new PinoLogger({ level: 'info' })

// Log health changes
gateway.on('target-unhealthy', (target) => {
  logger.warn({ target }, 'Target marked unhealthy')
})

gateway.on('target-healthy', (target) => {
  logger.info({ target }, 'Target marked healthy')
})
```

### 6. Use Appropriate Strategy

```typescript
// ❌ DON'T use IP hash for APIs behind NAT
loadBalancer: {
  strategy: 'ip-hash', // Bad: Many clients behind same IP
  targets: [/* ... */],
}

// ✅ DO use least-connections for better distribution
loadBalancer: {
  strategy: 'least-connections',
  targets: [/* ... */],
}
```

### 7. Plan for Capacity

```typescript
// Configure weights based on actual capacity
loadBalancer: {
  strategy: 'weighted',
  targets: [
    { url: 'http://api-8core:3000', weight: 80 },  // 8 cores
    { url: 'http://api-4core:3001', weight: 40 },  // 4 cores
    { url: 'http://api-2core:3002', weight: 20 },  // 2 cores
  ],
}
```

### 8. Test Failover Scenarios

```bash
# Simulate server failure
docker stop api-server-1

# Monitor gateway behavior
curl http://localhost:3000/api/health

# Verify traffic redistributes
# Restart server
docker start api-server-1

# Verify traffic returns
```

## Troubleshooting

### Uneven Distribution

**Problem**: One server receives more traffic than others

**Solutions:**

```typescript
// 1. Check health check configuration
healthCheck: {
  enabled: true,
  interval: 10000, // More frequent checks
  path: '/health',
}

// 2. Try different strategy
strategy: 'least-connections', // Instead of round-robin

// 3. Verify weights are correct
targets: [
  { url: 'http://api1:3000', weight: 50 },
  { url: 'http://api2:3000', weight: 50 }, // Equal weights
]
```

### Servers Marked Unhealthy

**Problem**: Healthy servers marked as unhealthy

**Solutions:**

```typescript
// 1. Increase timeouts
healthCheck: {
  enabled: true,
  timeout: 10000, // Increase from 5000
  failureThreshold: 5, // Require more failures
}

// 2. Check health endpoint performance
// Make sure /health endpoint responds quickly

// 3. Verify network connectivity
// Test manually: curl http://backend:3000/health
```

### High Latency

**Problem**: Slow response times through gateway

**Solutions:**

```typescript
// 1. Use latency-based strategy
strategy: 'latency',

// 2. Enable connection pooling (on by default)

// 3. Reduce health check frequency
healthCheck: {
  interval: 30000, // Less frequent checks
}

// 4. Check backend performance
// Profile backend services
```

### Session Loss

**Problem**: Users lose sessions

**Solutions:**

```typescript
// 1. Enable sticky sessions
stickySession: {
  enabled: true,
  cookieName: 'session_id',
  ttl: 3600000,
}

// 2. Use IP hash
strategy: 'ip-hash',

// 3. Use external session store
// Store sessions in Redis/database instead of memory
```

## Related Documentation

- **[Quick Start](./QUICK_START.md)** - Get started with Bungate
- **[Clustering](./CLUSTERING.md)** - Multi-process scaling
- **[Security Guide](./SECURITY.md)** - Security features
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
- **[API Reference](./API_REFERENCE.md)** - Complete API docs

---

**Need help?** Check [Troubleshooting](./TROUBLESHOOTING.md) or [open an issue](https://github.com/BackendStack21/bungate/issues).

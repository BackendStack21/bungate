# ⚡ Clustering Guide

Scale horizontally with multi-process clustering for maximum CPU utilization.

## Table of Contents

- [Overview](#overview)
- [Basic Setup](#basic-setup)
- [Configuration Options](#configuration-options)
- [Lifecycle Management](#lifecycle-management)
- [Dynamic Scaling](#dynamic-scaling)
- [Zero-Downtime Restarts](#zero-downtime-restarts)
- [Signal Handling](#signal-handling)
- [Worker Management](#worker-management)
- [Monitoring](#monitoring)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)

## Overview

Bungate's cluster mode enables multi-process architecture to:

- ✅ **Maximize CPU utilization** - Use all available cores
- ✅ **Improve throughput** - Handle more concurrent requests
- ✅ **Increase reliability** - Automatic worker respawn
- ✅ **Enable zero-downtime** - Rolling restarts
- ✅ **Support dynamic scaling** - Add/remove workers on demand

### Architecture

```
┌─────────────────────────────────────┐
│         Master Process              │
│  - Manages worker lifecycle         │
│  - Handles signals (SIGUSR2, etc)   │
│  - Monitors worker health           │
└──────────┬──────────────────────────┘
           │
      ┌────┼─────┬─────┬─────┐
      │    │     │     │     │
   ┌──▼─┐ ┌▼──┐ ┌▼──┐ ┌▼──┐ ┌▼──┐
   │ W1 │ │W2 │ │W3 │ │W4 │ │W5 │  Workers
   └────┘ └───┘ └───┘ └───┘ └───┘
   - Handle requests
   - Independent processes
   - Automatic respawn on crash
```

## Basic Setup

### Simple Cluster

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 4, // Number of worker processes
  },
})

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-service:3001',
})

await gateway.listen()
console.log('Cluster started with 4 workers')
```

### Auto-Detect CPU Cores

```typescript
import { BunGateway } from 'bungate'
import os from 'os'

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: os.cpus().length, // Use all available cores
  },
})

await gateway.listen()
```

### Production Configuration

```typescript
const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 4,
    restartWorkers: true, // Auto-respawn crashed workers
    maxRestarts: 10, // Max restarts per worker lifetime
    shutdownTimeout: 30000, // Graceful shutdown timeout (30s)
    restartDelay: 1000, // Base delay for exponential backoff
    respawnThreshold: 5, // Max restarts in time window
    respawnThresholdTime: 60000, // Time window for threshold (1 min)
    exitOnShutdown: true, // Exit master after shutdown
  },
})

await gateway.listen()
```

## Configuration Options

### Complete Configuration Reference

```typescript
interface ClusterConfig {
  // Enable multi-process mode
  enabled: boolean

  // Number of worker processes (default: CPU cores)
  workers: number

  // Auto-respawn crashed workers (default: true)
  restartWorkers: boolean

  // Base delay for exponential backoff (default: 1000ms)
  restartDelay: number

  // Max restarts per worker lifetime (default: 10)
  maxRestarts: number

  // Max restarts within time window (default: 5)
  respawnThreshold: number

  // Time window for respawn threshold (default: 60000ms)
  respawnThresholdTime: number

  // Grace period before force-kill (default: 30000ms)
  shutdownTimeout: number

  // Exit master process after shutdown (default: true)
  // Set to false for testing or embedded usage
  exitOnShutdown: boolean

  // Allow-list of environment variable names forwarded to workers.
  // If provided, only these variables (plus internal CLUSTER_* vars) are passed.
  allowedEnvVars?: string[]

  // Allow-list of worker script paths. The worker script must match one of
  // these paths to prevent accidental execution of arbitrary files.
  workerScriptAllowlist?: string[]
}
```

### Environment Variables

Workers automatically receive these environment variables:

```bash
CLUSTER_WORKER=true           # Indicates worker process
CLUSTER_WORKER_ID=1           # Worker ID (1, 2, 3, ...)
```

Use in your application:

```typescript
if (process.env.CLUSTER_WORKER === 'true') {
  console.log(`Worker ${process.env.CLUSTER_WORKER_ID} starting`)
}
```

## Lifecycle Management

### Worker Lifecycle

```
┌─────────────┐
│   Starting  │
└──────┬──────┘
       │
       ▼
┌─────────────┐     Crash      ┌─────────────┐
│   Running   ├───────────────►│  Respawning │
└──────┬──────┘                └──────┬──────┘
       │                              │
       │ SIGTERM                      │ Too many
       ▼                              │ restarts
┌─────────────┐                       │
│  Stopping   │                       │
└──────┬──────┘                       │
       │                              │
       ▼                              ▼
┌─────────────┐                ┌─────────────┐
│   Stopped   │◄───────────────┤   Failed    │
└─────────────┘                └─────────────┘
```

### Worker Restart Policy

Workers are automatically restarted with exponential backoff:

```typescript
// First restart: immediate
// Second restart: 1s delay
// Third restart: 2s delay
// Fourth restart: 4s delay (with jitter)
// ...

// If respawnThreshold (5) is exceeded within
// respawnThresholdTime (60s), worker is not restarted
```

## Dynamic Scaling

### Using ClusterManager Directly

For advanced control, use `ClusterManager`:

```typescript
import { ClusterManager, BunGateLogger } from 'bungate'

const logger = new BunGateLogger({ level: 'info' })

const cluster = new ClusterManager(
  {
    enabled: true,
    workers: 4,
    restartWorkers: true,
    maxRestarts: 10,
    shutdownTimeout: 30000,
  },
  logger,
  './gateway.ts', // Worker entry point
)

await cluster.start()

// Dynamic scaling
await cluster.scaleUp(2) // Add 2 workers
await cluster.scaleDown(1) // Remove 1 worker
await cluster.scaleTo(6) // Set exact worker count

// Worker information
console.log('Worker count:', cluster.getWorkerCount())
console.log('Worker info:', cluster.getWorkerInfo())

// Signal management
cluster.broadcastSignal('SIGHUP') // Signal all workers
cluster.sendSignalToWorker(1, 'SIGHUP') // Signal specific worker
```

### Scale Based on Load

```typescript
import { ClusterManager } from 'bungate'
import os from 'os'

const cluster = new ClusterManager(
  { enabled: true, workers: 2 },
  logger,
  './gateway.ts',
)

await cluster.start()

// Monitor system load and scale
setInterval(async () => {
  const loadAvg = os.loadavg()[0]
  const currentWorkers = cluster.getWorkerCount()
  const cpuCount = os.cpus().length

  // Scale up if load is high
  if (loadAvg > cpuCount * 0.7 && currentWorkers < cpuCount) {
    console.log('High load detected, scaling up...')
    await cluster.scaleUp(1)
  }

  // Scale down if load is low
  if (loadAvg < cpuCount * 0.3 && currentWorkers > 2) {
    console.log('Low load detected, scaling down...')
    await cluster.scaleDown(1)
  }
}, 30000) // Check every 30 seconds
```

### Scale Based on Metrics

```typescript
// Track request count
let requestCount = 0
setInterval(() => {
  const requestsPerSecond = requestCount / 10
  requestCount = 0

  const workers = cluster.getWorkerCount()

  // Scale up if > 1000 req/s per worker
  if (requestsPerSecond / workers > 1000 && workers < 10) {
    cluster.scaleUp(1)
  }

  // Scale down if < 200 req/s per worker
  if (requestsPerSecond / workers < 200 && workers > 2) {
    cluster.scaleDown(1)
  }
}, 10000)
```

## Zero-Downtime Restarts

### Rolling Restart with SIGUSR2

Signal the master process to perform a rolling restart:

```bash
# Find master process
ps aux | grep bungate

# Send SIGUSR2 to master process
kill -USR2 <MASTER_PID>
```

**How it works:**

1. Master spawns a replacement worker
2. New worker starts accepting requests
3. Old worker receives SIGTERM
4. Old worker stops accepting new requests
5. Old worker completes in-flight requests
6. Old worker exits
7. Process repeats for each worker

### Programmatic Rolling Restart

```typescript
import { ClusterManager } from 'bungate'

const cluster = new ClusterManager(
  { enabled: true, workers: 4 },
  logger,
  './gateway.ts',
)

await cluster.start()

// Trigger rolling restart
async function rollingRestart() {
  const workers = cluster.getWorkerInfo()

  for (const worker of workers) {
    console.log(`Restarting worker ${worker.id}...`)

    // Spawn new worker first
    await cluster.scaleUp(1)

    // Wait for new worker to be healthy
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Gracefully stop old worker
    cluster.sendSignalToWorker(worker.id, 'SIGTERM')

    // Wait for graceful shutdown
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  console.log('Rolling restart complete')
}

// Trigger restart
await rollingRestart()
```

## Signal Handling

### Supported Signals

```typescript
// SIGUSR2 - Rolling restart
// Master spawns replacement before stopping old worker
kill - USR2<MASTER_PID>

// SIGTERM - Graceful shutdown
// Workers complete in-flight requests, then exit
kill - TERM<MASTER_PID>

// SIGINT - Graceful shutdown (Ctrl+C)
// Same as SIGTERM
kill - INT<MASTER_PID>

// SIGHUP - Custom signal (application-defined)
// Example: reload configuration
kill - HUP<MASTER_PID>
```

### Broadcast Custom Signals

```typescript
import { ClusterManager } from 'bungate'

const cluster = new ClusterManager(
  { enabled: true, workers: 4 },
  logger,
  './gateway.ts',
)

await cluster.start()

// Broadcast SIGHUP to all workers
cluster.broadcastSignal('SIGHUP')

// In worker process (gateway.ts), handle custom signals:
process.on('SIGHUP', () => {
  console.log('Received SIGHUP, reloading configuration...')
  // Reload configuration without restarting
  reloadConfig()
})
```

## Worker Management

### Get Worker Information

```typescript
const workers = cluster.getWorkerInfo()

workers.forEach((worker) => {
  console.log({
    id: worker.id, // Worker ID
    pid: worker.pid, // Process ID
    restarts: worker.restarts, // Number of restarts
    status: worker.status, // 'running', 'stopping', etc.
    uptime: Date.now() - worker.startedAt, // Uptime in ms
  })
})
```

### Monitor Worker Health

```typescript
import { ClusterManager } from 'bungate'

const cluster = new ClusterManager(
  { enabled: true, workers: 4 },
  logger,
  './gateway.ts',
)

// Monitor worker exits
cluster.on('worker-exit', (workerId, code, signal) => {
  console.log(`Worker ${workerId} exited with code ${code}`)

  if (code !== 0) {
    // Worker crashed
    logger.error({ workerId, code, signal }, 'Worker crashed')
    // Alert monitoring system
    sendAlert(`Worker ${workerId} crashed`)
  }
})

// Monitor worker spawns
cluster.on('worker-spawn', (workerId) => {
  console.log(`Worker ${workerId} spawned`)
})

await cluster.start()
```

### Handle Worker Failures

```typescript
const cluster = new ClusterManager(
  {
    enabled: true,
    workers: 4,
    restartWorkers: true,
    maxRestarts: 10,
    respawnThreshold: 5, // Max 5 restarts
    respawnThresholdTime: 60000, // within 1 minute
  },
  logger,
  './gateway.ts',
)

await cluster.start()

// If a worker crashes more than 5 times in 1 minute,
// it will not be restarted
```

## Monitoring

### Basic Monitoring

```typescript
import { BunGateway, BunGateLogger } from 'bungate'

const logger = new BunGateLogger({
  level: 'info',
  enableRequestLogging: true,
})

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 4,
  },
  logger,
  metrics: { enabled: true },
})

await gateway.listen()

// Monitor metrics endpoint
// http://localhost:3000/metrics
```

### Custom Monitoring

```typescript
import { ClusterManager } from 'bungate'

const cluster = new ClusterManager(
  { enabled: true, workers: 4 },
  logger,
  './gateway.ts',
)

await cluster.start()

// Periodic health check
setInterval(() => {
  const workers = cluster.getWorkerInfo()
  const healthy = workers.filter((w) => w.status === 'running')
  const crashed = workers.filter((w) => w.restarts > 0)

  console.log({
    totalWorkers: workers.length,
    healthy: healthy.length,
    crashed: crashed.length,
    averageRestarts:
      crashed.reduce((sum, w) => sum + w.restarts, 0) / crashed.length || 0,
  })

  // Alert if too many workers have crashed
  if (crashed.length > workers.length * 0.5) {
    logger.error('More than 50% of workers have crashed!')
    sendAlert('High worker crash rate')
  }
}, 60000) // Every minute
```

### Integration with Monitoring Systems

```typescript
// Prometheus metrics
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  cluster: {
    enabled: true,
    workers: 4,
  },
  metrics: { enabled: true },
})

// Metrics available at /metrics
// - bungate_workers_total
// - bungate_workers_restarts_total
// - bungate_workers_crashed_total
// - bungate_requests_total
// - bungate_request_duration_seconds

await gateway.listen()
```

## Best Practices

### 1. Use Appropriate Worker Count

```typescript
import os from 'os'

// ❌ DON'T over-provision
const gateway = new BunGateway({
  cluster: {
    enabled: true,
    workers: 100, // Too many!
  },
})

// ✅ DO match CPU cores (or slightly less)
const gateway = new BunGateway({
  cluster: {
    enabled: true,
    workers: Math.max(2, os.cpus().length - 1),
  },
})
```

### 2. Configure Graceful Shutdown

```typescript
const gateway = new BunGateway({
  cluster: {
    enabled: true,
    workers: 4,
    shutdownTimeout: 30000, // 30 seconds for graceful shutdown
  },
})

// In worker, handle shutdown gracefully
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully...')

  // Stop accepting new requests
  await gateway.close()

  // Wait for in-flight requests to complete
  // (handled automatically by Bungate)

  // Exit
  process.exit(0)
})
```

### 3. Implement Health Checks

```typescript
// Add health endpoint for load balancer
gateway.addRoute({
  pattern: '/health',
  handler: async () => {
    const workerId = process.env.CLUSTER_WORKER_ID
    return new Response(
      JSON.stringify({
        status: 'healthy',
        workerId,
        uptime: process.uptime(),
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  },
})
```

### 4. Monitor Worker Restarts

```typescript
const cluster = new ClusterManager(
  {
    enabled: true,
    workers: 4,
    maxRestarts: 10,
  },
  logger,
  './gateway.ts',
)

// Alert on excessive restarts
cluster.on('worker-exit', (workerId, code) => {
  const worker = cluster.getWorkerInfo().find((w) => w.id === workerId)

  if (worker && worker.restarts > 5) {
    logger.error(
      { workerId, restarts: worker.restarts },
      'Worker restarting frequently',
    )
    // Investigate root cause
  }
})

await cluster.start()
```

### 5. Use Rolling Restarts for Deployments

```bash
# Deploy new version
git pull
bun install

# Trigger rolling restart (zero downtime)
kill -USR2 $(pgrep -f "bungate master")

# Or use process manager
pm2 reload bungate
```

### 6. Separate Static State

```typescript
// ❌ DON'T store state in worker memory
let requestCount = 0

gateway.addRoute({
  pattern: '/api/*',
  handler: async (req) => {
    requestCount++ // Lost on worker restart!
    // ...
  },
})

// ✅ DO use shared storage
import { Redis } from 'ioredis'
const redis = new Redis()

gateway.addRoute({
  pattern: '/api/*',
  handler: async (req) => {
    await redis.incr('request_count')
    // ...
  },
})
```

## Troubleshooting

### Workers Keep Crashing

**Problem**: Workers restart repeatedly

**Solutions:**

```typescript
// 1. Check restart configuration
cluster: {
  enabled: true,
  workers: 4,
  maxRestarts: 10,
  respawnThreshold: 5,
  respawnThresholdTime: 60000,
}

// 2. Add error handling in worker
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception')
  // Don't exit immediately
})

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection')
})

// 3. Check logs for errors
// Workers should log errors before crashing

// 4. Monitor resource usage
// Workers might be OOM (out of memory)
```

### Rolling Restart Not Working

**Problem**: SIGUSR2 doesn't trigger restart

**Solutions:**

```bash
# 1. Verify master process is running
ps aux | grep bungate

# 2. Send signal to correct process (master, not worker)
ps aux | grep "bungate master"
kill -USR2 <MASTER_PID>

# 3. Check logs for restart messages
tail -f bungate.log

# 4. Verify signal handling is enabled
# (enabled by default in BunGateway)
```

### High Memory Usage

**Problem**: Workers consume too much memory

**Solutions:**

```typescript
// 1. Reduce worker count
cluster: {
  workers: 2, // Instead of 8
}

// 2. Implement memory limits
// In Docker:
// docker run --memory=512m ...

// 3. Monitor memory per worker
setInterval(() => {
  const memUsage = process.memoryUsage()
  console.log({
    workerId: process.env.CLUSTER_WORKER_ID,
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
    rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
  })
}, 60000)

// 4. Check for memory leaks
// Use Bun's built-in profiler
```

### Port Already in Use

**Problem**: `Error: listen EADDRINUSE: address already in use`

**Solutions:**

```bash
# 1. Kill existing process
lsof -ti:3000 | xargs kill -9

# 2. Use different port
const gateway = new BunGateway({
  server: { port: 3001 },
})

# 3. Check for zombie processes
ps aux | grep bungate
kill -9 <PID>
```

## Related Documentation

- **[Quick Start](./QUICK_START.md)** - Get started with Bungate
- **[Load Balancing](./LOAD_BALANCING.md)** - Load balancing strategies
- **[Security Guide](./SECURITY.md)** - Security features
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Common issues
- **[API Reference](./API_REFERENCE.md)** - Complete API docs

---

**Need help?** Check [Troubleshooting](./TROUBLESHOOTING.md) or [open an issue](https://github.com/BackendStack21/bungate/issues).

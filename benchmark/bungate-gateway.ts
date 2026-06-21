/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FOR BENCHMARKING ONLY — NOT FOR PRODUCTION
 * This file intentionally disables security features to maximize throughput.
 * Do not use this configuration as a template for production deployments.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { BunGateway } from './src'
import { BunGateLogger } from './src'
import { cpus } from 'os'

const port = parseInt(process.env.GATEWAY_PORT || '3000')
const targetsEnv =
  process.env.TARGETS ||
  'http://echo-server-1:8080,http://echo-server-2:8080,http://echo-server-3:8080'
const targets = targetsEnv
  .split(',')
  .map((url) => ({ url: url.trim(), weight: 1 }))

console.log(
  `BunGate starting with targets: ${targets.map((t) => t.url).join(', ')}`,
)

const logger = new BunGateLogger({
  level: 'error', // Reduce logging overhead during benchmarks
  enableRequestLogging: false, // Disable request logging for performance
  enableMetrics: false, // Disable metrics logging for performance
})

const gateway = new BunGateway({
  server: {
    port,
    development: false,
  },
  logger,
  cluster: {
    enabled: true,
    workers: 4,
    restartWorkers: true,
    maxRestarts: 10,
    restartDelay: 1000,
    shutdownTimeout: 30000,
  },
})

// Add round-robin load balancing route
gateway.addRoute({
  pattern: '/*',
  loadBalancer: {
    healthCheck: {
      enabled: true,
      interval: 10000, // Check every 10 seconds
      timeout: 5000, // 5 second timeout
      path: '/health',
    },
    targets,
    strategy: 'round-robin',
  },
})

// Start the gateway
await gateway.listen(port)
console.log(`BunGate gateway running on http://localhost:${port}`)
console.log(`Load balancing strategy: round-robin`)
console.log(`Targets: ${targets.length}`)

// Graceful shutdown
const shutdown = async () => {
  console.log('\nShutting down BunGate gateway...')
  await gateway.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

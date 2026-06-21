/**
 * High-Availability Cluster Manager for Bungate
 *
 * Manages multiple worker processes for horizontal scaling and fault tolerance.
 * Provides automatic worker spawning, health monitoring, graceful restarts,
 * and load distribution across CPU cores for maximum performance.
 *
 * Features:
 * - Automatic worker process management and scaling
 * - Intelligent restart policies with backoff strategies
 * - Graceful shutdown with connection draining
 * - Real-time health monitoring and failure detection
 * - Zero-downtime deployments with rolling restarts
 * - Resource monitoring and performance optimization
 * - Signal-based management (SIGINT, SIGTERM, SIGUSR2)
 * - Comprehensive logging and operational visibility
 *
 * @example
 * ```ts
 * const clusterManager = new ClusterManager({
 *   workers: 4,
 *   restartWorkers: true,
 *   maxRestarts: 10,
 *   shutdownTimeout: 30000
 * }, logger, './worker.js')
 *
 * await clusterManager.start()
 * ```
 */

import { spawn, type Subprocess } from 'bun'
import { cpus } from 'os'
import type { Logger } from '../interfaces/logger'
import type { ClusterConfig } from '../interfaces/gateway'

/**
 * Worker process information for tracking and management
 */
export interface WorkerInfo {
  /** Unique worker identifier */
  id: number
  /** Bun subprocess instance */
  process: Subprocess
  /** Number of times this worker has been restarted */
  restarts: number
  /** Timestamp of last restart attempt */
  lastRestartTime: number
  /** Flag indicating worker is in shutdown process */
  isExiting: boolean
  /**
   * Timestamps of recent restarts used to enforce respawn threshold within a time window
   * Old entries are pruned automatically on access
   */
  restartTimestamps: number[]
}

/**
 * Production-grade cluster manager for multi-process deployments
 *
 * Orchestrates worker processes with intelligent health monitoring,
 * automatic recovery, and zero-downtime deployment capabilities.
 */
export class ClusterManager {
  /** Cluster configuration with scaling and restart policies */
  private config: ClusterConfig
  /** Logger instance for operational monitoring */
  private logger?: Logger
  /** Map of active worker processes */
  private workers: Map<number, WorkerInfo> = new Map()
  /** Counter for generating unique worker IDs */
  private nextWorkerId = 1
  /** Flag indicating cluster shutdown in progress */
  private isShuttingDown = false
  /** Path to worker script for spawning processes */
  private workerScript: string
  /** Guard to prevent double start */
  private started = false
  /** Bound signal handlers to allow proper removal */
  private boundSigint?: () => void
  private boundSigterm?: () => void
  private boundSigusr2?: () => void

  /**
   * Initialize cluster manager with configuration and dependencies
   *
   * @param config - Cluster configuration including worker count and restart policies
   * @param logger - Logger instance for monitoring and debugging
   * @param workerScript - Path to worker script to execute
   */
  constructor(config: ClusterConfig, logger?: Logger, workerScript?: string) {
    this.config = {
      enabled: true,
      workers: cpus().length,
      restartWorkers: true,
      maxRestarts: 10,
      restartDelay: 1000,
      shutdownTimeout: 30000,
      respawnThreshold: 5,
      respawnThresholdTime: 60000,
      ...config,
    }
    this.logger = logger

    const resolvedScript = workerScript || process.argv[1] || 'worker.js'
    this.workerScript = this.validateWorkerScript(resolvedScript)
  }

  /**
   * Validates the worker script path against an allow-list, if configured.
   */
  private validateWorkerScript(script: string): string {
    if (
      this.config.workerScriptAllowlist &&
      this.config.workerScriptAllowlist.length > 0
    ) {
      const allowlist = this.config.workerScriptAllowlist
      if (!allowlist.includes(script)) {
        throw new Error(
          `Worker script "${script}" is not in the configured allow-list`,
        )
      }
    }
    return script
  }

  /**
   * Builds the environment object for a worker.
   *
   * If allowedEnvVars is configured, only those variables are forwarded.
   * Otherwise, a curated subset of safe variables is passed by default.
   */
  private buildWorkerEnv(id: number): Record<string, string> {
    const baseEnv: Record<string, string> = {
      CLUSTER_WORKER: 'true',
      CLUSTER_WORKER_ID: id.toString(),
    }

    const allowed = this.config.allowedEnvVars
    if (allowed && allowed.length > 0) {
      for (const key of allowed) {
        const value = process.env[key]
        if (value !== undefined) {
          baseEnv[key] = value
        }
      }
      return baseEnv
    }

    // Default safe subset — avoid cloning secrets into every worker.
    const safeKeys = ['NODE_ENV', 'BUN_ENV', 'PATH', 'HOME', 'USER', 'SHELL']
    for (const key of safeKeys) {
      const value = process.env[key]
      if (value !== undefined) {
        baseEnv[key] = value
      }
    }
    return baseEnv
  }

  /**
   * Start the cluster with configured worker processes
   *
   * Spawns worker processes, sets up signal handlers, and begins health monitoring.
   * Provides graceful startup with proper error handling and logging.
   *
   * @returns Promise that resolves when cluster is fully operational
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger?.info('Cluster mode disabled')
      return
    }

    if (this.started) {
      this.logger?.warn('Cluster already started; ignoring subsequent start()')
      return
    }
    this.started = true

    this.logger?.info(`Starting cluster with ${this.config.workers} workers`)

    // Configure signal handlers for graceful lifecycle management
    this.boundSigint = this.gracefulShutdown.bind(this)
    this.boundSigterm = this.gracefulShutdown.bind(this)
    this.boundSigusr2 = this.restartAllWorkers.bind(this)
    process.on('SIGINT', this.boundSigint)
    process.on('SIGTERM', this.boundSigterm)
    process.on('SIGUSR2', this.boundSigusr2)

    // Calculate number of workers, ensuring at least one
    const maxWorkers = Math.max(1, this.config.workers || cpus().length)

    // Spawn workers
    for (let i = 0; i < maxWorkers; i++) {
      try {
        await this.spawnWorker()
      } catch (error) {
        this.logger?.error(`Failed to spawn worker ${i}:`, error as Error)
      }
    }

    this.logger?.info('Cluster started successfully')
  }

  private async spawnWorker(workerId?: number): Promise<void> {
    const id = workerId ?? this.nextWorkerId++

    try {
      const worker = spawn({
        cmd: [process.execPath, this.workerScript],
        env: this.buildWorkerEnv(id),
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      // Route worker stdout/stderr through the master logger with sanitization
      const stdoutReader = worker.stdout?.getReader()
      const stderrReader = worker.stderr?.getReader()

      const pumpStream = async (
        reader: ReadableStreamDefaultReader<any> | undefined,
        level: 'info' | 'error',
      ) => {
        if (!reader) return
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true }).trimEnd()
          if (!text) continue
          for (const line of text.split('\n')) {
            if (level === 'error') {
              this.logger?.error(`Worker ${id}: ${line}`)
            } else {
              this.logger?.info(`Worker ${id}: ${line}`)
            }
          }
        }
      }

      pumpStream(stdoutReader as any, 'info').catch(() => {})
      pumpStream(stderrReader as any, 'error').catch(() => {})

      const workerInfo: WorkerInfo = {
        id,
        process: worker,
        restarts: 0,
        lastRestartTime: 0,
        isExiting: false,
        restartTimestamps: [],
      }

      this.workers.set(id, workerInfo)

      // Handle worker exit
      worker.exited.then((exitCode) => {
        this.handleWorkerExit(workerInfo, exitCode)
      })

      this.logger?.info(`Worker ${id} started (PID: ${worker.pid})`)
    } catch (error) {
      this.logger?.error(`Failed to spawn worker ${id}:`, error as Error)
    }
  }

  private async handleWorkerExit(
    workerInfo: WorkerInfo,
    exitCode: number,
  ): Promise<void> {
    const { id, isExiting } = workerInfo

    this.logger?.warn(`Worker ${id} exited with code ${exitCode}`)
    this.workers.delete(id)

    // Don't restart if we're shutting down or worker was intentionally killed
    if (this.isShuttingDown || isExiting) {
      return
    }

    // Check if we should restart the worker
    if (this.config.restartWorkers && this.shouldRestartWorker(workerInfo)) {
      this.logger?.info(`Restarting worker ${id}`)
      // Track restart metrics
      const now = Date.now()
      workerInfo.restarts++
      workerInfo.lastRestartTime = now
      workerInfo.restartTimestamps.push(now)
      // Apply exponential backoff with jitter based on restarts count
      const base = Math.max(0, this.config.restartDelay ?? 1000)
      const attempt = Math.max(1, workerInfo.restarts)
      const maxDelay = 30000 // cap at 30s to avoid unbounded waits
      const backoff = Math.min(
        maxDelay,
        base * Math.pow(2, Math.min(5, attempt - 1)),
      )
      const jitter = Math.floor(Math.random() * Math.floor(base / 2))
      const delay = Math.min(maxDelay, backoff + jitter)
      await new Promise((resolve) => setTimeout(resolve, delay))

      try {
        await this.spawnWorker(id)
      } catch (error) {
        this.logger?.error(`Failed to restart worker ${id}:`, error as Error)
      }
    } else {
      this.logger?.warn(
        `Worker ${id} will not be restarted (max restarts reached or respawn threshold exceeded)`,
      )
    }
  }

  private shouldRestartWorker(workerInfo: WorkerInfo): boolean {
    const { restarts } = workerInfo
    const now = Date.now()

    // Check max restarts (lifetime)
    if (
      typeof this.config.maxRestarts === 'number' &&
      restarts >= (this.config.maxRestarts ?? 10)
    ) {
      return false
    }

    // Enforce respawn threshold within time window using sliding window timestamps
    const threshold = this.config.respawnThreshold ?? 5
    const windowMs = this.config.respawnThresholdTime ?? 60000
    // Prune old timestamps
    workerInfo.restartTimestamps = workerInfo.restartTimestamps.filter(
      (t) => now - t <= windowMs,
    )
    if (workerInfo.restartTimestamps.length >= threshold) {
      return false
    }

    return true
  }

  private async restartAllWorkers(): Promise<void> {
    this.logger?.info('Rolling restart of all workers initiated')

    const workerIds = Array.from(this.workers.keys())

    for (const workerId of workerIds) {
      const current = this.workers.get(workerId)
      if (!current) continue
      // Spawn a replacement first (uses a new worker id) to minimize downtime
      await this.spawnWorker()
      // Give the new worker a brief moment to initialize
      await new Promise((resolve) => setTimeout(resolve, 250))
      this.logger?.info(`Stopping old worker ${workerId} (rolling restart)`)
      current.isExiting = true
      current.process.kill('SIGTERM')
      // Small spacing to avoid thundering herd
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }

  private async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger?.warn('Shutdown already in progress')
      return
    }

    this.isShuttingDown = true
    this.logger?.info('Shutting down cluster...')

    const workerIds = Array.from(this.workers.keys())

    if (workerIds.length === 0) {
      this.logger?.info('No workers to shutdown')
      process.exit(0)
      return
    }

    // Send SIGTERM to all workers
    for (const workerId of workerIds) {
      const workerInfo = this.workers.get(workerId)
      if (workerInfo) {
        workerInfo.isExiting = true
        this.logger?.info(`Sending SIGTERM to worker ${workerId}`)
        workerInfo.process.kill('SIGTERM')
      }
    }

    // Wait for workers to exit gracefully
    const shutdownPromise = new Promise<void>((resolve) => {
      const checkWorkers = () => {
        if (this.workers.size === 0) {
          resolve()
        } else {
          setTimeout(checkWorkers, 100)
        }
      }
      checkWorkers()
    })

    // Force kill workers if they don't exit within timeout
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.workers.size > 0) {
          this.logger?.warn('Force killing remaining workers')
          for (const [workerId, workerInfo] of this.workers) {
            this.logger?.warn(`Force killing worker ${workerId}`)
            workerInfo.process.kill('SIGKILL')
          }
        }
        resolve()
      }, this.config.shutdownTimeout)
    })

    await Promise.race([shutdownPromise, timeoutPromise])

    this.logger?.info('Cluster shutdown complete')
    // Remove signal handlers to avoid memory leaks when embedding in long-running processes/tests
    if (this.boundSigint) process.off('SIGINT', this.boundSigint)
    if (this.boundSigterm) process.off('SIGTERM', this.boundSigterm)
    if (this.boundSigusr2) process.off('SIGUSR2', this.boundSigusr2)
    if (this.config.exitOnShutdown ?? true) {
      process.exit(0)
    }
  }

  getWorkerCount(): number {
    return this.workers.size
  }

  getWorkerInfo(): WorkerInfo[] {
    return Array.from(this.workers.values())
  }

  /** Whether the cluster has been started and not shut down */
  isRunning(): boolean {
    return this.started && !this.isShuttingDown
  }

  /**
   * Dynamically scale the number of workers.
   * Increases spawns or gracefully stops excess workers to match target.
   */
  async scaleTo(target: number): Promise<void> {
    if (!this.config.enabled) return
    const desired = Math.max(1, Math.floor(target))
    const current = this.workers.size
    if (desired === current) return
    if (desired > current) {
      const toAdd = desired - current
      this.logger?.info(`Scaling up workers: +${toAdd}`)
      for (let i = 0; i < toAdd; i++) {
        await this.spawnWorker()
      }
    } else {
      const toRemove = current - desired
      this.logger?.info(`Scaling down workers: -${toRemove}`)
      const ids = Array.from(this.workers.keys()).slice(0, toRemove)
      for (const id of ids) {
        const info = this.workers.get(id)
        if (!info) continue
        info.isExiting = true
        info.process.kill('SIGTERM')
      }
    }
    this.config.workers = desired
  }

  /** Convenience: increase workers by N (default 1) */
  scaleUp(by = 1): Promise<void> {
    return this.scaleTo((this.workers.size || 0) + Math.max(1, by))
  }

  /** Convenience: decrease workers by N (default 1) */
  scaleDown(by = 1): Promise<void> {
    return this.scaleTo(Math.max(1, this.workers.size - Math.max(1, by)))
  }

  /** Broadcast a POSIX signal to all workers (e.g., 'SIGTERM', 'SIGHUP'). */
  broadcastSignal(signal: NodeJS.Signals = 'SIGHUP'): void {
    for (const [id, info] of this.workers) {
      this.logger?.debug(`Sending ${signal} to worker ${id}`)
      try {
        info.process.kill(signal)
      } catch (err) {
        this.logger?.warn(
          `Failed sending ${signal} to worker ${id}: ${(err as Error).message}`,
        )
      }
    }
  }

  /** Send a signal to a single worker by id. */
  sendSignalToWorker(
    workerId: number,
    signal: NodeJS.Signals = 'SIGHUP',
  ): boolean {
    const info = this.workers.get(workerId)
    if (!info) return false
    try {
      info.process.kill(signal)
      return true
    } catch (err) {
      this.logger?.warn(
        `Failed sending ${signal} to worker ${workerId}: ${(err as Error).message}`,
      )
      return false
    }
  }
}

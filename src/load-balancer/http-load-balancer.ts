/**
 * HTTP Load Balancer Implementation
 *
 * A high-performance load balancer that distributes incoming requests across multiple
 * backend targets using various strategies. Supports health checking, sticky sessions,
 * and comprehensive monitoring for production-grade API gateway deployments.
 *
 * Features:
 * - Multiple load balancing strategies (round-robin, least-connections, weighted, random, ip-hash)
 * - Automatic health checking with configurable intervals and validation
 * - Sticky session support for session affinity
 * - Real-time statistics and monitoring
 * - Circuit breaker pattern for fault tolerance
 * - Comprehensive logging and observability
 *
 * @example
 * ```ts
 * const loadBalancer = new HttpLoadBalancer({
 *   strategy: 'least-connections',
 *   targets: [
 *     { url: 'http://service1:3000', weight: 2 },
 *     { url: 'http://service2:3000', weight: 1 }
 *   ],
 *   healthCheck: { enabled: true, interval: 30000, path: '/health' }
 * })
 *
 * const target = loadBalancer.selectTarget(request)
 * ```
 */
import type {
  LoadBalancer,
  LoadBalancerConfig,
  LoadBalancerTarget,
  LoadBalancerStats,
} from '../interfaces/load-balancer'
import type { Logger } from '../interfaces/logger'
import { defaultLogger } from '../logger/pino-logger'
import { SessionManager } from '../security/session-manager'
import { isValidIP, isIPInCIDR, safeMerge } from '../security/utils'
import type { TrustedProxyValidator } from '../security/trusted-proxy'

/**
 * Internal target representation with runtime tracking data
 * Extends the base LoadBalancerTarget with operational metrics
 */
interface InternalTarget extends LoadBalancerTarget {
  /** Number of requests routed to this target */
  requests: number
  /** Number of failed requests to this target */
  errors: number
  /** Cumulative response time for average calculation */
  totalResponseTime: number
  /** Timestamp of last request to this target */
  lastUsed: number
  /** Consecutive health check failures (reset on success) */
  consecutiveFailures: number
  /** Consecutive health check successes (reset on failure) */
  consecutiveSuccesses: number
}

/**
 * Session tracking for sticky session functionality
 * Maintains client-to-target affinity for stateful applications
 *
 * Note: This interface is kept for backward compatibility.
 * New implementations should use SessionManager from security module.
 */
interface Session {
  /** Target URL this session is bound to */
  targetUrl: string
  /** Session creation timestamp */
  createdAt: number
  /** Session expiration timestamp */
  expiresAt: number
}

/** Minimum allowed health check interval (ms) */
const MIN_HEALTH_CHECK_INTERVAL = 1000
/** Maximum allowed health check interval (ms) */
const MAX_HEALTH_CHECK_INTERVAL = 300000
/** Maximum allowed health check timeout (ms) */
const MAX_HEALTH_CHECK_TIMEOUT = 60000
/** Maximum allowed failure/success thresholds */
const MAX_HEALTH_THRESHOLD = 20
/** Maximum health check response body read size (bytes) */
const MAX_HEALTH_CHECK_BODY_SIZE = 4096
/** Default sticky session cap */
const DEFAULT_STICKY_SESSION_MAX_SESSIONS = 10000

/**
 * Returns a cryptographically secure random integer in [0, max).
 */
function secureRandomInt(max: number): number {
  if (max <= 0) return 0
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return array[0]! % max
}

/**
 * Returns a cryptographically secure random number in [0, 1).
 */
function secureRandom(): number {
  const array = new Uint32Array(1)
  crypto.getRandomValues(array)
  return array[0]! / 0x100000000
}

/**
 * Production-ready HTTP Load Balancer Implementation
 *
 * Provides intelligent request distribution across multiple backend services
 * with enterprise-grade features for high-availability deployments.
 */
export class HttpLoadBalancer implements LoadBalancer {
  /** Map of target URLs to their internal tracking data */
  private targets = new Map<string, InternalTarget>()
  /** Load balancer configuration */
  private config: LoadBalancerConfig
  /** Current index for round-robin strategy */
  private currentIndex = 0
  /** Total number of requests processed */
  private totalRequests = 0
  /** Health check interval timer */
  private healthCheckInterval?: Timer
  /** Whether a health-check round is currently running */
  private healthCheckInProgress = false
  /** Session tracking for sticky sessions */
  private sessions = new Map<string, Session>()
  /** Session cleanup interval timer */
  private sessionCleanupInterval?: Timer
  /** Session manager for cryptographically secure session handling */
  private sessionManager?: SessionManager
  /** Maximum sticky sessions retained in memory */
  private stickySessionMaxSessions = DEFAULT_STICKY_SESSION_MAX_SESSIONS
  /** How to handle unknown sticky-session cookies */
  private stickySessionUnknownPolicy: 'ignore' | 'create' = 'ignore'
  /** Logger instance for monitoring and debugging */
  private logger: Logger
  /** Trusted proxy validator for secure client IP extraction */
  private trustedProxyValidator?: TrustedProxyValidator

  /**
   * Initialize the load balancer with configuration and start background services
   *
   * @param config - Load balancer configuration including strategy, targets, and options
   */
  constructor(config: LoadBalancerConfig) {
    this.config = safeMerge(
      {
        strategy: 'round-robin',
        targets: [],
      } as LoadBalancerConfig,
      config,
    )
    this.logger = config.logger ?? defaultLogger
    this.trustedProxyValidator = config.trustedProxyValidator

    // Validate and clamp health-check configuration
    this.validateHealthCheckConfig()

    // Apply sticky-session bounds
    if (config.stickySession?.enabled) {
      this.stickySessionMaxSessions = Math.max(
        1,
        config.stickySession.maxSessions ?? DEFAULT_STICKY_SESSION_MAX_SESSIONS,
      )
      this.stickySessionUnknownPolicy =
        config.stickySession.unknownCookiePolicy ?? 'ignore'
    }

    this.logger.info('Load balancer initialized', {
      strategy: config.strategy,
      targetCount: config.targets.length,
      healthCheckEnabled: config.healthCheck?.enabled,
      stickySessionEnabled: config.stickySession?.enabled,
      trustedProxyEnabled: !!this.trustedProxyValidator,
    })

    // Initialize all configured targets.
    // Targets supplied at construction time default to healthy so the gateway
    // can serve traffic immediately. Runtime-added targets (via addTarget) are
    // treated more cautiously.
    for (const target of config.targets) {
      const initialTarget: LoadBalancerTarget = {
        ...target,
        // Respect an explicitly-provided healthy flag (used by tests and by
        // config reloads). When omitted, default to healthy so the gateway can
        // serve traffic immediately.
        healthy: (target as LoadBalancerTarget).healthy ?? true,
      }
      this.addTarget(initialTarget, true)
    }

    // Start health monitoring if enabled
    if (config.healthCheck?.enabled) {
      this.startHealthChecks()
    }

    // Start session management if sticky sessions are enabled
    if (config.stickySession?.enabled) {
      // Initialize SessionManager for cryptographically secure session handling
      this.sessionManager = new SessionManager({
        entropyBits: 128, // Minimum required entropy
        ttl: config.stickySession.ttl ?? 3600000,
        cookieName: config.stickySession.cookieName ?? 'lb-session',
      })
      this.startSessionCleanup()
    }
  }

  /**
   * Validate and clamp health-check configuration to prevent DoS and logic errors.
   */
  private validateHealthCheckConfig(): void {
    const hc = this.config.healthCheck
    if (!hc?.enabled) return

    // Apply defaults first so missing fields do not produce NaN later.
    hc.interval ??= 10000
    hc.timeout ??= 5000
    hc.failureThreshold ??= 3
    hc.successThreshold ??= 2
    hc.minHealthyTargets ??= 1
    hc.path ??= '/health'

    let interval = hc.interval
    let timeout = hc.timeout

    if (interval < MIN_HEALTH_CHECK_INTERVAL) {
      this.logger.warn('Health check interval too low; clamping to minimum', {
        interval,
        min: MIN_HEALTH_CHECK_INTERVAL,
      })
      interval = MIN_HEALTH_CHECK_INTERVAL
    }
    if (interval > MAX_HEALTH_CHECK_INTERVAL) {
      this.logger.warn('Health check interval too high; clamping to maximum', {
        interval,
        max: MAX_HEALTH_CHECK_INTERVAL,
      })
      interval = MAX_HEALTH_CHECK_INTERVAL
    }
    if (timeout > MAX_HEALTH_CHECK_TIMEOUT) {
      this.logger.warn('Health check timeout too high; clamping to maximum', {
        timeout,
        max: MAX_HEALTH_CHECK_TIMEOUT,
      })
      timeout = MAX_HEALTH_CHECK_TIMEOUT
    }
    if (timeout >= interval) {
      this.logger.warn(
        'Health check timeout must be less than interval; adjusting',
        { timeout, interval },
      )
      timeout = Math.max(1, Math.floor(interval / 2))
    }

    hc.interval = interval
    hc.timeout = timeout

    if (hc.failureThreshold != null) {
      hc.failureThreshold = Math.min(
        Math.max(1, hc.failureThreshold),
        MAX_HEALTH_THRESHOLD,
      )
    }
    if (hc.successThreshold != null) {
      hc.successThreshold = Math.min(
        Math.max(1, hc.successThreshold),
        MAX_HEALTH_THRESHOLD,
      )
    }
  }

  /**
   * Select the optimal target for the incoming request
   *
   * Uses the configured load balancing strategy to distribute requests intelligently
   * across healthy targets. Supports sticky sessions for session affinity.
   *
   * @param request - The incoming HTTP request to route
   * @param clientIP - Optional pre-validated client IP from the gateway socket
   * @returns Selected target or null if no healthy targets available
   */
  selectTarget(request: Request, clientIP?: string): LoadBalancerTarget | null {
    const startTime = Date.now()
    const healthyTargets = this.getHealthyTargets()

    if (healthyTargets.length === 0) {
      this.logger.warn('No healthy targets available', {
        totalTargets: this.targets.size,
        strategy: this.config.strategy,
      })
      return null
    }

    // Fast path: only one healthy target
    if (healthyTargets.length === 1) {
      const only = healthyTargets[0]!
      this.recordRequest(only.url)
      this.logger.logLoadBalancing(this.config.strategy, only.url, {
        reason: 'single-healthy',
        duration: Date.now() - startTime,
        healthyTargets: 1,
      })
      return only
    }

    // Check for sticky session first
    let stickySetCookie: string | undefined
    if (this.config.stickySession?.enabled) {
      const stickyResult = this.getStickyTarget(request)
      if (stickyResult?.target) {
        this.recordRequest(stickyResult.target.url)
        // Refresh TTL and re-issue the cookie on every hit so active sessions
        // do not expire prematurely (V-19).
        stickySetCookie = this.refreshStickySession(stickyResult.sessionId!)
        this.logger.logLoadBalancing(
          this.config.strategy,
          stickyResult.target.url,
          {
            reason: 'sticky-session',
            duration: Date.now() - startTime,
            healthyTargets: healthyTargets.length,
          },
        )
        Object.defineProperty(stickyResult.target, '__stickySetCookie', {
          value: stickySetCookie,
          enumerable: false,
          configurable: true,
        })
        return stickyResult.target
      }
    }

    let selectedTarget: LoadBalancerTarget | null = null

    try {
      switch (this.config.strategy) {
        case 'round-robin':
          selectedTarget = this.selectRoundRobin(healthyTargets)
          break
        case 'least-connections':
          selectedTarget = this.selectLeastConnections(healthyTargets)
          break
        case 'weighted':
          selectedTarget = this.selectWeighted(healthyTargets)
          break
        case 'random':
          selectedTarget = this.selectRandom(healthyTargets)
          break
        case 'ip-hash':
          selectedTarget = this.selectIpHash(request, healthyTargets, clientIP)
          break
        case 'p2c':
        case 'power-of-two-choices':
          selectedTarget = this.selectPowerOfTwoChoices(healthyTargets)
          break
        case 'latency':
          selectedTarget = this.selectByLatency(healthyTargets)
          break
        case 'weighted-least-connections':
          selectedTarget = this.selectWeightedLeastConnections(healthyTargets)
          break
        default:
          selectedTarget = this.selectRoundRobin(healthyTargets)
      }
    } catch (error) {
      this.logger.error('Error selecting target', error as Error, {
        strategy: this.config.strategy,
        healthyTargets: healthyTargets.length,
      })
      return null
    }

    if (selectedTarget) {
      this.recordRequest(selectedTarget.url)

      // Create sticky session if enabled
      if (this.config.stickySession?.enabled) {
        stickySetCookie = this.createStickySession(request, selectedTarget)
      }

      this.logger.logLoadBalancing(this.config.strategy, selectedTarget.url, {
        duration: Date.now() - startTime,
        healthyTargets: healthyTargets.length,
        totalRequests: this.totalRequests,
      })

      // Attach Set-Cookie header via a non-enumerable property for the gateway
      // to consume. This avoids leaking sticky-session state in the returned object.
      if (stickySetCookie) {
        Object.defineProperty(selectedTarget, '__stickySetCookie', {
          value: stickySetCookie,
          enumerable: false,
          configurable: true,
        })
      }
    }

    return selectedTarget
  }

  /**
   * Retrieves the Set-Cookie header generated for the last sticky session,
   * if any. This is consumed by the gateway to send the cookie to the client.
   */
  getStickySessionCookie(target: LoadBalancerTarget): string | undefined {
    return (target as any).__stickySetCookie
  }

  /**
   * Add a new target to the load balancer pool
   *
   * Initializes tracking data and makes the target available for request routing.
   * Can be used for dynamic scaling by adding targets at runtime.
   *
   * @param target - Target configuration to add
   */
  addTarget(target: LoadBalancerTarget, isInitial = false): void {
    const weight = this.normalizeWeight(target.weight)

    const internalTarget: InternalTarget = {
      ...target,
      // Initial configuration targets are trusted and default to healthy so the
      // gateway can serve traffic immediately. Runtime-added targets default to
      // unhealthy when health checks are enabled until they pass probes.
      healthy:
        target.healthy ??
        (isInitial ? true : this.config.healthCheck?.enabled ? false : true),
      requests: 0,
      errors: 0,
      totalResponseTime: 0,
      lastUsed: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      weight,
      connections: target.connections ?? 0,
      averageResponseTime: target.averageResponseTime ?? 0,
    }

    this.targets.set(target.url, internalTarget)
  }

  /**
   * Validates and normalizes target weight.
   */
  private normalizeWeight(weight?: number): number {
    if (weight == null) return 1
    if (typeof weight !== 'number' || !isFinite(weight)) {
      this.logger.warn('Invalid target weight; defaulting to 1', { weight })
      return 1
    }
    if (weight <= 0) {
      this.logger.warn('Target weight must be positive; defaulting to 1', {
        weight,
      })
      return 1
    }
    return weight
  }

  /**
   * Remove a target from the load balancer pool
   *
   * Immediately stops routing requests to the specified target.
   * Useful for maintenance, scaling down, or handling failed services.
   *
   * @param url - Target URL to remove from the pool
   */
  removeTarget(url: string): void {
    this.targets.delete(url)
  }

  /**
   * Update the health status of a specific target
   *
   * Called by health checks or external monitoring systems to mark
   * targets as healthy or unhealthy, affecting routing decisions.
   *
   * @param url - Target URL to update
   * @param healthy - New health status
   */
  updateTargetHealth(url: string, healthy: boolean): void {
    const minHealthyTargets = Math.min(
      this.config.healthCheck?.minHealthyTargets ?? 1,
      Math.max(1, this.targets.size),
    )
    if (healthy) {
      this.applyHealthState(url, true)
    } else {
      this.updateTargetHealthWithFloor(url, false, minHealthyTargets)
    }
  }

  /**
   * Get all configured targets with their current status
   *
   * Returns complete target information including health status,
   * connection counts, and performance metrics.
   *
   * @returns Array of all targets with runtime data
   */
  getTargets(): LoadBalancerTarget[] {
    return Array.from(this.targets.values()).map((t) => this.sanitizeTarget(t))
  }

  /**
   * Get only healthy targets available for routing
   *
   * Filters out unhealthy targets that should not receive traffic.
   * Used internally by routing strategies and externally for monitoring.
   *
   * @returns Array of healthy targets ready to handle requests
   */
  getHealthyTargets(): LoadBalancerTarget[] {
    return Array.from(this.targets.values())
      .filter((target) => target.healthy)
      .map((t) => this.sanitizeTarget(t))
  }

  /**
   * Returns a shallow copy of a target with sensitive metadata stripped.
   */
  private sanitizeTarget(target: InternalTarget): LoadBalancerTarget {
    const sanitized: LoadBalancerTarget = {
      url: target.url,
      healthy: target.healthy,
      weight: target.weight,
      connections: target.connections,
      averageResponseTime: target.averageResponseTime,
      lastHealthCheck: target.lastHealthCheck,
    }
    // Only expose metadata if explicitly configured to do so
    if ((this.config as any).exposeMetadata && target.metadata) {
      sanitized.metadata = target.metadata
    }
    return sanitized
  }

  /**
   * Get comprehensive load balancer statistics
   *
   * Provides operational metrics for monitoring, alerting, and capacity planning.
   * Includes per-target statistics and overall performance data.
   *
   * @returns Statistics object with performance and health metrics
   */
  getStats(): LoadBalancerStats {
    const targetStats: Record<string, any> = {}

    for (const [url, target] of this.targets.entries()) {
      targetStats[url] = {
        requests: target.requests,
        errors: target.errors,
        averageResponseTime:
          target.requests > 0 ? target.totalResponseTime / target.requests : 0,
        lastUsed: target.lastUsed,
      }
    }

    return {
      totalRequests: this.totalRequests,
      targetStats,
      strategy: this.config.strategy,
      healthyTargets: this.getHealthyTargets().length,
      totalTargets: this.targets.size,
    }
  }

  /**
   * Start health checks
   */
  startHealthChecks(): void {
    if (!this.config.healthCheck?.enabled || this.healthCheckInterval) {
      return
    }

    const interval = this.config.healthCheck.interval!
    // Add jitter (up to 10% of interval) to prevent thundering herds
    const jitter = Math.floor(secureRandom() * interval * 0.1)
    this.healthCheckInterval = setInterval(() => {
      // Skip a round if the previous one is still running (V-14).
      if (!this.healthCheckInProgress) {
        this.performHealthChecks()
      }
    }, interval + jitter)
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = undefined
    }
  }

  /**
   * Record request and response time for a target
   */
  recordResponse(url: string, responseTime: number, isError = false): void {
    const target = this.targets.get(url)
    if (target) {
      target.totalResponseTime += responseTime
      if (target.requests > 0) {
        target.averageResponseTime = target.totalResponseTime / target.requests
      } else {
        target.averageResponseTime = 0
      }

      if (isError) {
        target.errors++
      }
    }
  }

  /**
   * Update target connections
   */
  updateConnections(url: string, connections: number): void {
    const target = this.targets.get(url)
    if (target) {
      target.connections = connections
    }
  }

  /**
   * Atomically increment the active connection count for a target.
   */
  incrementConnections(url: string): void {
    const target = this.targets.get(url)
    if (target) {
      target.connections = (target.connections ?? 0) + 1
    }
  }

  /**
   * Atomically decrement the active connection count for a target.
   */
  decrementConnections(url: string): void {
    const target = this.targets.get(url)
    if (target) {
      target.connections = Math.max(0, (target.connections ?? 0) - 1)
    }
  }

  /**
   * Destroy load balancer and cleanup resources
   */
  destroy(): void {
    this.stopHealthChecks()

    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval)
      this.sessionCleanupInterval = undefined
    }

    // Cleanup session manager
    if (this.sessionManager) {
      this.sessionManager.destroy()
      this.sessionManager = undefined
    }

    this.targets.clear()
    this.sessions.clear()
  }

  // Private methods for different strategies

  private selectRoundRobin(targets: LoadBalancerTarget[]): LoadBalancerTarget {
    if (targets.length === 0) {
      throw new Error('No targets available for round-robin selection')
    }
    const target = targets[this.currentIndex % targets.length]! // Guaranteed to exist due to length check
    this.currentIndex = (this.currentIndex + 1) % targets.length
    return target
  }

  private selectLeastConnections(
    targets: LoadBalancerTarget[],
  ): LoadBalancerTarget {
    if (targets.length === 0) {
      throw new Error('No targets available for least-connections selection')
    }
    return targets.reduce((least, current) => {
      const leastConnections = least.connections ?? 0
      const currentConnections = current.connections ?? 0
      return currentConnections < leastConnections ? current : least
    })
  }

  private selectWeighted(targets: LoadBalancerTarget[]): LoadBalancerTarget {
    if (targets.length === 0) {
      throw new Error('No targets available for weighted selection')
    }

    const totalWeight = targets.reduce(
      (sum, target) => sum + (target.weight ?? 1),
      0,
    )
    let random = secureRandom() * totalWeight

    for (const target of targets) {
      random -= target.weight ?? 1
      if (random <= 0) {
        return target
      }
    }

    return targets[0]! // Fallback - guaranteed to exist due to length check
  }

  private selectRandom(targets: LoadBalancerTarget[]): LoadBalancerTarget {
    if (targets.length === 0) {
      throw new Error('No targets available for random selection')
    }
    const randomIndex = secureRandomInt(targets.length)
    return targets[randomIndex]! // Guaranteed to exist due to length check
  }

  private selectIpHash(
    request: Request,
    targets: LoadBalancerTarget[],
    clientIP?: string,
  ): LoadBalancerTarget {
    if (targets.length === 0) {
      throw new Error('No targets available for IP hash selection')
    }
    const clientId = this.getClientId(request, clientIP)
    const hash = this.simpleHash(clientId)
    const index = hash % targets.length
    return targets[index]! // Guaranteed to exist due to length check
  }

  private selectPowerOfTwoChoices(
    targets: LoadBalancerTarget[],
  ): LoadBalancerTarget {
    // Sample two distinct targets at random and choose the better one by connections then latency
    const i = secureRandomInt(targets.length)
    let j = secureRandomInt(targets.length)
    if (j === i) j = (j + 1) % targets.length
    const a = targets[i]!
    const b = targets[j]!
    return this.betterByLoadThenLatency(a, b)
  }

  private selectByLatency(targets: LoadBalancerTarget[]): LoadBalancerTarget {
    // Choose the target with the smallest averageResponseTime; fallback to round-robin if missing data
    let best = targets[0]!
    let bestLatency = best.averageResponseTime ?? Number.POSITIVE_INFINITY
    for (let k = 1; k < targets.length; k++) {
      const t = targets[k]!
      const lat = t.averageResponseTime ?? Number.POSITIVE_INFINITY
      if (lat < bestLatency) {
        best = t
        bestLatency = lat
      }
    }
    if (!isFinite(bestLatency)) {
      // No latency data available yet
      return this.selectRoundRobin(targets)
    }
    return best
  }

  private selectWeightedLeastConnections(
    targets: LoadBalancerTarget[],
  ): LoadBalancerTarget {
    // Choose by minimal (connections + 1) / weight
    return targets.reduce((best, curr) => {
      const bestScore =
        (Math.max(0, best.connections ?? 0) + 1) / Math.max(1, best.weight ?? 1)
      const currScore =
        (Math.max(0, curr.connections ?? 0) + 1) / Math.max(1, curr.weight ?? 1)
      if (currScore < bestScore) return curr
      if (currScore === bestScore) return this.betterByLatency(best, curr)
      return best
    })
  }

  private betterByLatency(a: LoadBalancerTarget, b: LoadBalancerTarget) {
    const la = a.averageResponseTime ?? Number.POSITIVE_INFINITY
    const lb = b.averageResponseTime ?? Number.POSITIVE_INFINITY
    return la <= lb ? a : b
  }

  private betterByLoadThenLatency(
    a: LoadBalancerTarget,
    b: LoadBalancerTarget,
  ) {
    const ca = a.connections ?? 0
    const cb = b.connections ?? 0
    if (ca < cb) return a
    if (cb < ca) return b
    return this.betterByLatency(a, b)
  }

  private recordRequest(url: string): void {
    this.totalRequests++
    const target = this.targets.get(url)
    if (target) {
      target.requests++
      target.lastUsed = Date.now()
    }
  }

  private getStickyTarget(request: Request): {
    target: LoadBalancerTarget | null
    sessionId: string | null
  } {
    if (!this.config.stickySession?.enabled) {
      return { target: null, sessionId: null }
    }

    const sessionId = this.getSessionId(request)
    if (!sessionId) {
      return { target: null, sessionId: null }
    }

    const session = this.sessions.get(sessionId)
    if (!session || Date.now() > session.expiresAt) {
      // Unknown / expired session IDs are not allowed to create new affinity.
      return { target: null, sessionId: null }
    }

    const target = this.targets.get(session.targetUrl)
    return {
      target: target && target.healthy ? this.sanitizeTarget(target) : null,
      sessionId,
    }
  }

  private createStickySession(
    request: Request,
    target: LoadBalancerTarget,
  ): string | undefined {
    if (!this.config.stickySession?.enabled) {
      return undefined
    }

    const existingSessionId = this.getSessionId(request)

    // Unknown or expired session cookies must not be allowed to mint new
    // sessions unless explicitly configured (V-3). This prevents attackers
    // from flooding memory with random cookie values.
    if (existingSessionId && !this.sessions.has(existingSessionId)) {
      if (this.stickySessionUnknownPolicy === 'ignore') {
        return undefined
      }
    }

    // Enforce the maximum in-memory session cap (V-3).
    this.evictOldestSessionIfNeeded()

    // Generate a new cryptographically secure session ID server-side
    const sessionId = this.generateSessionId()
    const ttl = this.config.stickySession.ttl ?? 3600000 // 1 hour default

    const session: Session = {
      targetUrl: target.url,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
    }

    this.sessions.set(sessionId, session)
    return this.buildStickySetCookie(sessionId)
  }

  /**
   * Refresh an existing sticky session's TTL and return a new Set-Cookie header.
   */
  private refreshStickySession(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const ttl = this.config.stickySession?.ttl ?? 3600000
    session.expiresAt = Date.now() + ttl
    return this.buildStickySetCookie(sessionId)
  }

  /**
   * Evict the oldest session when the cap is reached.
   */
  private evictOldestSessionIfNeeded(): void {
    if (this.sessions.size < this.stickySessionMaxSessions) {
      return
    }
    let oldestId: string | null = null
    let oldestTime = Number.POSITIVE_INFINITY
    for (const [id, session] of this.sessions.entries()) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt
        oldestId = id
      }
    }
    if (oldestId) {
      this.sessions.delete(oldestId)
    }
  }

  private buildStickySetCookie(sessionId: string): string {
    const cookieName = this.config.stickySession?.cookieName ?? 'lb-session'
    const ttl = this.config.stickySession?.ttl ?? 3600000

    if (!/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(cookieName)) {
      throw new Error(`Invalid sticky-session cookie name: ${cookieName}`)
    }
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error(`Invalid sticky-session TTL: ${ttl}`)
    }

    const parts: string[] = [`${cookieName}=${sessionId}`]
    parts.push(`Max-Age=${Math.floor(ttl / 1000)}`)
    parts.push('Path=/')
    parts.push('HttpOnly')
    parts.push('Secure')
    parts.push('SameSite=Strict')
    return parts.join('; ')
  }

  private getSessionId(request: Request): string | null {
    const cookieName = this.config.stickySession?.cookieName ?? 'lb-session'
    const cookieHeader = request.headers.get('cookie')

    if (!cookieHeader) {
      return null
    }

    const cookies = cookieHeader.split(';').map((c) => c.trim())
    for (const cookie of cookies) {
      const idx = cookie.indexOf('=')
      if (idx === -1) continue
      const name = cookie.slice(0, idx).trim()
      const value = cookie.slice(idx + 1).trim()
      if (name === cookieName && value) {
        return value
      }
    }

    return null
  }

  private generateSessionId(): string {
    // Use SessionManager if available for cryptographically secure session IDs
    if (this.sessionManager) {
      return this.sessionManager.generateSessionId()
    }

    // Fallback: Generate with minimum 128 bits of entropy
    const array = new Uint8Array(16)
    crypto.getRandomValues(array)
    return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  private getClientId(request: Request, clientIP?: string): string {
    // Prefer the pre-validated client IP provided by the gateway socket
    if (clientIP && clientIP !== 'unknown') {
      return clientIP
    }

    // If a trusted proxy validator is enabled, use it for secure IP extraction
    if (this.trustedProxyValidator) {
      const directIP = 'unknown'
      const extractedIP = this.trustedProxyValidator.extractClientIP(
        request,
        directIP,
      )
      if (extractedIP && extractedIP !== 'unknown') {
        return extractedIP
      }
    }

    // Fallback to headers only as a last resort (not recommended in production)
    const headers = request.headers
    const xff = headers.get('x-forwarded-for')
    if (xff) {
      const parts = xff.split(',').map((ip) => ip.trim())
      const ip = parts[parts.length - 1]
      if (ip && isValidIP(ip)) return ip
    }
    const realIp =
      headers.get('x-real-ip') ||
      headers.get('cf-connecting-ip') ||
      headers.get('x-client-ip') ||
      ''
    if (realIp && isValidIP(realIp)) return realIp
    const userAgent = headers.get('user-agent') ?? ''
    const accept = headers.get('accept') ?? ''
    return userAgent + accept
  }

  private simpleHash(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Perform health checks with threshold-based state transitions.
   * Uses consecutive failure/success counts to prevent flapping and
   * enforces a minimum healthy target floor to prevent cascade failures.
   */
  private async performHealthChecks(): Promise<void> {
    const healthCheckConfig = this.config.healthCheck
    if (!healthCheckConfig?.enabled || this.healthCheckInProgress) {
      return
    }
    this.healthCheckInProgress = true

    const failureThreshold = healthCheckConfig.failureThreshold ?? 3
    const successThreshold = healthCheckConfig.successThreshold ?? 2
    const minHealthyTargets = Math.min(
      healthCheckConfig.minHealthyTargets ?? 1,
      Math.max(1, this.targets.size),
    )

    this.logger.debug('Starting health checks', {
      targetCount: this.targets.size,
      interval: healthCheckConfig.interval,
      timeout: healthCheckConfig.timeout,
      failureThreshold,
      successThreshold,
      minHealthyTargets,
    })

    const promises = Array.from(this.targets.values()).map(
      async (target: InternalTarget) => {
        const startTime = Date.now()
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        try {
          const url = new URL(target.url)

          // Validate scheme
          const allowedSchemes = healthCheckConfig.allowedSchemes ?? [
            'http',
            'https',
          ]
          if (!allowedSchemes.includes(url.protocol.replace(':', ''))) {
            throw new Error(
              `Health check URL scheme not allowed: ${url.protocol}`,
            )
          }

          // Validate host
          const allowedHosts = healthCheckConfig.allowedHosts
          if (allowedHosts && allowedHosts.length > 0) {
            const hostAllowed = allowedHosts.some((allowed) => {
              if (allowed.includes('/')) {
                return isIPInCIDR(url.hostname, allowed)
              }
              return url.hostname === allowed
            })
            if (!hostAllowed) {
              throw new Error(
                `Health check target host not allowed: ${url.hostname}`,
              )
            }
          }

          url.pathname = healthCheckConfig.path!

          const controller = new AbortController()
          timeoutId = setTimeout(
            () => controller.abort(),
            healthCheckConfig.timeout!,
          )

          const method = healthCheckConfig.method ?? 'GET'
          if (method !== 'GET' && method !== 'HEAD') {
            throw new Error(`Invalid health check method: ${method}`)
          }

          const response = await fetch(url.toString(), {
            signal: controller.signal,
            method,
            redirect: 'manual',
          })

          const duration = Date.now() - startTime

          const isHealthy =
            response.status === (healthCheckConfig.expectedStatus ?? 200)

          // Check response body if expected, with bounded read size.
          // The abort timeout is kept active until the body is fully consumed
          // so a slow-trickling response cannot hold the probe open forever (V-14).
          if (isHealthy && healthCheckConfig.expectedBody) {
            const body = await this.readBoundedResponse(
              response,
              MAX_HEALTH_CHECK_BODY_SIZE,
              controller.signal,
            )
            const bodyMatches = body.includes(healthCheckConfig.expectedBody)

            if (bodyMatches) {
              target.consecutiveSuccesses++
              target.consecutiveFailures = 0
            } else {
              target.consecutiveFailures++
              target.consecutiveSuccesses = 0
            }

            // Apply thresholds
            if (target.consecutiveFailures >= failureThreshold) {
              this.updateTargetHealthWithFloor(
                target.url,
                false,
                minHealthyTargets,
              )
            } else if (target.consecutiveSuccesses >= successThreshold) {
              this.applyHealthState(target.url, true)
            }

            this.logger.logHealthCheck(target.url, bodyMatches, duration)
          } else {
            if (isHealthy) {
              target.consecutiveSuccesses++
              target.consecutiveFailures = 0
            } else {
              target.consecutiveFailures++
              target.consecutiveSuccesses = 0
            }

            // Apply thresholds
            if (target.consecutiveFailures >= failureThreshold) {
              this.updateTargetHealthWithFloor(
                target.url,
                false,
                minHealthyTargets,
              )
            } else if (target.consecutiveSuccesses >= successThreshold) {
              this.applyHealthState(target.url, true)
            }

            this.logger.logHealthCheck(
              target.url,
              isHealthy,
              duration,
              !isHealthy ? new Error(`HTTP ${response.status}`) : undefined,
            )
          }
        } catch (error) {
          target.consecutiveFailures++
          target.consecutiveSuccesses = 0

          const duration = Date.now() - startTime

          // Only mark unhealthy after threshold is met
          if (target.consecutiveFailures >= failureThreshold) {
            this.updateTargetHealthWithFloor(
              target.url,
              false,
              minHealthyTargets,
            )
          }

          this.logger.logHealthCheck(
            target.url,
            false,
            duration,
            error as Error,
          )
        } finally {
          if (timeoutId) clearTimeout(timeoutId)
        }
      },
    )

    try {
      await Promise.allSettled(promises)
    } finally {
      this.healthCheckInProgress = false
    }
  }

  /**
   * Reads at most `maxBytes` from a response body to prevent memory exhaustion.
   */
  private async readBoundedResponse(
    response: Response,
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const reader = response.body?.getReader()
    if (!reader) {
      return ''
    }

    const onAbort = signal
      ? () => {
          try {
            reader.cancel('health check timeout')
          } catch {
            // ignore
          }
        }
      : undefined
    if (onAbort) signal!.addEventListener('abort', onAbort, { once: true })

    const chunks: Uint8Array[] = []
    let total = 0
    try {
      while (total < maxBytes) {
        const { done, value } = await reader.read()
        if (done || !value) break
        const remaining = maxBytes - total
        const chunk =
          value.length > remaining ? value.slice(0, remaining) : value
        chunks.push(chunk)
        total += chunk.length
      }
    } finally {
      if (onAbort) signal!.removeEventListener('abort', onAbort)
      reader.releaseLock()
    }

    const combined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.length
    }

    return new TextDecoder().decode(combined)
  }

  /**
   * Apply a health state change directly. Used for healthy transitions and
   * internal state updates that do not need floor enforcement.
   */
  private applyHealthState(url: string, healthy: boolean): void {
    const target = this.targets.get(url)
    if (target) {
      target.healthy = healthy
      target.lastHealthCheck = Date.now()
      if (healthy) {
        target.consecutiveFailures = 0
      } else {
        target.consecutiveSuccesses = 0
      }
    }
  }

  /**
   * Update target health with minimum healthy target floor.
   * Prevents cascade failures by ensuring at least minHealthy targets stay up.
   */
  private updateTargetHealthWithFloor(
    url: string,
    healthy: boolean,
    minHealthyTargets: number,
  ): void {
    if (healthy) {
      this.applyHealthState(url, true)
      return
    }

    // Count how many targets would remain healthy if we mark this one unhealthy
    let healthyCount = 0
    for (const [targetUrl, target] of this.targets.entries()) {
      if (targetUrl === url) continue
      if (target.healthy) healthyCount++
    }

    // Only enforce floor if there are still healthy targets left.
    // If all other targets are already unhealthy, let this one go too
    // (a full outage is real, not a cascade to prevent).
    if (healthyCount > 0 && healthyCount < minHealthyTargets) {
      this.logger.warn(
        `Not marking ${url} unhealthy: would leave only ${healthyCount} healthy targets (floor=${minHealthyTargets})`,
        { url, healthyCount, minHealthyTargets },
      )
      return // Refuse to mark unhealthy — would violate the floor
    }

    this.applyHealthState(url, false)
  }

  private startSessionCleanup(): void {
    if (this.sessionCleanupInterval) {
      return
    }

    // Clean up expired sessions every 5 minutes
    this.sessionCleanupInterval = setInterval(() => {
      const now = Date.now()

      // Clean up legacy sessions map
      for (const [sessionId, session] of this.sessions.entries()) {
        if (now > session.expiresAt) {
          this.sessions.delete(sessionId)
        }
      }

      // SessionManager has its own cleanup, but we can trigger it explicitly
      if (this.sessionManager) {
        this.sessionManager.cleanupExpiredSessions()
      }
    }, 300000)
  }
}

/**
 * Factory function to create load balancer
 */
export function createLoadBalancer(
  config: LoadBalancerConfig,
): HttpLoadBalancer {
  return new HttpLoadBalancer(config)
}

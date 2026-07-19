import type { Logger } from './logger'

/**
 * Represents a target server in the load balancer pool
 * Contains both configuration and runtime state information
 */
export interface LoadBalancerTarget {
  /**
   * Target service URL (including protocol, host, and port)
   * @example 'http://service1.internal:3000' or 'https://api.service.com'
   */
  url: string

  /**
   * Relative weight for weighted load balancing strategies
   * Higher values receive more traffic
   * @default 1
   * @example 5 (receives 5x more traffic than weight=1 targets)
   */
  weight?: number

  /**
   * Current health status of the target
   * Automatically updated by health checks
   * @default true
   */
  healthy?: boolean

  /**
   * Number of active connections to this target
   * Used by least-connections strategy
   * @default 0
   */
  connections?: number

  /**
   * Average response time in milliseconds
   * Used for performance-based routing decisions
   * @default 0
   */
  averageResponseTime?: number

  /**
   * Timestamp of the last successful health check
   * @default Date.now()
   */
  lastHealthCheck?: number

  /**
   * Additional metadata for this target
   * Can store custom properties for routing decisions
   * @example { region: 'us-east-1', datacenter: 'primary' }
   */
  metadata?: Record<string, any>
}

/**
 * Load balancer configuration for distributing requests across multiple targets
 * Supports various strategies and health checking capabilities
 */
export interface LoadBalancerConfig {
  /**
   * Load balancing strategy for request distribution
   * @default 'round-robin'
   */
  strategy:
    | 'round-robin' // Distributes requests evenly in rotation
    | 'least-connections' // Routes to target with fewest active connections
    | 'random' // Randomly selects a target
    | 'weighted' // Uses target weights for distribution
    | 'ip-hash' // Routes based on client IP hash for session affinity
    | 'p2c' // Power of two choices: pick best of two random targets
    | 'power-of-two-choices' // Alias for p2c
    | 'latency' // Chooses target with the lowest avg response time
    | 'weighted-least-connections' // Least connections normalized by weight

  /**
   * List of backend targets to load balance across
   * Runtime properties (healthy, connections, etc.) are managed automatically
   */
  targets: Omit<
    LoadBalancerTarget,
    'healthy' | 'lastHealthCheck' | 'connections' | 'averageResponseTime'
  >[]

  /**
   * Health check configuration for monitoring target availability
   */
  healthCheck?: {
    /**
     * Enable health checking
     * @default true
     */
    enabled: boolean
    /**
     * Health check interval in milliseconds
     * @default 30000 (30 seconds)
     */
    interval?: number
    /**
     * Health check request timeout in milliseconds
     * @default 5000 (5 seconds)
     */
    timeout?: number
    /**
     * Health check endpoint path
     * @default '/health'
     */
    path?: string
    /**
     * Expected HTTP status code for healthy response
     * @default 200
     */
    expectedStatus?: number
    /**
     * Expected response body content for validation
     * @example 'OK' or 'healthy'
     */
    expectedBody?: string
    /**
     * HTTP method to use for health checks
     * @default 'GET'
     */
    method?: 'GET' | 'HEAD'
    /**
     * Allowed target URL schemes for health checks.
     * @default ['http', 'https']
     */
    allowedSchemes?: string[]
    /**
     * Allowed target hosts/networks for health checks (CIDR or exact host).
     * If empty, all hosts are allowed.
     */
    allowedHosts?: string[]
    /**
     * Number of consecutive failures before marking target unhealthy
     * Prevents transient errors from flapping target state
     * @default 3
     */
    failureThreshold?: number
    /**
     * Number of consecutive successes before marking target healthy again
     * Prevents premature recovery from flapping
     * @default 2
     */
    successThreshold?: number
    /**
     * Minimum number of healthy targets to maintain
     * Prevents cascade failures where all targets go down at once
     * @default 1
     */
    minHealthyTargets?: number
  }

  /**
   * Sticky session configuration for session affinity
   * Ensures requests from the same client go to the same target
   */
  stickySession?: {
    /**
     * Enable sticky sessions
     * @default false
     */
    enabled: boolean
    /**
     * Cookie name for session tracking
     * @default 'lb-session'
     */
    cookieName?: string
    /**
     * Session TTL in milliseconds
     * @default 3600000 (1 hour)
     */
    ttl?: number
    /**
     * Maximum number of sticky sessions to retain in memory.
     * When the cap is reached, the oldest session is evicted.
     * @default 10000
     */
    maxSessions?: number
    /**
     * What to do when a client sends an unknown session cookie.
     * - 'ignore': treat as if no cookie was sent (default, prevents DoS).
     * - 'create': mint a new session for the unknown value.
     * @default 'ignore'
     */
    unknownCookiePolicy?: 'ignore' | 'create'
  }

  /**
   * Logger instance for load balancer operations and debugging
   */
  logger?: Logger

  /**
   * Trusted proxy validator for secure client IP extraction
   * Used for IP-based strategies and session affinity
   */
  trustedProxyValidator?: any // Using any to avoid circular dependency
}

export interface LoadBalancerStats {
  /**
   * Total number of requests
   */
  totalRequests: number

  /**
   * Requests per target
   */
  targetStats: Record<
    string,
    {
      requests: number
      errors: number
      averageResponseTime: number
      lastUsed: number
    }
  >

  /**
   * Current strategy
   */
  strategy: string

  /**
   * Number of healthy targets
   */
  healthyTargets: number

  /**
   * Number of total targets
   */
  totalTargets: number
}

export interface LoadBalancer {
  /**
   * Select next target based on strategy
   * @param request - The incoming HTTP request
   * @param clientIP - Optional pre-validated client IP from the gateway socket
   */
  selectTarget(request: Request, clientIP?: string): LoadBalancerTarget | null

  /**
   * Add a target to the load balancer
   */
  addTarget(target: LoadBalancerTarget): void

  /**
   * Remove a target from the load balancer
   */
  removeTarget(url: string): void

  /**
   * Update target health status
   */
  updateTargetHealth(url: string, healthy: boolean): void

  /**
   * Get all targets
   */
  getTargets(): LoadBalancerTarget[]

  /**
   * Get healthy targets only
   */
  getHealthyTargets(): LoadBalancerTarget[]

  /**
   * Get load balancer statistics
   */
  getStats(): LoadBalancerStats

  /**
   * Start health checks
   */
  startHealthChecks(): void

  /**
   * Stop health checks
   */
  stopHealthChecks(): void

  /**
   * Atomically increment the active connection count for a target.
   */
  incrementConnections(url: string): void

  /**
   * Atomically decrement the active connection count for a target.
   */
  decrementConnections(url: string): void
}

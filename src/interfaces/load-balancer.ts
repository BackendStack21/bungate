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
    interval: number
    /**
     * Health check request timeout in milliseconds
     * @default 5000 (5 seconds)
     */
    timeout: number
    /**
     * Health check endpoint path
     * @default '/health'
     */
    path: string
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
  }

  /**
   * Logger instance for load balancer operations and debugging
   */
  logger?: Logger
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
   */
  selectTarget(request: Request): LoadBalancerTarget | null

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
}

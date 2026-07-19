import type { Server } from 'bun'
import type { RouteConfig } from './route'
import type {
  BodyParserOptions,
  JWTAuthOptions,
  RateLimitOptions,
  RequestHandler,
  ZeroRequest,
} from './middleware'
import type { GatewayProxyOptions } from './proxy'
import type { Logger } from './logger'
import type { SecurityConfig } from '../security/config'

/**
 * Cluster configuration for multi-process gateway deployment
 * Enables horizontal scaling by spawning multiple worker processes
 */
export interface ClusterConfig {
  /**
   * Enable cluster mode for multi-process deployment
   * @default false
   */
  enabled?: boolean

  /**
   * Number of worker processes to spawn
   * @default os.cpus().length (number of CPU cores)
   */
  workers?: number

  /**
   * Automatically restart workers when they exit unexpectedly
   * @default true
   */
  restartWorkers?: boolean

  /**
   * Maximum number of restart attempts per worker before giving up
   * @default 10
   */
  maxRestarts?: number

  /**
   * Delay between worker restart attempts in milliseconds
   * @default 1000
   */
  restartDelay?: number

  /**
   * Maximum time to wait for graceful worker shutdown in milliseconds
   * @default 5000
   */
  shutdownTimeout?: number

  /**
   * Maximum worker deaths before stopping respawn attempts
   * If a worker dies more than this many times within the threshold time window,
   * it won't be respawned to prevent infinite restart loops
   * @default 5
   */
  respawnThreshold?: number

  /**
   * Time window for respawn threshold tracking in milliseconds
   * @default 60000 (1 minute)
   */
  respawnThresholdTime?: number

  /**
   * Exit the master process after graceful shutdown completes.
   * Set to false for test environments or embedded runners where exiting the
   * process is undesirable.
   * @default true
   */
  exitOnShutdown?: boolean

  /**
   * Allow-list of environment variable names to pass to workers.
   * If provided, only these variables (plus the internal CLUSTER_* vars)
   * are forwarded. This prevents secrets from being cloned into every worker.
   */
  allowedEnvVars?: string[]

  /**
   * Allow-list of worker script paths. If provided, the worker script must
   * match one of these paths to prevent accidental execution of arbitrary files.
   */
  workerScriptAllowlist?: string[]
}

/**
 * Main gateway configuration interface
 * Defines all available options for configuring the Bungate API Gateway
 */
export interface GatewayConfig {
  /**
   * Server configuration options
   */
  server?: {
    /**
     * Port number for the gateway server
     * @default 3000
     */
    port?: number
    /**
     * Hostname or IP address to bind to
     * @default "0.0.0.0"
     */
    hostname?: string
    /**
     * Enable development mode with enhanced debugging
     * @default false
     */
    development?: boolean
  }

  /**
   * Multi-process cluster configuration
   */
  cluster?: ClusterConfig

  /**
   * Default route handler for unmatched requests (404 handler)
   * Called when no registered routes match the incoming request
   * @example
   * ```ts
   * defaultRoute: (req) => new Response('Not Found', { status: 404 })
   * ```
   */
  defaultRoute?: (req: ZeroRequest) => Response | Promise<Response>

  /**
   * Global error handler for uncaught exceptions
   * Called when any route handler or middleware throws an error
   * @example
   * ```ts
   * errorHandler: (err) => new Response(err.message, { status: 500 })
   * ```
   */
  errorHandler?: (err: Error) => Response | Promise<Response>

  /**
   * Array of route configurations
   * Defines the routing rules and handlers for the gateway
   */
  routes?: RouteConfig[]

  /**
   * Global proxy configuration applied to all routes
   * Settings here can be overridden by individual route configurations
   */
  proxy?: GatewayProxyOptions

  /**
   * Cross-Origin Resource Sharing (CORS) configuration
   * Controls browser access from different origins
   */
  cors?: {
    /**
     * Allowed origins for cross-origin requests
     * @example
     * - `"*"` - Allow all origins
     * - `"https://example.com"` - Allow specific origin
     * - `["https://app1.com", "https://app2.com"]` - Allow multiple origins
     * - `(origin, req) => origin.endsWith(".mycompany.com")` - Dynamic validation
     */
    origin?:
      | string
      | string[]
      | boolean
      | ((origin: string, req: ZeroRequest) => boolean | string)
    /**
     * Allowed HTTP methods for CORS requests
     * @default ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"]
     */
    methods?: string[]
    /**
     * Headers that clients are allowed to send
     * @default ["Content-Type", "Authorization"]
     */
    allowedHeaders?: string[]
    /**
     * Headers exposed to the client
     * @default []
     */
    exposedHeaders?: string[]
    /**
     * Allow credentials (cookies, authorization headers)
     * @default false
     */
    credentials?: boolean
    /**
     * How long browsers can cache CORS information in seconds
     * @default 86400 (24 hours)
     */
    maxAge?: number
  }

  /**
   * Rate limiting configuration to prevent abuse
   * Protects against excessive requests from clients
   */
  rateLimit?: RateLimitOptions

  /**
   * JWT (JSON Web Token) authentication configuration
   * Enables token-based authentication for protected routes
   */
  auth?: JWTAuthOptions

  /**
   * Request body parsing configuration
   * Controls how request bodies are parsed and made available
   */
  bodyParser?: BodyParserOptions

  /**
   * Logging configuration and logger instance
   * Controls how gateway events and requests are logged
   */
  logger?: Logger

  /**
   * Health check endpoint configuration
   * Provides a simple health check endpoint for monitoring
   */
  healthCheck?: {
    /**
     * Path for the health check endpoint
     * @default "/health"
     */
    path?: string
    /**
     * Enable the health check endpoint
     * @default true
     */
    enabled?: boolean
  }

  /**
   * Metrics collection and Prometheus integration
   * Enables performance monitoring and observability
   */
  metrics?: {
    /**
     * Enable metrics collection
     * @default false
     */
    enabled?: boolean
    /**
     * Endpoint path for metrics exposure
     * @default "/metrics"
     */
    endpoint?: string
    /**
     * Collect default Node.js/Bun runtime metrics
     * @default true
     */
    collectDefaultMetrics?: boolean
  }

  /**
   * Security configuration for the gateway
   * Includes TLS, input validation, error handling, and more
   */
  security?: SecurityConfig
}

/**
 * Main Gateway interface following the 0http-bun router pattern
 * Provides a complete API gateway with routing, middleware, and proxy capabilities
 */
export interface Gateway {
  /**
   * Main fetch handler compatible with Bun.serve()
   * This is the core handler that processes all incoming HTTP requests
   * @param req - The incoming HTTP request
   * @returns Response or Promise that resolves to a Response
   */
  fetch: (req: Request) => Response | Promise<Response>

  /**
   * Register global middleware that applies to all routes
   * @param middleware - Middleware function to apply globally
   * @returns Gateway instance for method chaining
   * @example
   * ```ts
   * gateway.use(corsMiddleware)
   * ```
   */
  use(middleware: RequestHandler): this

  /**
   * Register middleware for a specific path pattern
   * @param pattern - URL pattern to match (supports wildcards and parameters)
   * @param middleware - Middleware function to apply to matching routes
   * @returns Gateway instance for method chaining
   * @example
   * ```ts
   * gateway.use('/api/*', authMiddleware)
   * ```
   */
  use(pattern: string, middleware: RequestHandler): this

  /**
   * Register multiple middlewares at once
   * @param middlewares - Array of middleware functions
   * @returns Gateway instance for method chaining
   * @example
   * ```ts
   * gateway.use(corsMiddleware, authMiddleware, loggingMiddleware)
   * ```
   */
  use(...middlewares: RequestHandler[]): this

  /**
   * Register route handler for specific HTTP method and pattern
   * @param method - HTTP method (GET, POST, PUT, etc.)
   * @param pattern - URL pattern with optional parameters (e.g., '/users/:id')
   * @param handlers - Route handler functions (middleware and final handler)
   * @returns Gateway instance for method chaining
   * @example
   * ```ts
   * gateway.on('GET', '/users/:id', validateAuth, getUserHandler)
   * ```
   */
  on(method: string, pattern: string, ...handlers: RequestHandler[]): this

  /**
   * HTTP method convenience methods for route registration
   * Each method registers a route for the specific HTTP verb
   */

  /**
   * Register GET route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   * @example
   * ```ts
   * gateway.get('/users', getAllUsers)
   * gateway.get('/users/:id', getUser)
   * ```
   */
  get(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register POST route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  post(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register PUT route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  put(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register PATCH route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  patch(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register DELETE route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  delete(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register HEAD route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  head(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register OPTIONS route handler
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  options(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Register route handler for all HTTP methods
   * @param pattern - URL pattern to match
   * @param handlers - Route handler functions
   */
  all(pattern: string, ...handlers: RequestHandler[]): this

  /**
   * Add a complete route configuration dynamically at runtime
   * Useful for dynamic route registration after gateway initialization
   * @param route - Complete route configuration object
   * @example
   * ```ts
   * gateway.addRoute({
   *   pattern: '/api/users',
   *   target: 'http://user-service:3000',
   *   methods: ['GET', 'POST']
   * })
   * ```
   */
  addRoute(route: RouteConfig): void

  /**
   * Remove a route dynamically by pattern
   * Note: This feature depends on 0http-bun router capabilities
   * @param pattern - URL pattern to remove
   * @deprecated This method may not be fully implemented yet
   */
  removeRoute(pattern: string): void

  /**
   * Get the current gateway configuration
   * Returns a copy of the configuration used to initialize the gateway
   * @returns Current gateway configuration object
   */
  getConfig(): GatewayConfig

  /**
   * Start the gateway server on the specified port
   * Alternative to using Bun.serve() directly with the fetch handler
   * @param port - Port number to listen on (overrides config.server.port)
   * @returns Promise that resolves to the Bun server instance
   * @example
   * ```ts
   * const server = await gateway.listen(3000)
   * console.log(`Gateway running on port ${server.port}`)
   * ```
   */
  listen(port?: number): Promise<Server<unknown>>

  /**
   * Gracefully stop the gateway server
   * Closes all connections and performs cleanup
   * @returns Promise that resolves when server is fully stopped
   */
  close(): Promise<void>
}

/**
 * Gateway factory configuration interface
 * Simplified configuration for basic gateway setup
 * @deprecated Use GatewayConfig instead for full feature support
 */
export interface IGatewayConfig {
  /**
   * Port number for the gateway server
   * @default 3000
   */
  port?: number

  /**
   * Default route handler for unmatched requests (404 handler)
   * @param req - The incoming request object
   * @returns Response for unmatched routes
   */
  defaultRoute?: (req: ZeroRequest) => Response | Promise<Response>

  /**
   * Global error handler for uncaught exceptions
   * @param err - The error that occurred
   * @param req - The request that caused the error
   * @returns Error response
   */
  errorHandler?: (err: Error, req: ZeroRequest) => Response | Promise<Response>
}

/**
 * Import and re-export core 0http-bun types directly from the package
 * This ensures 100% compatibility and eliminates duplication while providing
 * enhanced TypeScript support for gateway middleware development
 */
import type {
  ZeroRequest,
  StepFunction,
  RequestHandler,
  IRouter,
  IRouterConfig,
  ParsedFile,
} from '0http-bun'
// Import all middleware types from 0http-bun for comprehensive middleware support
import type {
  // Logger middleware for request/response logging
  LoggerOptions,

  // Auth middleware for security
  APIKeyAuthOptions,
  JWKSLike,
  TokenExtractionOptions,

  // Rate limiting middleware for abuse prevention
  RateLimitOptions,
  RateLimitStore,
  MemoryStore,

  // CORS middleware for cross-origin requests
  CORSOptions,

  // Body parser middleware for request parsing
  BodyParserOptions,
  JSONParserOptions,
  TextParserOptions,
  URLEncodedParserOptions,
  MultipartParserOptions,

  // Prometheus middleware for metrics collection
  PrometheusMetrics,
  PrometheusMiddlewareOptions,
  MetricsHandlerOptions,
  PrometheusIntegration,
} from '0http-bun/lib/middleware'

// Import trouter types used by 0http-bun for routing
export type { Trouter } from 'trouter'

// Pattern and Methods type definitions based on trouter specifications
// These types define the supported URL patterns and HTTP methods for routing

/**
 * URL pattern type for route matching
 * Supports both string patterns and regular expressions
 */
export type Pattern = RegExp | string

/**
 * Comprehensive HTTP methods enum for complete HTTP specification support
 * Includes standard and extended HTTP methods for various use cases
 */
export type Methods =
  | 'ACL' // Access Control List
  | 'BIND' // WebDAV binding
  | 'CHECKOUT' // Version control
  | 'CONNECT' // HTTP tunnel
  | 'COPY' // WebDAV copy
  | 'DELETE' // Delete resource
  | 'GET' // Retrieve resource
  | 'HEAD' // Retrieve headers only
  | 'LINK' // Link resource
  | 'LOCK' // WebDAV lock
  | 'M-SEARCH' // Multicast search
  | 'MERGE' // Version control merge
  | 'MKACTIVITY' // WebDAV activity
  | 'MKCALENDAR' // CalDAV calendar
  | 'MKCOL' // WebDAV collection
  | 'MOVE' // WebDAV move
  | 'NOTIFY' // Event notification
  | 'OPTIONS' // Capability inquiry
  | 'PATCH' // Partial update
  | 'POST' // Create/submit data
  | 'PRI' // HTTP/2 connection preface
  | 'PROPFIND' // WebDAV property find
  | 'PROPPATCH' // WebDAV property patch
  | 'PURGE' // Cache purge
  | 'PUT' // Create/update resource
  | 'REBIND' // WebDAV rebind
  | 'REPORT' // WebDAV report
  | 'SEARCH' // Search request
  | 'SOURCE' // Source retrieval
  | 'SUBSCRIBE' // Event subscription
  | 'TRACE' // Message loop-back test
  | 'UNBIND' // WebDAV unbind
  | 'UNLINK' // Unlink resource
  | 'UNLOCK' // WebDAV unlock
  | 'UNSUBSCRIBE' // Event unsubscription

// Re-export core types
export type {
  ZeroRequest,
  StepFunction,
  RequestHandler,
  IRouter,
  IRouterConfig,
  ParsedFile,
}

// Re-export all middleware types
export type {
  // Logger middleware
  LoggerOptions,

  // JWT/Auth middleware
  APIKeyAuthOptions,
  JWKSLike,
  TokenExtractionOptions,

  // Rate limiting middleware
  RateLimitOptions,
  RateLimitStore,
  MemoryStore,

  // CORS middleware
  CORSOptions,

  // Body parser middleware
  BodyParserOptions,
  JSONParserOptions,
  TextParserOptions,
  URLEncodedParserOptions,
  MultipartParserOptions,

  // Prometheus middleware
  PrometheusMetrics,
  PrometheusMiddlewareOptions,
  MetricsHandlerOptions,
  PrometheusIntegration,
}

/**
 * Gateway JWT authentication options.
 *
 * This is the internal, hardened interface. It intentionally requires `exp`
 * on tokens, supports `audience`/`issuer`, and derives the allowed algorithm
 * list from the supplied key type.
 */
/** Key material accepted by the hardened JWT middleware. */
export type JWTKeyLike = CryptoKey | Uint8Array

export interface JWTAuthOptions {
  /** Symmetric secret, PEM string, JWTKeyLike, or a function resolving to a key */
  secret?:
    | string
    | Uint8Array
    | JWTKeyLike
    | ((req: ZeroRequest) => JWTKeyLike | Promise<JWTKeyLike>)
  /** Remote JWKS URI */
  jwksUri?: string
  /** Inline JWKS object or resolver */
  jwks?: any
  /** Additional JWT verification options (merged, but cannot override security-critical ones) */
  jwtOptions?: Record<string, any>
  /** Custom token extractor */
  getToken?: (
    req: ZeroRequest,
  ) => string | undefined | Promise<string | undefined>
  /** Header name to read the token from */
  tokenHeader?: string
  /** Query parameter name to read the token from */
  tokenQuery?: string
  /** If true, missing/invalid tokens do not block the request */
  optional?: boolean
  /** Paths excluded from JWT checks. Matching uses boundary-aware semantics. */
  excludePaths?: string[]
  /** Static API keys or validation function */
  apiKeys?:
    | string[]
    | ((
        apiKey: string,
        req: ZeroRequest,
      ) => boolean | object | Promise<boolean | object>)
  /** Header name for API key authentication */
  apiKeyHeader?: string
  /** Custom API key validator */
  apiKeyValidator?: (
    apiKey: string,
    req: ZeroRequest,
  ) => boolean | object | Promise<boolean | object>
  /** Deprecated alias for apiKeyValidator */
  validateApiKey?: (
    apiKey: string,
    req: ZeroRequest,
  ) => boolean | object | Promise<boolean | object>
  /** Custom 401 response or response factory */
  unauthorizedResponse?:
    | Response
    | ((error: Error, req: ZeroRequest) => Response | object)
  /** Custom error handler */
  onError?: (
    error: Error,
    req: ZeroRequest,
  ) => Response | void | Promise<Response | void>
  /** Required audience claim(s) */
  audience?: string | string[]
  /** Required issuer claim */
  issuer?: string | string[]
  /** Explicitly allowed algorithms (derived from key type when omitted) */
  algorithms?: string[]
}

/**
 * Middleware manager for organizing middleware execution
 * Uses imported types from 0http-bun
 */
export interface MiddlewareManager {
  /**
   * Register a middleware
   */
  use(middleware: RequestHandler): void

  /**
   * Register middleware for specific path
   */
  use(pattern: string, middleware: RequestHandler): void

  /**
   * Execute middleware chain
   */
  execute(req: ZeroRequest): Promise<Response>
}

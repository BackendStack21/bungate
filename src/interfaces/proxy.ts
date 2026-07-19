/**
 * Import and re-export fetch-gate types directly from the package
 * This ensures 100% compatibility with fetch-gate while providing
 * enhanced TypeScript support for proxy functionality in the gateway
 */
import type {
  ProxyOptions,
  ProxyRequestOptions,
  CircuitBreakerOptions,
  BeforeRequestHook,
  AfterResponseHook,
  BeforeCircuitBreakerHook,
  AfterCircuitBreakerHook,
  ErrorHook,
  CircuitBreakerResult,
  CircuitState,
} from 'fetch-gate'

// Import the FetchProxy class for advanced proxy customization
import type { FetchProxy } from 'fetch-gate/lib/proxy'

// Import the CircuitBreaker class for advanced circuit breaker customization
import type { CircuitBreaker as FetchGateCircuitBreaker } from 'fetch-gate/lib/circuit-breaker'

// Import utility types and logger from fetch-gate
import type { ProxyLogger, LogContext } from 'fetch-gate/lib/logger'

export type {
  ProxyOptions,
  ProxyRequestOptions,
  CircuitBreakerOptions,
  BeforeRequestHook,
  AfterResponseHook,
  BeforeCircuitBreakerHook,
  AfterCircuitBreakerHook,
  ErrorHook,
  CircuitBreakerResult,
  CircuitState,
  FetchProxy,
  FetchGateCircuitBreaker,
  ProxyLogger,
  LogContext,
}

// Import ZeroRequest from our middleware types for gateway-specific interfaces
import type { ZeroRequest } from './middleware'

/**
 * Gateway proxy options extending fetch-gate with redirect security controls.
 */
export interface GatewayProxyOptions extends ProxyOptions {
  /**
   * Allowed redirect target hostnames when followRedirects is enabled.
   * Supports leading wildcards, e.g. '*.example.com'.
   * If empty and redirectSameOrigin is not false, only same-origin redirects
   * (same scheme+host+port as the original upstream target) are allowed.
   */
  redirectAllowlist?: string[]

  /**
   * When true and no redirectAllowlist is provided, allow redirects only to
   * the same origin as the original upstream target.
   * @default true
   */
  redirectSameOrigin?: boolean

  /**
   * Rewrite incoming paths before forwarding to the upstream target.
   * Keys are regex patterns; values are replacements. May also be a function
   * that receives the original path (including query string) and returns the
   * rewritten path.
   */
  pathRewrite?: Record<string, string> | ((path: string) => string)

  /**
   * Per-request fetch `RequestInit` options (e.g. `redirect`).
   * Used internally to force `redirect: 'manual'` for SSRF protection.
   */
  request?: RequestInit
}

/**
 * Gateway-specific proxy handler interface
 * Extends fetch-gate functionality with enhanced ZeroRequest support
 * and gateway-specific features for request forwarding
 */
export interface ProxyHandler {
  /**
   * Proxy a request to a target service
   * @param req - The gateway request object with enhanced context
   * @param source - Target URL or service identifier
   * @param opts - Additional proxy options for this request
   * @returns Promise resolving to the proxied response
   * @example
   * ```ts
   * const response = await proxy.proxy(req, 'http://user-service:3000', {
   *   timeout: 5000,
   *   headers: { 'X-Gateway': 'bungate' }
   * })
   * ```
   */
  proxy(
    req: ZeroRequest,
    source?: string,
    opts?: ProxyRequestOptions,
  ): Promise<Response>

  /**
   * Gracefully close the proxy instance
   * Cleans up resources and closes any open connections
   */
  close(): void

  /**
   * Get the current circuit breaker state for monitoring
   * @returns Current circuit state (CLOSED, OPEN, HALF_OPEN)
   */
  getCircuitBreakerState(): CircuitState

  /**
   * Get the number of consecutive failures in the circuit breaker
   * @returns Number of failures that contributed to circuit breaker state
   */
  getCircuitBreakerFailures(): number

  /**
   * Clear the internal URL cache for DNS and connection pooling
   * Useful for forcing reconnection to updated services
   */
  clearURLCache(): void
}

/**
 * Gateway-specific proxy factory function return type
 * Provides a simplified interface for proxy operations
 */
export interface ProxyInstance {
  /** Proxy method for request forwarding */
  proxy: ProxyHandler['proxy']
  /** Close method for cleanup */
  close: ProxyHandler['close']
  /** Circuit breaker state inspection */
  getCircuitBreakerState: ProxyHandler['getCircuitBreakerState']
  /** Circuit breaker failure count */
  getCircuitBreakerFailures: ProxyHandler['getCircuitBreakerFailures']
  /** URL cache management */
  clearURLCache: ProxyHandler['clearURLCache']
}

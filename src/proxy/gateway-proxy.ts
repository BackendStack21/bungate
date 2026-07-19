/**
 * Gateway Proxy Implementation
 *
 * A high-performance HTTP proxy built on fetch-gate with enhanced gateway features.
 * Provides intelligent request forwarding, circuit breaker pattern, connection pooling,
 * and comprehensive monitoring for reliable microservices communication.
 *
 * Features:
 * - Circuit breaker protection against cascading failures
 * - Connection pooling and keep-alive for performance
 * - Request/response transformation capabilities
 * - Comprehensive error handling and retry logic
 * - Real-time health monitoring and metrics collection
 * - Support for ZeroRequest enhanced context
 * - Secure redirect handling (manual by default, opt-in with allowlist/same-origin)
 */

import type { ProxyHandler, ProxyInstance } from '../interfaces/proxy'
import type { ProxyRequestOptions, CircuitState } from 'fetch-gate'
import type { GatewayProxyOptions } from '../interfaces/proxy'
import { FetchProxy } from 'fetch-gate/lib/proxy'
import type { ZeroRequest } from '../interfaces/middleware'

export function resolveTargetUrl(source?: string, base?: string): URL {
  const target = source || ''
  if (target.includes('://')) return new URL(target)
  const baseUrl = base || ''
  if (baseUrl.includes('://')) return new URL(target, baseUrl)
  // Fallback used only for malformed configurations.
  return new URL(target || '/', 'http://localhost')
}

export function matchesHostname(hostname: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2).toLowerCase()
    const h = hostname.toLowerCase()
    return h === suffix || h.endsWith('.' + suffix)
  }
  return hostname.toLowerCase() === pattern.toLowerCase()
}

export function isRedirectAllowed(
  redirectUrl: URL,
  originalUrl: URL,
  options: GatewayProxyOptions,
): boolean {
  if (options.redirectAllowlist && options.redirectAllowlist.length > 0) {
    return options.redirectAllowlist.some((allowed) =>
      matchesHostname(redirectUrl.hostname, allowed),
    )
  }
  if (options.redirectSameOrigin === false) {
    return false
  }
  return redirectUrl.origin === originalUrl.origin
}

/**
 * Gateway-enhanced proxy handler with ZeroRequest support
 *
 * Wraps fetch-gate's FetchProxy to provide seamless integration with the gateway's
 * enhanced request context and middleware pipeline while maintaining full compatibility
 * with fetch-gate's advanced features.
 */
export class GatewayProxy implements ProxyHandler {
  /** Underlying fetch-gate proxy instance for core functionality */
  private fetchProxy: FetchProxy
  /** Resolved gateway proxy options */
  private options: GatewayProxyOptions

  /**
   * Initialize the gateway proxy with fetch-gate options
   *
   * @param options - Proxy configuration including timeouts, circuit breaker, and hooks
   */
  constructor(options: GatewayProxyOptions) {
    this.options = options
    this.fetchProxy = new FetchProxy(options)
  }

  /**
   * Proxy a request to the target service with gateway enhancements
   *
   * @param req - Enhanced ZeroRequest with gateway context
   * @param source - Target service URL or identifier
   * @param opts - Request-specific proxy options
   * @returns Promise resolving to the proxied response
   */
  async proxy(
    req: ZeroRequest,
    source?: string,
    opts?: ProxyRequestOptions,
  ): Promise<Response> {
    const mergedOptions: GatewayProxyOptions = { ...this.options, ...opts }
    const followRedirects = mergedOptions.followRedirects === true
    const maxRedirects = mergedOptions.maxRedirects ?? 5

    let currentReq = req as Request
    let originalTargetUrl: URL | undefined
    let redirectCount = 0

    while (true) {
      // Always use manual redirect mode so bungate controls SSRF exposure (V-1).
      const proxyOptions = {
        ...mergedOptions,
        request: {
          ...(mergedOptions.request || {}),
          redirect: 'manual' as const,
        },
      }

      const response = await this.fetchProxy.proxy(
        currentReq as Request,
        source,
        proxyOptions,
      )

      const isRedirect =
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has('location')

      if (!isRedirect || !followRedirects || redirectCount >= maxRedirects) {
        return response
      }

      // Body-preserving redirects are unsafe to follow automatically because
      // fetch-gate may have already consumed the stream. Follow GET/HEAD
      // redirects only; return the 3xx response for other methods.
      if (currentReq.method !== 'GET' && currentReq.method !== 'HEAD') {
        return response
      }

      const location = response.headers.get('location')!
      const currentUrl = resolveTargetUrl(
        source,
        mergedOptions.base || this.options.base,
      )
      if (originalTargetUrl === undefined) {
        originalTargetUrl = currentUrl
      }
      const redirectUrl = new URL(location, currentUrl)

      if (!isRedirectAllowed(redirectUrl, originalTargetUrl, mergedOptions)) {
        return response
      }

      // Prepare next request. For GET/HEAD we can safely re-issue as GET.
      currentReq = new Request(redirectUrl.toString(), {
        method: 'GET',
        headers: currentReq.headers,
      })
      redirectCount++
    }
  }

  /**
   * Gracefully close the proxy and clean up resources
   * Closes connection pools and cancels pending requests
   */
  close(): void {
    this.fetchProxy.close()
  }

  /**
   * Get current circuit breaker state for monitoring
   *
   * @returns Current circuit state (CLOSED, OPEN, HALF_OPEN)
   */
  getCircuitBreakerState(): CircuitState {
    return this.fetchProxy.getCircuitBreakerState()
  }

  /**
   * Get number of consecutive failures in circuit breaker
   *
   * @returns Failure count contributing to circuit state
   */
  getCircuitBreakerFailures(): number {
    return this.fetchProxy.getCircuitBreakerFailures()
  }

  /**
   * Clear internal URL cache for DNS and connection pooling
   * Useful for forcing reconnection after service updates
   */
  clearURLCache(): void {
    this.fetchProxy.clearURLCache()
  }
}

/**
 * Factory function to create a ProxyInstance for gateway integration
 *
 * Creates a simplified proxy interface optimized for gateway usage patterns.
 * Provides all essential proxy methods in a convenient, injectable format.
 *
 * @param options - Proxy configuration options
 * @returns ProxyInstance with proxy methods for gateway integration
 *
 * @example
 * ```ts
 * const proxy = createGatewayProxy({
 *   timeout: 10000,
 *   circuitBreaker: { errorThreshold: 5, resetTimeout: 60000 }
 * })
 *
 * // Use in route handler
 * const response = await proxy.proxy(req, 'http://api.service.com')
 * ```
 */
export function createGatewayProxy(
  options: GatewayProxyOptions,
): ProxyInstance {
  const handler = new GatewayProxy(options)
  return {
    proxy: handler.proxy.bind(handler),
    close: handler.close.bind(handler),
    getCircuitBreakerState: handler.getCircuitBreakerState.bind(handler),
    getCircuitBreakerFailures: handler.getCircuitBreakerFailures.bind(handler),
    clearURLCache: handler.clearURLCache.bind(handler),
  }
}

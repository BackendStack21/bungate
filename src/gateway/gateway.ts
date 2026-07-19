/**
 * Bungate API Gateway Implementation
 *
 * A high-performance, production-ready API gateway built on Bun runtime with 0http-bun router.
 * Provides comprehensive routing, middleware support, load balancing, and proxy capabilities
 * for microservices architectures and API management.
 *
 * Key Features:
 * - Ultra-fast HTTP routing with parameter and wildcard support
 * - Built-in load balancing with multiple strategies
 * - Circuit breaker pattern for fault tolerance
 * - JWT authentication and CORS support
 * - Request/response transformation and validation
 * - Comprehensive logging and metrics collection
 * - Multi-process clustering for high availability
 * - Hot reload and graceful shutdown capabilities
 *
 * @example
 * ```ts
 * const gateway = new BunGateway({
 *   server: { port: 3000 },
 *   routes: [
 *     {
 *       pattern: '/api/users/*',
 *       target: 'http://user-service:3000',
 *       loadBalancer: { strategy: 'round-robin' }
 *     }
 *   ],
 *   cors: { origin: '*' },
 *   auth: { secret: 'your-jwt-secret' }
 * })
 *
 * await gateway.listen(3000)
 * ```
 */

import http from '0http-bun'
import type { Server } from 'bun'
import type { Gateway, GatewayConfig } from '../interfaces/gateway'
import type { RouteConfig } from '../interfaces/route'
import type {
  RequestHandler,
  ZeroRequest,
  IRouter,
  IRouterConfig,
  StepFunction,
} from '../interfaces/middleware'

// Import 0http-bun middlewares
import {
  createLogger,
  createCORS,
  createBodyParser,
  createPrometheusMiddleware,
  type CORSOptions,
  type PrometheusMiddlewareOptions,
  createRateLimit,
} from '0http-bun/lib/middleware'

// Import our custom implementations
import { createJWTAuth, matchesExcludedPath } from '../security'
import type { JWTAuthOptions } from '../interfaces/middleware'
import { createGatewayProxy } from '../proxy/gateway-proxy'
import { HttpLoadBalancer } from '../load-balancer/http-load-balancer'
import type { ProxyInstance } from '../interfaces/proxy'
import { ClusterManager } from '../cluster/cluster-manager'
import { TLSManager, createTLSManager } from '../security/tls-manager'
import { mergeSecurityConfig, validateSecurityConfig } from '../security/config'
import { HTTPRedirectManager } from '../security/http-redirect'
import {
  TrustedProxyValidator,
  createTrustedProxyValidator,
} from '../security/trusted-proxy'
import { createErrorHandlerMiddleware } from '../security/error-handler-middleware'
import { sanitizeHeader } from '../security/utils'

/**
 * Production-grade API Gateway implementation
 *
 * Orchestrates request routing, middleware processing, and backend communication
 * with enterprise features for scalability and reliability.
 */
export class BunGateway implements Gateway {
  /** Gateway configuration including routes, middleware, and server settings */
  private config: GatewayConfig
  /** 0http-bun router instance for high-performance request routing */
  private router: IRouter
  /** Bun server instance when using built-in server */
  private server: Server | null = null
  /** Map of route patterns to their proxy instances */
  private proxies: Map<string, ProxyInstance> = new Map()
  /** Map of route patterns to their load balancer instances */
  private loadBalancers: Map<string, HttpLoadBalancer> = new Map()
  /** Cluster manager for multi-process deployments */
  private clusterManager: ClusterManager | null = null
  /** Flag indicating if this process is the cluster master */
  private isClusterMaster: boolean = false
  /** TLS manager for HTTPS support */
  private tlsManager: TLSManager | null = null
  /** HTTP redirect manager for automatic HTTPS upgrade */
  private httpRedirectManager: HTTPRedirectManager | null = null
  /** Trusted proxy validator for secure client IP extraction */
  private trustedProxyValidator: TrustedProxyValidator | null = null

  /**
   * Initialize the API Gateway with comprehensive configuration
   *
   * Sets up routing, middleware chain, clustering, and backend services.
   * Automatically configures load balancers and proxy instances for defined routes.
   *
   * @param config - Gateway configuration object with routes, middleware, and server options
   */
  constructor(config: GatewayConfig = {}) {
    this.config = config
    this.isClusterMaster = !process.env.CLUSTER_WORKER

    // Merge and validate security configuration
    if (this.config.security) {
      this.config.security = mergeSecurityConfig(this.config.security)
      const validation = validateSecurityConfig(this.config.security)
      if (!validation.valid && validation.errors) {
        throw new Error(
          `Security configuration validation failed: ${validation.errors.join(', ')}`,
        )
      }
    }

    // Initialize TLS manager if TLS is enabled
    if (this.config.security?.tls?.enabled) {
      this.tlsManager = createTLSManager(this.config.security.tls)
      const tlsValidation = this.tlsManager.validateConfig()
      if (!tlsValidation.valid && tlsValidation.errors) {
        throw new Error(
          `TLS configuration validation failed: ${tlsValidation.errors.join(', ')}`,
        )
      }
    }

    // Initialize trusted proxy validator if enabled
    if (this.config.security?.trustedProxies?.enabled) {
      this.trustedProxyValidator = createTrustedProxyValidator(
        this.config.security.trustedProxies,
        this.config.logger,
      )
    }

    // Initialize cluster manager for multi-process deployment
    if (this.config.cluster?.enabled && this.isClusterMaster) {
      this.clusterManager = new ClusterManager(
        this.config.cluster,
        this.config.logger,
        process.argv[1],
      )
    }

    const routerConfig: IRouterConfig = {
      // Map gateway config to router config
      defaultRoute: config.defaultRoute
        ? (req: ZeroRequest) => config.defaultRoute!(req)
        : // Secure default 404 handler — no framework identifying information
          () =>
            new Response(JSON.stringify({ error: 'Not found' }), {
              status: 404,
              headers: { 'content-type': 'application/json' },
            }),
      errorHandler: this.handleError,
      port: config.server?.port,
    }

    const { router } = http(routerConfig)
    this.router = router

    // Create logger middleware if configured.
    // Wrap the response serializer so that session cookies are never written
    // to the request log in plaintext (V-7).
    const userSerializers = config.logger?.getSerializers?.()
    const safeSerializers: Record<string, any> = { ...userSerializers }
    const originalResSerializer = safeSerializers.res
    safeSerializers.res = (response: Response) => {
      const serialized = originalResSerializer
        ? originalResSerializer(response)
        : {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers.entries()),
          }
      if (serialized.headers) {
        const headers = { ...serialized.headers }
        delete headers['set-cookie']
        delete headers['cookie']
        serialized.headers = headers
      }
      return serialized
    }

    this.router.use(
      createLogger({
        // @ts-ignore
        logger: config.logger?.pino,
        serializers: safeSerializers,
      }),
    )

    // Add global rate limiting middleware if configured at the gateway level.
    // excludePaths use boundary-aware matching so '/api/public' does not
    // accidentally exempt '/api/publicity/admin' (V-6).
    if (this.config.rateLimit) {
      const { excludePaths, ...rateLimitRest } = this.config.rateLimit
      const globalRateLimitKeyGenerator = (req: ZeroRequest) =>
        this.getClientIP(req)
      const rateLimitMiddleware = createRateLimit({
        ...rateLimitRest,
        keyGenerator: rateLimitRest.keyGenerator || globalRateLimitKeyGenerator,
      })

      if (excludePaths && excludePaths.length > 0) {
        this.router.use(async (req: ZeroRequest, next: StepFunction) => {
          const url = new URL(req.url)
          if (matchesExcludedPath(url.pathname, excludePaths)) {
            return next()
          }
          return rateLimitMiddleware(req, next)
        })
      } else {
        this.router.use(rateLimitMiddleware)
      }
    }

    // Add size limiter middleware with secure defaults (always enabled)
    const sizeLimits = this.config.security?.sizeLimits ?? {
      maxBodySize: 10 * 1024 * 1024, // 10MB
      maxHeaderSize: 16384, // 16KB
      maxHeaderCount: 100,
      maxUrlLength: 2048,
      maxQueryParams: 100,
    }
    const {
      createSizeLimiterMiddleware,
    } = require('../security/size-limiter-middleware')
    this.router.use(createSizeLimiterMiddleware({ limits: sizeLimits }))

    // Add input validation middleware if configured
    if (this.config.security?.inputValidation) {
      const {
        createValidationMiddleware,
      } = require('../security/validation-middleware')
      this.router.use(
        createValidationMiddleware({
          rules: this.config.security.inputValidation,
        }),
      )
    }

    // Add security headers middleware if configured
    if (this.config.security?.securityHeaders?.enabled !== false) {
      const {
        SecurityHeadersMiddleware,
      } = require('../security/security-headers')
      // Use the merged security config which has proper defaults
      const headersConfig = this.config.security?.securityHeaders || {}
      const securityHeaders = new SecurityHeadersMiddleware(headersConfig)

      // Wrap the response to apply security headers
      this.router.use(async (req: ZeroRequest, next: StepFunction) => {
        const response = await next()
        const url = new URL(req.url)
        const isHttps =
          url.protocol === 'https:' || this.config.security?.tls?.enabled
        return securityHeaders.applyHeaders(response, isHttps)
      })
    }

    // Add Prometheus metrics middleware if enabled and NOT in development
    if (
      !this.config.server?.development &&
      this.config.metrics?.enabled === true
    ) {
      const prometheusOptions: PrometheusMiddlewareOptions = {
        excludePaths: ['/health', '/metrics', '/favicon.ico'],
        collectDefaultMetrics:
          this.config.metrics?.collectDefaultMetrics ?? true,
      }
      this.router.use(createPrometheusMiddleware(prometheusOptions))
    }

    // Add authentication middleware if configured
    if (config.auth) {
      this.router.use(createJWTAuth(config.auth))
    }

    // Add body parser middleware
    if (config.bodyParser) {
      this.router.use(createBodyParser(config.bodyParser))
    }

    // Register initial routes if provided
    if (config.routes) {
      for (const route of config.routes) {
        if (this.config.proxy) {
          route.proxy = {
            ...this.config.proxy,
            ...route.proxy,
          }
        }
        this.addRoute(route)
      }
    }
  }

  fetch = async (req: Request): Promise<Response> => {
    // 0http-bun expects a Request, returns a Response.
    // Await the router result so async throws are caught by our sanitized
    // error handler instead of leaking Bun's debug page (V-9).
    try {
      return await this.router.fetch(req)
    } catch (err) {
      return await this.handleError(err as Error, req as ZeroRequest)
    }
  }

  /**
   * Secure global error handler.
   * Logs full details internally and returns a sanitized 500 to the client.
   */
  private handleError = async (
    err: Error,
    req?: ZeroRequest,
  ): Promise<Response> => {
    if (typeof this.config.errorHandler === 'function') {
      const result = await (this.config.errorHandler as any)(err, req)
      if (result instanceof Response) {
        return result
      }
    }

    const includeStack =
      this.config.security?.errorHandling?.includeStackTrace === true ||
      this.config.server?.development === true

    this.config.logger?.error(
      {
        error: err.message,
        ...(includeStack && err.stack ? { stack: err.stack } : {}),
        url: req?.url,
        method: req?.method,
        clientIP: req ? this.getClientIP(req) : undefined,
      },
      'Unhandled gateway error',
    )

    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  use(...args: any[]): this {
    this.router.use(...args)
    return this
  }

  on(method: string, pattern: string, ...handlers: RequestHandler[]): this {
    // Convert string method to Methods type (uppercase)
    const upperMethod = method.toUpperCase() as any
    this.router.on(upperMethod, pattern, ...handlers)
    return this
  }

  get(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('GET', pattern, ...handlers)
  }
  post(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('POST', pattern, ...handlers)
  }
  put(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('PUT', pattern, ...handlers)
  }
  patch(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('PATCH', pattern, ...handlers)
  }
  delete(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('DELETE', pattern, ...handlers)
  }
  head(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('HEAD', pattern, ...handlers)
  }
  options(pattern: string, ...handlers: RequestHandler[]): this {
    return this.on('OPTIONS', pattern, ...handlers)
  }
  all(pattern: string, ...handlers: RequestHandler[]): this {
    // For "all" methods, we need to register for each HTTP method
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    for (const method of methods) {
      this.router.on(method as any, pattern, ...handlers)
    }
    return this
  }

  addRoute(route: RouteConfig): void {
    const methods =
      route.methods && route.methods.length > 0 ? route.methods : ['GET']

    for (const method of methods) {
      // Build middleware chain for this route
      // Security-critical middleware should run before custom route middleware
      const middlewares: RequestHandler[] = []

      // Add CORS middleware if configured (must be early for preflight requests)
      if (this.config.cors) {
        // Validate CORS configuration against security policy before registering
        this.validateCORSConfig(this.config.cors)

        const corsOptions: CORSOptions = {
          origin: this.config.cors.origin,
          methods: this.config.cors.methods,
          allowedHeaders: this.config.cors.allowedHeaders,
          exposedHeaders: this.config.cors.exposedHeaders,
          credentials: this.config.cors.credentials,
          maxAge: this.config.cors.maxAge,
        }
        middlewares.push(createCORS(corsOptions))
      }

      // Add authentication middleware if configured (before custom middleware)
      if (route.auth) {
        // Pass through all authentication options to support both JWT and API key auth.
        // The internal createJWTAuth derives allowed algorithms from the key type,
        // requires an `exp` claim, and supports audience/issuer validation.
        const { jwtOptions: routeJwtOptions, ...authRest } = route.auth

        const jwtOptions = routeJwtOptions
          ? {
              // When jwtOptions is provided, merge everything at root level
              ...authRest,
              ...routeJwtOptions,
            }
          : {
              // Fallback to root-level properties
              ...authRest,
            }

        middlewares.push(createJWTAuth(jwtOptions as JWTAuthOptions))
      }

      // Add rate limiting middleware if configured (before custom middleware)
      if (route.rateLimit) {
        // Use gateway's secure getClientIP() as the rate limit key generator
        // to prevent X-Forwarded-For header rotation bypass attacks.
        // Without this, an attacker can rotate X-Forwarded-For to avoid rate limits.
        const rateLimitKeyGenerator = (req: ZeroRequest) => {
          return this.getClientIP(req)
        }
        const { excludePaths: routeExcludePaths, ...routeRateLimitRest } =
          route.rateLimit
        const routeRateLimitMiddleware = createRateLimit({
          ...routeRateLimitRest,
          keyGenerator:
            routeRateLimitRest.keyGenerator || rateLimitKeyGenerator,
        })

        if (routeExcludePaths && routeExcludePaths.length > 0) {
          middlewares.push(async (req: ZeroRequest, next: StepFunction) => {
            const url = new URL(req.url)
            if (matchesExcludedPath(url.pathname, routeExcludePaths)) {
              return next()
            }
            return routeRateLimitMiddleware(req, next)
          })
        } else {
          middlewares.push(routeRateLimitMiddleware)
        }
      }

      // Add route-specific middlewares after security middleware
      if (route.middlewares) {
        middlewares.push(...route.middlewares)
      }

      // Create load balancer if configured
      let loadBalancer: HttpLoadBalancer | undefined
      if (
        route.loadBalancer?.targets &&
        route.loadBalancer.targets.length > 0
      ) {
        const balancerKey = `${route.pattern}-${method}`
        loadBalancer = new HttpLoadBalancer({
          logger: this.config.logger?.child({ component: 'HttpLoadBalancer' }),
          ...route.loadBalancer,
          trustedProxyValidator: this.trustedProxyValidator || undefined,
        })
        this.loadBalancers.set(balancerKey, loadBalancer)
      }

      // Create proxy if target is specified
      let proxy: ProxyInstance | undefined
      const proxyKey = `${route.pattern}-${method}`
      const baseUrl = route.target

      proxy = createGatewayProxy({
        logger: this.config.logger?.pino.child({
          component: 'GatewayProxy',
        }) as any,
        base: baseUrl,
        timeout: route.timeout || route.proxy?.timeout || 30000,
        // Default redirect following to OFF to prevent open-redirect / SSRF issues.
        // Individual routes must explicitly opt in.
        followRedirects: route.proxy?.followRedirects === true,
        maxRedirects: route.proxy?.maxRedirects ?? 5,
        headers: route.proxy?.headers || {},
        circuitBreaker: route.circuitBreaker,
      })
      this.proxies.set(proxyKey, proxy)

      // Create the final handler
      const finalHandler: RequestHandler = async (req: ZeroRequest) => {
        try {
          // Call hooks
          if (route.hooks?.beforeRequest) {
            await route.hooks.beforeRequest(req, route.proxy)
          }

          let response: Response

          // Handle direct handler
          if (route.handler) {
            // Route handlers might not take `next` parameter, so we need to adapt
            response = await (route.handler as any)(req)
          }
          // Handle proxy with load balancer
          else if (loadBalancer && proxy) {
            const target = loadBalancer.selectTarget(
              req as Request,
              this.getClientIP(req),
            )
            if (!target) {
              throw new Error('No healthy targets available')
            }

            // Preserve original query string unless pathRewrite explicitly changes it
            const originalUrl = new URL(req.url)
            let targetPath = originalUrl.pathname + originalUrl.search
            if (route.proxy?.pathRewrite) {
              if (typeof route.proxy.pathRewrite === 'function') {
                targetPath = route.proxy.pathRewrite(targetPath)
              } else {
                for (const [pattern, replacement] of Object.entries(
                  route.proxy.pathRewrite,
                )) {
                  targetPath = targetPath.replace(
                    new RegExp(pattern),
                    replacement,
                  )
                }
              }
            }

            // Build sanitized request for upstream forwarding
            const upstreamUrl = target.url + targetPath
            const proxyReq = this.sanitizeProxyRequest(
              req,
              upstreamUrl,
              route.proxy,
            )

            // Measure end-to-end time to update latency metrics in the load balancer
            const startedAt = Date.now()
            loadBalancer.incrementConnections(target.url)
            let connectionsDecremented = false
            response = await proxy.proxy(proxyReq as ZeroRequest, upstreamUrl, {
              afterCircuitBreakerExecution:
                route.hooks?.afterCircuitBreakerExecution,
              beforeCircuitBreakerExecution:
                route.hooks?.beforeCircuitBreakerExecution,
              afterResponse: (
                req: Request,
                res: Response,
                body?: ReadableStream | null,
              ) => {
                if (connectionsDecremented) return
                connectionsDecremented = true
                loadBalancer.decrementConnections(target.url)
                // Update latency stats for strategies like 'latency' and as tie-breakers
                try {
                  const duration = Date.now() - startedAt
                  loadBalancer.recordResponse(
                    target.url,
                    duration,
                    res.status >= 500,
                  )
                } catch {}
              },
              onError: (req: Request, error: Error) => {
                if (connectionsDecremented) {
                  if (route.hooks?.onError) {
                    route.hooks.onError!(req, error)
                  }
                  return
                }
                connectionsDecremented = true
                loadBalancer.decrementConnections(target.url)
                // Record error with latency to penalize target appropriately
                try {
                  const duration = Date.now() - startedAt
                  loadBalancer.recordResponse(target.url, duration, true)
                } catch {}
                if (route.hooks?.onError) {
                  route.hooks.onError!(req, error)
                }
              },
            })

            // Attach sticky-session cookie if the load balancer generated one
            const stickyCookie = loadBalancer.getStickySessionCookie(target)
            if (stickyCookie) {
              response = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: (() => {
                  const h = new Headers(response.headers)
                  h.append('Set-Cookie', stickyCookie)
                  return h
                })(),
              })
            }
          }
          // Handle simple proxy
          else if (route.target && proxy) {
            const originalUrl = new URL(req.url)
            let targetPath = originalUrl.pathname + originalUrl.search

            // Apply path rewriting if configured
            if (route.proxy?.pathRewrite) {
              if (typeof route.proxy.pathRewrite === 'function') {
                targetPath = route.proxy.pathRewrite(targetPath)
              } else {
                for (const [pattern, replacement] of Object.entries(
                  route.proxy.pathRewrite,
                )) {
                  targetPath = targetPath.replace(
                    new RegExp(pattern),
                    replacement,
                  )
                }
              }
            }

            const upstreamUrl = route.target + targetPath
            const proxyReq = this.sanitizeProxyRequest(
              req,
              upstreamUrl,
              route.proxy,
            )

            response = await proxy.proxy(proxyReq as ZeroRequest, upstreamUrl, {
              afterCircuitBreakerExecution:
                route.hooks?.afterCircuitBreakerExecution,
              beforeCircuitBreakerExecution:
                route.hooks?.beforeCircuitBreakerExecution,
              onError: (req: Request, error: Error) => {
                if (route.hooks?.onError) {
                  return route.hooks.onError!(req, error)
                }
              },
            })
          }
          // No handler or proxy configured
          else {
            response = new Response('Not implemented', { status: 501 })
          }

          // Call hooks
          if (route.hooks?.afterResponse) {
            await route.hooks.afterResponse(req, response, response.body)
          }

          return response
        } catch (error) {
          // Call error hook
          if (route.hooks?.onError) {
            await route.hooks.onError(req, error as Error)
          }

          // Re-throw error to be handled by global error handler
          throw error
        }
      }

      // Add all middlewares and final handler to the route
      this.on(method, route.pattern, ...middlewares, finalHandler)
    }
  }

  /**
   * Validates the user-supplied CORS configuration against the security policy.
   * Rejects dangerous combinations before the CORS middleware is registered.
   */
  private validateCORSConfig(cors: GatewayConfig['cors']): void {
    const validation = this.config.security?.corsValidation
    if (!validation || !cors) {
      return
    }

    const origins = cors.origin
      ? Array.isArray(cors.origin)
        ? cors.origin
        : [cors.origin]
      : []

    if (validation.allowWildcardWithCredentials === false) {
      const hasWildcard = origins.some((o) => o === '*')
      if (hasWildcard && cors.credentials) {
        throw new Error(
          'CORS security violation: wildcard origin with credentials is not allowed',
        )
      }
    }

    if (validation.requireHttps) {
      const hasHttpOrigin = origins.some(
        (o) => typeof o === 'string' && o.startsWith('http:'),
      )
      if (hasHttpOrigin) {
        throw new Error(
          'CORS security violation: non-HTTPS origins are not allowed',
        )
      }
    }

    if (validation.maxOrigins && origins.length > validation.maxOrigins) {
      throw new Error(
        `CORS security violation: number of origins (${origins.length}) exceeds maximum (${validation.maxOrigins})`,
      )
    }
  }

  /**
   * Sanitizes request headers before forwarding to upstream targets.
   *
   * - Strips hop-by-hop headers and any header named in Connection
   * - Removes attacker-supplied X-Forwarded-* headers and replaces them with
   *   values derived from the trusted client IP and inbound request
   * - Strips sensitive authentication headers by default
   * - Rewrites Host to the upstream hostname
   * - Applies per-route proxy headers
   */
  private sanitizeProxyRequest(
    req: ZeroRequest,
    targetUrlOrPath: string,
    proxyConfig?: RouteConfig['proxy'],
  ): Request {
    const incomingHeaders = new Headers(req.headers)

    // 1. Remove hop-by-hop headers
    const hopByHop = new Set([
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
    ])

    const connectionHeader = incomingHeaders.get('connection')
    if (connectionHeader) {
      for (const name of connectionHeader.split(',')) {
        hopByHop.add(name.trim().toLowerCase())
      }
    }

    const sanitizedHeaders = new Headers()
    for (const [name, value] of incomingHeaders.entries()) {
      if (!hopByHop.has(name.toLowerCase())) {
        const safeValue = sanitizeHeader(value)
        if (safeValue !== '') {
          sanitizedHeaders.set(name, safeValue)
        }
      }
    }

    // 2. Strip attacker-controlled forwarded headers and sensitive auth headers
    sanitizedHeaders.delete('x-forwarded-for')
    sanitizedHeaders.delete('x-forwarded-host')
    sanitizedHeaders.delete('x-forwarded-proto')
    sanitizedHeaders.delete('x-forwarded-port')
    sanitizedHeaders.delete('x-real-ip')
    sanitizedHeaders.delete('cf-connecting-ip')
    sanitizedHeaders.delete('x-client-ip')
    sanitizedHeaders.delete('cookie')
    sanitizedHeaders.delete('authorization')
    sanitizedHeaders.delete('proxy-authorization')

    // 3. Set trusted forwarded headers
    const clientIP = this.getClientIP(req)
    const inboundUrl = new URL(req.url)
    sanitizedHeaders.set('x-forwarded-for', clientIP)
    sanitizedHeaders.set(
      'x-forwarded-proto',
      inboundUrl.protocol.replace(':', ''),
    )
    sanitizedHeaders.set(
      'x-forwarded-port',
      inboundUrl.port || (inboundUrl.protocol === 'https:' ? '443' : '80'),
    )
    sanitizedHeaders.set('x-forwarded-host', inboundUrl.host)

    // 4. Rewrite Host header to upstream hostname
    try {
      const upstreamHost = targetUrlOrPath.includes('://')
        ? new URL(targetUrlOrPath).host
        : new URL(targetUrlOrPath, 'http://localhost').host
      sanitizedHeaders.set('host', upstreamHost)
    } catch {
      // Leave host unchanged if target URL is malformed (will fail later)
    }

    // 5. Apply per-route proxy headers (these override the sanitized defaults)
    if (proxyConfig?.headers) {
      for (const [name, value] of Object.entries(proxyConfig.headers)) {
        if (value === undefined || value === null) continue
        const safeValue = sanitizeHeader(String(value))
        sanitizedHeaders.set(name, safeValue)
      }
    }

    return new Request(req.url, {
      method: req.method,
      headers: sanitizedHeaders,
      body: req.body,
    })
  }

  private getClientIP(req: ZeroRequest): string {
    // Always derive the direct peer address from the underlying socket when available.
    const socketInfo = this.server?.requestIP(req as Request)
    const directIP = socketInfo?.address ?? 'unknown'

    // If trusted proxy validator is enabled, use it for secure IP extraction
    if (this.trustedProxyValidator) {
      const clientIP = this.trustedProxyValidator.extractClientIP(
        req as Request,
        directIP,
      )

      // Log suspicious forwarded headers from untrusted direct peers
      const xForwardedFor = req.headers.get('x-forwarded-for')
      if (
        xForwardedFor &&
        !this.trustedProxyValidator.validateProxy(directIP)
      ) {
        this.config.logger?.warn(
          'Suspicious forwarded header from untrusted proxy',
          {
            xForwardedFor,
            directIP,
            extractedIP: clientIP,
          },
        )
      }

      return clientIP
    }

    // No trusted proxy validator: the only trustworthy identifier is the socket IP.
    return directIP
  }

  removeRoute(pattern: string): void {
    // Not implemented in the underlying router yet
    throw new Error('removeRoute is not implemented')
  }

  getConfig(): GatewayConfig {
    return this.config
  }

  async listen(port?: number): Promise<Server> {
    const listenPort = port ?? this.config.server?.port ?? 3000

    // If cluster mode is enabled and we're the master, start the cluster
    if (this.clusterManager && this.isClusterMaster) {
      this.config.logger?.info('Starting cluster manager')
      await this.clusterManager.start()

      // Master process doesn't serve requests directly in cluster mode
      // Instead, it manages worker processes
      return new Promise(() => {}) as Promise<Server>
    }

    // Load and validate TLS certificates if enabled
    if (this.tlsManager) {
      this.config.logger?.info('Loading TLS certificates')
      await this.tlsManager.loadCertificates()

      const certValidation = await this.tlsManager.validateCertificates()
      if (!certValidation.valid && certValidation.errors) {
        throw new Error(
          `TLS certificate validation failed: ${certValidation.errors.join(', ')}`,
        )
      }

      this.config.logger?.info('TLS certificates loaded successfully')
    }

    // Worker process or single process mode
    const serverOptions: any = {
      port: listenPort,
      fetch: this.fetch,
      // Enable port sharing for cluster mode
      reusePort: !!process.env.CLUSTER_WORKER,
      // Honor configured bind hostname to avoid accidental 0.0.0.0 exposure
      hostname: this.config.server?.hostname,
      // Defense-in-depth request size limits
      maxRequestBodySize:
        this.config.security?.sizeLimits?.maxBodySize ?? 10 * 1024 * 1024,
    }

    // Add TLS options if enabled
    if (this.tlsManager) {
      const tlsOptions = this.tlsManager.getTLSOptions()
      if (tlsOptions) {
        serverOptions.tls = tlsOptions
        this.config.logger?.info('HTTPS server enabled with TLS')
      }
    }

    this.server = Bun.serve(serverOptions)

    // Start HTTP redirect server if enabled
    if (this.tlsManager?.isRedirectEnabled()) {
      const redirectPort = this.tlsManager.getRedirectPort()
      if (redirectPort) {
        const tlsConfig = this.config.security?.tls
        this.httpRedirectManager = new HTTPRedirectManager({
          port: redirectPort,
          httpsPort: listenPort,
          hostname: tlsConfig?.redirectAllowedHosts
            ? undefined
            : this.config.server?.hostname,
          allowHosts: tlsConfig?.redirectAllowedHosts,
          logger: this.config.logger,
        })
        this.httpRedirectManager.start()
      }
    }

    if (process.env.CLUSTER_WORKER) {
      this.config.logger?.info(
        `Worker ${process.env.CLUSTER_WORKER_ID} listening on port ${listenPort}`,
      )
    } else {
      const protocol = this.tlsManager ? 'https' : 'http'
      this.config.logger?.info(
        `Server listening on ${protocol}://localhost:${listenPort}`,
      )
    }

    return this.server
  }

  async close(): Promise<void> {
    if (this.clusterManager && this.isClusterMaster) {
      // In cluster mode, the cluster manager handles shutdown
      // This will be handled by the cluster manager's signal handlers
      return
    }

    // Stop HTTP redirect server if running
    if (this.httpRedirectManager) {
      this.httpRedirectManager.stop()
      this.httpRedirectManager = null
    }

    if (this.server) {
      this.server.stop()
      this.server = null
    }
  }
}

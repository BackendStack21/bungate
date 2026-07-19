/**
 * HTTP to HTTPS Redirect Server
 *
 * Provides automatic HTTP to HTTPS redirection for secure connections
 */

import type { Server } from 'bun'
import type { Logger } from '../interfaces/logger'

/**
 * HTTP redirect server configuration
 */
export interface HTTPRedirectConfig {
  /** Port to listen on for HTTP requests */
  port: number
  /** HTTPS port to redirect to */
  httpsPort: number
  /** Optional hostname for redirect (overrides request hostname) */
  hostname?: string
  /** Allowed request Host header values. Supports leading wildcards. */
  allowHosts?: string[]
  /** Logger instance */
  logger?: Logger
}

export function matchesAllowedHost(
  requestHost: string,
  allowed: string,
): boolean {
  if (allowed.startsWith('*.')) {
    const suffix = allowed.slice(2).toLowerCase()
    const h = requestHost.toLowerCase()
    return h === suffix || h.endsWith('.' + suffix)
  }
  return requestHost.toLowerCase() === allowed.toLowerCase()
}

/**
 * Creates an HTTP redirect server that redirects all requests to HTTPS
 *
 * @param config - Redirect server configuration
 * @returns Bun server instance
 *
 * @example
 * ```ts
 * const redirectServer = createHTTPRedirectServer({
 *   port: 80,
 *   httpsPort: 443,
 *   logger: myLogger
 * });
 * ```
 */
export function createHTTPRedirectServer(config: HTTPRedirectConfig): Server {
  const { port, httpsPort, hostname, allowHosts, logger } = config

  const server = Bun.serve({
    port,
    fetch: (req: Request) => {
      const url = new URL(req.url)

      // Validate the incoming Host header. When an explicit hostname is
      // configured, always use it. Otherwise only allow hosts listed in
      // allowHosts. Arbitrary request Host headers must not be used for the
      // redirect Location to prevent open-redirect / cache-poisoning (V-4).
      const requestHost = url.hostname
      const redirectHost = hostname ?? requestHost

      if (hostname) {
        if (requestHost !== '' && requestHost !== hostname) {
          logger?.warn?.('Rejected HTTP redirect for unexpected host', {
            expected: hostname,
            received: requestHost,
          })
          return new Response(JSON.stringify({ error: 'Bad Request' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }
      } else if (allowHosts && allowHosts.length > 0) {
        if (
          requestHost === '' ||
          !allowHosts.some((allowed) =>
            matchesAllowedHost(requestHost, allowed),
          )
        ) {
          logger?.warn?.('Rejected HTTP redirect for disallowed host', {
            allowed: allowHosts,
            received: requestHost,
          })
          return new Response(JSON.stringify({ error: 'Bad Request' }), {
            status: 400,
            headers: { 'content-type': 'application/json' },
          })
        }
      } else {
        // No hostname or allow-list configured: do not redirect.
        logger?.warn?.(
          'Rejected HTTP redirect: no hostname or allowHosts configured',
          {
            received: requestHost,
          },
        )
        return new Response(JSON.stringify({ error: 'Bad Request' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      }

      // Build HTTPS URL
      const httpsUrl = new URL(url)
      httpsUrl.protocol = 'https:'
      httpsUrl.hostname = redirectHost

      // Only include port in URL if it's not the default HTTPS port (443)
      if (httpsPort !== 443) {
        httpsUrl.port = httpsPort.toString()
      } else {
        httpsUrl.port = ''
      }

      logger?.debug?.({
        msg: 'HTTP to HTTPS redirect',
        from: req.url,
        to: httpsUrl.toString(),
      })

      // Return 301 Moved Permanently redirect
      return new Response(null, {
        status: 301,
        headers: {
          Location: httpsUrl.toString(),
          Connection: 'close',
        },
      })
    },
  })

  logger?.info(
    `HTTP redirect server listening on port ${port}, redirecting to HTTPS port ${httpsPort}`,
  )

  return server
}

/**
 * HTTP Redirect Manager
 * Manages the lifecycle of the HTTP redirect server
 */
export class HTTPRedirectManager {
  private server: Server | null = null
  private config: HTTPRedirectConfig

  constructor(config: HTTPRedirectConfig) {
    this.config = config
  }

  /**
   * Starts the HTTP redirect server
   */
  start(): Server {
    if (this.server) {
      throw new Error('HTTP redirect server is already running')
    }

    this.server = createHTTPRedirectServer(this.config)
    return this.server
  }

  /**
   * Stops the HTTP redirect server
   */
  stop(): void {
    if (this.server) {
      this.server.stop()
      this.server = null
      this.config.logger?.info('HTTP redirect server stopped')
    }
  }

  /**
   * Checks if the redirect server is running
   */
  isRunning(): boolean {
    return this.server !== null
  }

  /**
   * Gets the server instance
   */
  getServer(): Server | null {
    return this.server
  }
}

/**
 * Trusted Proxy Validator Module
 *
 * Validates and extracts client IP addresses from trusted proxies only.
 * Prevents IP spoofing by only accepting forwarded headers from validated proxies.
 */

import type { TrustedProxyConfig } from './config'
import type { Logger } from '../interfaces/logger'
import { isValidIP, isIPInCIDR } from './utils'
import { defaultLogger } from '../logger/pino-logger'

/**
 * Predefined trusted networks for common cloud providers and CDNs
 */
/**
 * Trusted network IP ranges for major CDN and cloud providers
 *
 * Note: These are representative samples. For production use with large-scale deployments,
 * consider fetching the complete lists dynamically:
 * - Cloudflare: https://www.cloudflare.com/ips-v4
 * - AWS CloudFront: https://ip-ranges.amazonaws.com/ip-ranges.json (filter service=CLOUDFRONT)
 * - GCP: https://www.gstatic.com/ipranges/cloud.json
 * - Azure: https://www.microsoft.com/en-us/download/details.aspx?id=56519
 *
 * Last updated: November 2024
 */
const TRUSTED_NETWORKS: Record<string, string[]> = {
  // Cloudflare IP ranges (complete list as of Nov 2024)
  // Source: https://www.cloudflare.com/ips-v4
  cloudflare: [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
  ],

  // AWS CloudFront IP ranges (representative sample - 194 total ranges)
  // Source: https://ip-ranges.amazonaws.com/ip-ranges.json
  // For production, fetch dynamically and filter by service=CLOUDFRONT
  aws: [
    '13.32.0.0/15',
    '13.224.0.0/14',
    '13.249.0.0/16',
    '15.158.0.0/16',
    '18.160.0.0/15',
    '18.164.0.0/15',
    '18.238.0.0/15',
    '18.244.0.0/15',
    '52.84.0.0/15',
    '52.222.128.0/17',
    '54.182.0.0/16',
    '54.192.0.0/16',
    '54.230.0.0/16',
    '54.230.200.0/21',
    '54.230.208.0/20',
    '54.239.128.0/18',
    '54.239.192.0/19',
    '54.240.128.0/18',
    '64.252.128.0/18',
    '65.9.128.0/18',
    '70.132.0.0/18',
    '99.84.0.0/16',
    '99.86.0.0/16',
    '108.156.0.0/14',
    '116.129.226.0/25',
    '120.52.22.96/27',
    '120.253.240.192/26',
    '120.253.245.128/26',
    '130.176.0.0/17',
    '130.176.128.0/18',
    '180.163.57.128/26',
    '204.246.164.0/22',
    '204.246.168.0/22',
    '204.246.173.0/24',
    '204.246.174.0/23',
    '204.246.176.0/20',
    '205.251.192.0/19',
    '205.251.206.0/23',
    '205.251.208.0/20',
    '205.251.249.0/24',
    '205.251.250.0/23',
    '205.251.252.0/23',
    '205.251.254.0/24',
  ],

  // Google Cloud Platform IP ranges (representative sample - 814 total ranges)
  // Source: https://www.gstatic.com/ipranges/cloud.json
  // For production, fetch dynamically from the JSON endpoint
  gcp: [
    '34.1.208.0/20',
    '34.35.0.0/16',
    '34.80.0.0/15',
    '34.137.0.0/16',
    '35.185.128.0/19',
    '35.185.160.0/20',
    '35.187.144.0/20',
    '35.189.160.0/19',
    '35.194.128.0/17',
    '35.201.128.0/17',
    '35.206.192.0/18',
    '35.220.32.0/21',
    '35.221.128.0/17',
    '35.229.128.0/17',
    '35.234.0.0/18',
    '35.235.16.0/20',
    '35.236.128.0/18',
    '35.242.32.0/21',
    '104.155.192.0/19',
    '104.155.224.0/20',
    '104.199.128.0/18',
    '104.199.192.0/19',
    '104.199.224.0/20',
    '107.167.176.0/20',
    '130.211.240.0/20',
    '35.184.0.0/13',
    '35.192.0.0/12',
    '35.208.0.0/12',
    '35.224.0.0/12',
    '35.240.0.0/13',
  ],

  // Azure IP ranges (representative sample)
  // Source: https://www.microsoft.com/en-us/download/details.aspx?id=56519
  // For production, download the ServiceTags JSON and filter by service
  azure: [
    '13.64.0.0/11',
    '13.96.0.0/13',
    '13.104.0.0/14',
    '20.33.0.0/16',
    '20.34.0.0/15',
    '20.36.0.0/14',
    '20.40.0.0/13',
    '20.48.0.0/12',
    '20.64.0.0/10',
    '20.128.0.0/16',
    '40.64.0.0/10',
    '51.4.0.0/15',
    '51.8.0.0/16',
    '51.10.0.0/15',
    '51.12.0.0/15',
    '51.18.0.0/16',
    '51.51.0.0/16',
    '51.53.0.0/16',
    '51.103.0.0/16',
    '51.104.0.0/15',
    '51.107.0.0/16',
    '51.116.0.0/16',
    '51.120.0.0/16',
    '51.124.0.0/16',
    '51.132.0.0/16',
    '51.136.0.0/15',
    '51.138.0.0/16',
    '51.140.0.0/14',
    '51.144.0.0/15',
    '52.96.0.0/12',
    '52.112.0.0/14',
    '52.120.0.0/14',
    '52.125.0.0/16',
    '52.130.0.0/15',
    '52.132.0.0/14',
    '52.136.0.0/13',
    '52.145.0.0/16',
    '52.146.0.0/15',
    '52.148.0.0/14',
    '52.152.0.0/13',
    '52.160.0.0/11',
    '52.224.0.0/11',
  ],
}

/**
 * Trusted Proxy Validator
 *
 * Validates proxy IP addresses and extracts client IPs from forwarded headers.
 * Only trusts forwarded headers from validated proxies to prevent IP spoofing.
 */
export class TrustedProxyValidator {
  private config: TrustedProxyConfig
  private logger: Logger
  private trustedCIDRs: string[] = []

  /**
   * Initialize the trusted proxy validator
   *
   * @param config - Trusted proxy configuration
   * @param logger - Logger instance for security logging
   */
  constructor(config: TrustedProxyConfig, logger?: Logger) {
    this.config = config
    this.logger = logger || defaultLogger

    // Build list of trusted CIDR ranges
    this.buildTrustedCIDRs()

    this.logger.info('Trusted proxy validator initialized', {
      enabled: config.enabled,
      trustedIPCount: config.trustedIPs?.length || 0,
      trustedNetworkCount: config.trustedNetworks?.length || 0,
      maxForwardedDepth: config.maxForwardedDepth || 'unlimited',
      trustAll: config.trustAll || false,
    })
  }

  /**
   * Build the list of trusted CIDR ranges from configuration
   */
  private buildTrustedCIDRs(): void {
    this.trustedCIDRs = []

    // Add explicitly configured IPs/CIDRs
    if (this.config.trustedIPs) {
      this.trustedCIDRs.push(...this.config.trustedIPs)
    }

    // Add predefined trusted networks
    if (this.config.trustedNetworks) {
      for (const networkName of this.config.trustedNetworks) {
        const networkRanges = TRUSTED_NETWORKS[networkName.toLowerCase()]
        if (networkRanges) {
          this.trustedCIDRs.push(...networkRanges)
          this.logger.debug(`Added trusted network: ${networkName}`, {
            rangeCount: networkRanges.length,
          })
        } else {
          this.logger.warn(`Unknown trusted network: ${networkName}`)
        }
      }
    }
  }

  /**
   * Validate if a proxy IP address is trusted
   *
   * @param remoteIP - The IP address to validate
   * @returns true if the IP is trusted, false otherwise
   */
  validateProxy(remoteIP: string): boolean {
    if (!this.config.enabled) {
      return false
    }

    // Dangerous: trust all proxies (should not be used in production)
    if (this.config.trustAll) {
      this.logger.warn(
        'trustAll is enabled - all proxies are trusted (INSECURE)',
        {
          remoteIP,
        },
      )
      return true
    }

    // Validate IP format
    if (!isValidIP(remoteIP)) {
      this.logger.warn('Invalid IP format', { remoteIP })
      return false
    }

    // Check if IP is in any trusted CIDR range
    for (const cidr of this.trustedCIDRs) {
      if (isIPInCIDR(remoteIP, cidr)) {
        this.logger.debug('Proxy validated', { remoteIP, cidr })
        return true
      }
    }

    this.logger.debug('Proxy not trusted', { remoteIP })
    return false
  }

  /**
   * Extract the real client IP from request headers.
   *
   * Only trusts forwarded headers if the immediate proxy (remoteIP) is validated.
   * Walks the X-Forwarded-For chain from right to left, skipping consecutive
   * trusted proxies, and returns the first untrusted IP. This prevents attackers
   * from prepending arbitrary IPs to the left of a valid forwarded chain.
   *
   * @param req - The HTTP request
   * @param remoteIP - The direct connection IP address (must come from the socket)
   * @returns The extracted client IP address
   */
  extractClientIP(req: Request, remoteIP: string): string {
    if (!this.config.enabled) {
      return remoteIP
    }

    // If the immediate proxy is not trusted, ignore all forwarded headers
    if (!this.validateProxy(remoteIP)) {
      this.logger.debug('Using direct connection IP (proxy not trusted)', {
        remoteIP,
      })
      return remoteIP
    }

    const headers = req.headers

    // X-Forwarded-For: client, proxy1, proxy2, ..., immediateProxy
    const xForwardedFor = headers.get('x-forwarded-for')
    if (xForwardedFor) {
      const chain = xForwardedFor
        .split(',')
        .map((ip) => ip.trim())
        .filter(Boolean)

      if (!this.validateForwardedChain(chain)) {
        this.logger.warn('Invalid forwarded header chain detected', {
          chain: chain.join(', '),
          remoteIP,
        })
        return remoteIP
      }

      // Walk from right to left, skipping trusted proxies. The rightmost entry
      // was added by the proxy closest to the server (the immediate proxy).
      let clientIP: string | null = null
      for (let i = chain.length - 1; i >= 0; i--) {
        const ip = chain[i]!
        if (this.isInTrustedNetwork(ip)) {
          continue
        }
        clientIP = ip
        break
      }

      // If every entry in the chain is a trusted proxy, fall back to the
      // leftmost entry (the original client as seen by the first trusted proxy).
      if (!clientIP) {
        clientIP = chain[0] ?? null
      }

      if (clientIP && isValidIP(clientIP)) {
        this.logger.debug('Extracted client IP from X-Forwarded-For', {
          clientIP,
          chain: chain.join(', '),
          remoteIP,
        })
        return clientIP
      }
    }

    // Prefer Cloudflare-signed header only when explicitly enabled (V-18).
    if (this.config.trustCloudflare) {
      const cfConnectingIP = headers.get('cf-connecting-ip')
      if (cfConnectingIP && isValidIP(cfConnectingIP)) {
        this.logger.debug('Extracted client IP from CF-Connecting-IP', {
          clientIP: cfConnectingIP,
          remoteIP,
        })
        return cfConnectingIP
      }
    }

    // X-Real-IP / X-Client-IP are only trustworthy when explicitly enabled
    // and the immediate proxy has been validated above (V-18).
    if (this.config.trustXRealIP) {
      const xRealIP = headers.get('x-real-ip')
      if (xRealIP && isValidIP(xRealIP)) {
        this.logger.debug('Extracted client IP from X-Real-IP', {
          clientIP: xRealIP,
          remoteIP,
        })
        return xRealIP
      }

      const xClientIP = headers.get('x-client-ip')
      if (xClientIP && isValidIP(xClientIP)) {
        this.logger.debug('Extracted client IP from X-Client-IP', {
          clientIP: xClientIP,
          remoteIP,
        })
        return xClientIP
      }
    }

    // No valid forwarded header found, use direct connection IP
    this.logger.debug(
      'No valid forwarded headers, using direct connection IP',
      {
        remoteIP,
      },
    )
    return remoteIP
  }

  /**
   * Validate the forwarded header chain
   *
   * Checks that the chain length doesn't exceed the maximum depth
   * and that all IPs in the chain are valid.
   *
   * @param chain - Array of IP addresses from the forwarded header
   * @returns true if the chain is valid, false otherwise
   */
  validateForwardedChain(chain: string[]): boolean {
    if (!chain || chain.length === 0) {
      return false
    }

    // Check maximum depth if configured
    const maxDepth = this.config.maxForwardedDepth
    if (maxDepth && chain.length > maxDepth) {
      this.logger.warn('Forwarded header chain exceeds maximum depth', {
        chainLength: chain.length,
        maxDepth,
        chain: chain.join(', '),
      })
      return false
    }

    // Validate all IPs in the chain
    for (const ip of chain) {
      if (!isValidIP(ip)) {
        this.logger.warn('Invalid IP in forwarded header chain', {
          invalidIP: ip,
          chain: chain.join(', '),
        })
        return false
      }
    }

    return true
  }

  /**
   * Check if an IP is in a trusted network
   *
   * @param ip - The IP address to check
   * @returns true if the IP is in a trusted network, false otherwise
   */
  isInTrustedNetwork(ip: string): boolean {
    if (!isValidIP(ip)) {
      return false
    }

    // When trustAll is enabled every hop is considered trusted.
    if (this.config.trustAll) {
      return true
    }

    for (const cidr of this.trustedCIDRs) {
      if (isIPInCIDR(ip, cidr)) {
        return true
      }
    }

    return false
  }

  /**
   * Get the list of trusted CIDR ranges
   *
   * @returns Array of trusted CIDR ranges
   */
  getTrustedCIDRs(): string[] {
    return [...this.trustedCIDRs]
  }

  /**
   * Get the configuration
   *
   * @returns The trusted proxy configuration
   */
  getConfig(): TrustedProxyConfig {
    return { ...this.config }
  }
}

/**
 * Factory function to create a trusted proxy validator
 *
 * @param config - Trusted proxy configuration
 * @param logger - Optional logger instance
 * @returns TrustedProxyValidator instance
 */
export function createTrustedProxyValidator(
  config: TrustedProxyConfig,
  logger?: Logger,
): TrustedProxyValidator {
  return new TrustedProxyValidator(config, logger)
}

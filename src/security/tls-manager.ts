/**
 * TLS/HTTPS Configuration and Management Module
 *
 * Provides secure TLS configuration, certificate loading, and validation
 * for HTTPS support in the Bungate API Gateway.
 */

import { readFileSync } from 'fs'
import type { TLSConfig } from './config'
import type { ValidationResult } from './types'

/**
 * OpenSSL SSL_OP_* bitmasks used for Bun's `secureOptions` TLS setting.
 */
const SSL_OP_NO_SSLv2 = 0x01000000
const SSL_OP_NO_SSLv3 = 0x02000000
const SSL_OP_NO_TLSv1 = 0x04000000
const SSL_OP_NO_TLSv1_1 = 0x08000000
const SSL_OP_NO_TLSv1_2 = 0x10000000

/**
 * Bun TLS options interface.
 *
 * Note: Bun does not expose `minVersion` or `cipherSuites` keys. They are
 * mapped here to `secureOptions` and `ciphers` respectively.
 */
export interface BunTLSOptions {
  cert?: string | Buffer
  key?: string | Buffer
  ca?: string | Buffer
  passphrase?: string
  dhParamsFile?: string
  secureOptions?: number
  ciphers?: string
  requestCert?: boolean
  rejectUnauthorized?: boolean
}

/**
 * Secure default cipher suites (TLS 1.2 and 1.3)
 * Prioritizes forward secrecy and strong encryption
 */
export const DEFAULT_CIPHER_SUITES = [
  // TLS 1.3 cipher suites (preferred)
  'TLS_AES_256_GCM_SHA384',
  'TLS_CHACHA20_POLY1305_SHA256',
  'TLS_AES_128_GCM_SHA256',

  // TLS 1.2 cipher suites with forward secrecy
  'ECDHE-RSA-AES256-GCM-SHA384',
  'ECDHE-RSA-AES128-GCM-SHA256',
  'ECDHE-RSA-CHACHA20-POLY1305',
]

/**
 * TLS Manager for certificate handling and configuration
 */
export class TLSManager {
  private config: TLSConfig
  private tlsOptions: BunTLSOptions | null = null

  constructor(config: TLSConfig) {
    this.config = config
  }

  /**
   * Loads certificates from files or buffers
   * Validates that required certificates are present
   */
  async loadCertificates(): Promise<void> {
    if (!this.config.enabled) {
      return
    }

    const tlsOptions: BunTLSOptions = {}

    // Load certificate
    if (this.config.cert) {
      if (typeof this.config.cert === 'string') {
        try {
          tlsOptions.cert = readFileSync(this.config.cert)
        } catch (error) {
          throw new Error(
            `Failed to load TLS certificate: ${error instanceof Error ? error.message : error}`,
          )
        }
      } else {
        tlsOptions.cert = this.config.cert
      }
    }

    // Load private key
    if (this.config.key) {
      if (typeof this.config.key === 'string') {
        try {
          tlsOptions.key = readFileSync(this.config.key)
        } catch (error) {
          throw new Error(
            `Failed to load TLS private key: ${error instanceof Error ? error.message : error}`,
          )
        }
      } else {
        tlsOptions.key = this.config.key
      }
    }

    // Load CA certificate (optional)
    if (this.config.ca) {
      if (typeof this.config.ca === 'string') {
        try {
          tlsOptions.ca = readFileSync(this.config.ca)
        } catch (error) {
          throw new Error(
            `Failed to load TLS CA certificate: ${error instanceof Error ? error.message : error}`,
          )
        }
      } else {
        tlsOptions.ca = this.config.ca
      }
    }

    this.tlsOptions = tlsOptions
  }

  /**
   * Validates TLS configuration
   * Ensures all required fields are present and valid
   */
  validateConfig(): ValidationResult {
    const errors: string[] = []

    if (!this.config.enabled) {
      return { valid: true }
    }

    // Validate required fields
    if (!this.config.cert) {
      errors.push('TLS enabled but certificate not provided')
    }

    if (!this.config.key) {
      errors.push('TLS enabled but private key not provided')
    }

    // Validate minimum TLS version
    if (this.config.minVersion) {
      const validVersions = ['TLSv1.2', 'TLSv1.3']
      if (!validVersions.includes(this.config.minVersion)) {
        errors.push(
          `Invalid TLS version: ${this.config.minVersion}. Must be one of: ${validVersions.join(', ')}`,
        )
      }
    }

    // Validate cipher suites if provided
    if (this.config.cipherSuites && this.config.cipherSuites.length === 0) {
      errors.push('Cipher suites array cannot be empty')
    }

    // Validate HTTP redirect configuration
    if (this.config.redirectHTTP) {
      if (!this.config.redirectPort) {
        errors.push('HTTP redirect enabled but redirectPort not specified')
      } else if (
        this.config.redirectPort < 1 ||
        this.config.redirectPort > 65535
      ) {
        errors.push('redirectPort must be between 1 and 65535')
      }
    }

    // Validate client certificate configuration
    if (this.config.requestCert && !this.config.ca) {
      errors.push(
        'Client certificate validation requested but CA certificate not provided',
      )
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }

  /**
   * Gets TLS options for Bun.serve()
   * Returns null if TLS is not enabled
   */
  getTLSOptions(): BunTLSOptions | null {
    if (!this.config.enabled || !this.tlsOptions) {
      return null
    }

    const options: BunTLSOptions = { ...this.tlsOptions }

    // Map the high-level minVersion option to Bun's secureOptions bitmask (V-10).
    if (this.config.minVersion) {
      let secureOptions =
        SSL_OP_NO_SSLv2 | SSL_OP_NO_SSLv3 | SSL_OP_NO_TLSv1 | SSL_OP_NO_TLSv1_1
      if (this.config.minVersion === 'TLSv1.3') {
        secureOptions |= SSL_OP_NO_TLSv1_2
      }
      options.secureOptions = secureOptions
    }

    // Map cipher suites to Bun's `ciphers` OpenSSL string (V-10).
    if (this.config.cipherSuites && this.config.cipherSuites.length > 0) {
      options.ciphers = this.config.cipherSuites.join(':')
    }

    if (this.config.requestCert != null) {
      options.requestCert = this.config.requestCert
    }

    if (this.config.rejectUnauthorized != null) {
      options.rejectUnauthorized = this.config.rejectUnauthorized
    }

    return options
  }

  /**
   * Gets the configured cipher suites or defaults
   */
  getCipherSuites(): string[] {
    return this.config.cipherSuites || DEFAULT_CIPHER_SUITES
  }

  /**
   * Gets the minimum TLS version
   */
  getMinVersion(): 'TLSv1.2' | 'TLSv1.3' {
    return this.config.minVersion || 'TLSv1.2'
  }

  /**
   * Checks if HTTP to HTTPS redirect is enabled
   */
  isRedirectEnabled(): boolean {
    return this.config.redirectHTTP === true
  }

  /**
   * Gets the HTTP redirect port
   */
  getRedirectPort(): number | undefined {
    return this.config.redirectPort
  }

  /**
   * Gets the TLS configuration
   */
  getConfig(): TLSConfig {
    return this.config
  }

  /**
   * Validates certificate on startup
   * Performs basic validation to ensure certificates are loadable
   */
  async validateCertificates(): Promise<ValidationResult> {
    const errors: string[] = []

    if (!this.config.enabled) {
      return { valid: true }
    }

    try {
      await this.loadCertificates()
    } catch (error) {
      errors.push(`Certificate validation failed: ${error}`)
    }

    // Validate that certificates were loaded
    if (this.tlsOptions) {
      if (!this.tlsOptions.cert) {
        errors.push('Certificate not loaded')
      }
      if (!this.tlsOptions.key) {
        errors.push('Private key not loaded')
      }
    } else {
      errors.push('TLS options not initialized')
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    }
  }
}

/**
 * Creates a TLS manager instance
 */
export function createTLSManager(config: TLSConfig): TLSManager {
  return new TLSManager(config)
}

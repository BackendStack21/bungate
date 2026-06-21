import { describe, test, expect, beforeEach } from 'bun:test'
import {
  TLSManager,
  createTLSManager,
  DEFAULT_CIPHER_SUITES,
} from '../../src/security/tls-manager'
import type { TLSConfig } from '../../src/security/config'
import { readFileSync } from 'fs'

describe('TLSManager', () => {
  const validConfig: TLSConfig = {
    enabled: true,
    cert: './examples/cert.pem',
    key: './examples/key.pem',
    minVersion: 'TLSv1.2',
  }

  describe('constructor and factory', () => {
    test('should create TLSManager instance', () => {
      const manager = new TLSManager(validConfig)
      expect(manager).toBeDefined()
      expect(manager.getConfig()).toEqual(validConfig)
    })

    test('should create TLSManager via factory function', () => {
      const manager = createTLSManager(validConfig)
      expect(manager).toBeDefined()
      expect(manager).toBeInstanceOf(TLSManager)
    })
  })

  describe('validateConfig', () => {
    test('should validate correct configuration', () => {
      const manager = new TLSManager(validConfig)
      const result = manager.validateConfig()
      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    test('should return valid for disabled TLS', () => {
      const manager = new TLSManager({ enabled: false })
      const result = manager.validateConfig()
      expect(result.valid).toBe(true)
    })

    test('should fail validation when cert is missing', () => {
      const config: TLSConfig = {
        enabled: true,
        key: './key.pem',
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'TLS enabled but certificate not provided',
      )
    })

    test('should fail validation when key is missing', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'TLS enabled but private key not provided',
      )
    })

    test('should fail validation for invalid TLS version', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        minVersion: 'TLSv1.0' as any,
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain('Invalid TLS version')
    })

    test('should fail validation for empty cipher suites', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        cipherSuites: [],
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('Cipher suites array cannot be empty')
    })

    test('should fail validation when redirect port is missing', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        redirectHTTP: true,
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'HTTP redirect enabled but redirectPort not specified',
      )
    })

    test('should fail validation for invalid redirect port', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        redirectHTTP: true,
        redirectPort: 70000,
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain(
        'redirectPort must be between 1 and 65535',
      )
    })

    test('should fail validation when requestCert without CA', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        requestCert: true,
      }
      const manager = new TLSManager(config)
      const result = manager.validateConfig()
      expect(result.valid).toBe(false)
      expect(result.errors).toContain(
        'Client certificate validation requested but CA certificate not provided',
      )
    })
  })

  describe('loadCertificates', () => {
    test('should load certificates from file paths', async () => {
      const manager = new TLSManager(validConfig)
      await manager.loadCertificates()
      const tlsOptions = manager.getTLSOptions()
      expect(tlsOptions).toBeDefined()
      expect(tlsOptions?.cert).toBeInstanceOf(Buffer)
      expect(tlsOptions?.key).toBeInstanceOf(Buffer)
    })

    test('should accept certificate as Buffer', async () => {
      const certBuffer = readFileSync('./examples/cert.pem')
      const keyBuffer = readFileSync('./examples/key.pem')
      const config: TLSConfig = {
        enabled: true,
        cert: certBuffer,
        key: keyBuffer,
      }
      const manager = new TLSManager(config)
      await manager.loadCertificates()
      const tlsOptions = manager.getTLSOptions()
      expect(tlsOptions?.cert).toEqual(certBuffer)
      expect(tlsOptions?.key).toEqual(keyBuffer)
    })

    test('should throw error for invalid certificate path', async () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './nonexistent-cert.pem',
        key: './examples/key.pem',
      }
      const manager = new TLSManager(config)
      await expect(manager.loadCertificates()).rejects.toThrow(
        'Failed to load TLS certificate',
      )
    })

    test('should throw error for invalid key path', async () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './examples/cert.pem',
        key: './nonexistent-key.pem',
      }
      const manager = new TLSManager(config)
      await expect(manager.loadCertificates()).rejects.toThrow(
        'Failed to load TLS private key',
      )
    })

    test('should not load certificates when TLS is disabled', async () => {
      const manager = new TLSManager({ enabled: false })
      await manager.loadCertificates()
      const tlsOptions = manager.getTLSOptions()
      expect(tlsOptions).toBeNull()
    })

    test('should load CA certificate when provided', async () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './examples/cert.pem',
        key: './examples/key.pem',
        ca: './examples/cert.pem', // Using cert as CA for testing
      }
      const manager = new TLSManager(config)
      await manager.loadCertificates()
      const tlsOptions = manager.getTLSOptions()
      expect(tlsOptions?.ca).toBeInstanceOf(Buffer)
    })
  })

  describe('validateCertificates', () => {
    test('should validate loaded certificates', async () => {
      const manager = new TLSManager(validConfig)
      const result = await manager.validateCertificates()
      expect(result.valid).toBe(true)
      expect(result.errors).toBeUndefined()
    })

    test('should return valid for disabled TLS', async () => {
      const manager = new TLSManager({ enabled: false })
      const result = await manager.validateCertificates()
      expect(result.valid).toBe(true)
    })

    test('should fail validation when certificates not loaded', async () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './nonexistent.pem',
        key: './nonexistent.pem',
      }
      const manager = new TLSManager(config)
      const result = await manager.validateCertificates()
      expect(result.valid).toBe(false)
      expect(result.errors?.[0]).toContain('Certificate validation failed')
    })
  })

  describe('cipher suites and TLS version', () => {
    test('should return default cipher suites', () => {
      const manager = new TLSManager(validConfig)
      const cipherSuites = manager.getCipherSuites()
      expect(cipherSuites).toEqual(DEFAULT_CIPHER_SUITES)
    })

    test('should return custom cipher suites', () => {
      const customSuites = [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
      ]
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        cipherSuites: customSuites,
      }
      const manager = new TLSManager(config)
      expect(manager.getCipherSuites()).toEqual(customSuites)
    })

    test('should return default minimum TLS version', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
      }
      const manager = new TLSManager(config)
      expect(manager.getMinVersion()).toBe('TLSv1.2')
    })

    test('should return custom minimum TLS version', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        minVersion: 'TLSv1.3',
      }
      const manager = new TLSManager(config)
      expect(manager.getMinVersion()).toBe('TLSv1.3')
    })
  })

  describe('HTTP redirect configuration', () => {
    test('should detect redirect enabled', () => {
      const config: TLSConfig = {
        enabled: true,
        cert: './cert.pem',
        key: './key.pem',
        redirectHTTP: true,
        redirectPort: 80,
      }
      const manager = new TLSManager(config)
      expect(manager.isRedirectEnabled()).toBe(true)
      expect(manager.getRedirectPort()).toBe(80)
    })

    test('should detect redirect disabled', () => {
      const manager = new TLSManager(validConfig)
      expect(manager.isRedirectEnabled()).toBe(false)
      expect(manager.getRedirectPort()).toBeUndefined()
    })
  })

  describe('DEFAULT_CIPHER_SUITES', () => {
    test('should include TLS 1.3 cipher suites', () => {
      expect(DEFAULT_CIPHER_SUITES).toContain('TLS_AES_256_GCM_SHA384')
      expect(DEFAULT_CIPHER_SUITES).toContain('TLS_CHACHA20_POLY1305_SHA256')
      expect(DEFAULT_CIPHER_SUITES).toContain('TLS_AES_128_GCM_SHA256')
    })

    test('should include TLS 1.2 cipher suites with forward secrecy', () => {
      expect(DEFAULT_CIPHER_SUITES).toContain('ECDHE-RSA-AES256-GCM-SHA384')
      expect(DEFAULT_CIPHER_SUITES).toContain('ECDHE-RSA-AES128-GCM-SHA256')
      expect(DEFAULT_CIPHER_SUITES).toContain('ECDHE-RSA-CHACHA20-POLY1305')
    })
  })
})

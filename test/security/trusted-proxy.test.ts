import { describe, test, expect } from 'bun:test'
import {
  TrustedProxyValidator,
  createTrustedProxyValidator,
} from '../../src/security/trusted-proxy'
import type { TrustedProxyConfig } from '../../src/security/config'

describe('TrustedProxyValidator', () => {
  describe('constructor and factory', () => {
    test('should create TrustedProxyValidator instance', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)
      expect(validator).toBeDefined()
    })

    test('should create TrustedProxyValidator via factory function', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = createTrustedProxyValidator(config)
      expect(validator).toBeDefined()
      expect(validator).toBeInstanceOf(TrustedProxyValidator)
    })

    test('should initialize with empty trusted IPs', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
      }
      const validator = new TrustedProxyValidator(config)
      expect(validator.getTrustedCIDRs()).toEqual([])
    })

    test('should initialize with trusted networks', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['cloudflare'],
      }
      const validator = new TrustedProxyValidator(config)
      const cidrs = validator.getTrustedCIDRs()
      expect(cidrs.length).toBeGreaterThan(0)
      expect(cidrs).toContain('173.245.48.0/20')
    })
  })

  describe('CIDR notation validation', () => {
    test('should validate IP in CIDR range', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.0/24'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('192.168.1.1')).toBe(true)
      expect(validator.validateProxy('192.168.1.100')).toBe(true)
      expect(validator.validateProxy('192.168.1.255')).toBe(true)
    })

    test('should reject IP outside CIDR range', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.0/24'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('192.168.2.1')).toBe(false)
      expect(validator.validateProxy('10.0.0.1')).toBe(false)
      expect(validator.validateProxy('172.16.0.1')).toBe(false)
    })

    test('should handle exact IP match without CIDR notation', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.100'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('192.168.1.100')).toBe(true)
      expect(validator.validateProxy('192.168.1.101')).toBe(false)
    })

    test('should handle multiple CIDR ranges', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.0/24', '10.0.0.0/16', '172.16.0.0/12'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('192.168.1.50')).toBe(true)
      expect(validator.validateProxy('10.0.5.10')).toBe(true)
      expect(validator.validateProxy('172.20.1.1')).toBe(true)
      expect(validator.validateProxy('8.8.8.8')).toBe(false)
    })

    test('should handle /32 CIDR (single IP)', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.100/32'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('192.168.1.100')).toBe(true)
      expect(validator.validateProxy('192.168.1.101')).toBe(false)
    })

    test('should handle /8 CIDR (large range)', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['10.0.0.0/8'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('10.0.0.1')).toBe(true)
      expect(validator.validateProxy('10.255.255.255')).toBe(true)
      expect(validator.validateProxy('11.0.0.1')).toBe(false)
    })
  })

  describe('trusted network detection', () => {
    test('should recognize Cloudflare IPs', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['cloudflare'],
      }
      const validator = new TrustedProxyValidator(config)

      // Test a few Cloudflare IP ranges
      expect(validator.validateProxy('173.245.48.1')).toBe(true)
      expect(validator.validateProxy('103.21.244.1')).toBe(true)
      expect(validator.validateProxy('8.8.8.8')).toBe(false)
    })

    test('should recognize AWS IPs', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['aws'],
      }
      const validator = new TrustedProxyValidator(config)

      // Test a few AWS CloudFront IP ranges
      expect(validator.validateProxy('13.32.0.1')).toBe(true)
      expect(validator.validateProxy('52.84.0.1')).toBe(true)
      expect(validator.validateProxy('8.8.8.8')).toBe(false)
    })

    test('should recognize GCP IPs', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['gcp'],
      }
      const validator = new TrustedProxyValidator(config)

      // Test a few GCP IP ranges
      expect(validator.validateProxy('35.192.0.1')).toBe(true)
      expect(validator.validateProxy('35.208.0.1')).toBe(true)
      expect(validator.validateProxy('8.8.8.8')).toBe(false)
    })

    test('should recognize Azure IPs', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['azure'],
      }
      const validator = new TrustedProxyValidator(config)

      // Test a few Azure IP ranges
      expect(validator.validateProxy('13.64.0.1')).toBe(true)
      expect(validator.validateProxy('40.64.0.1')).toBe(true)
      expect(validator.validateProxy('8.8.8.8')).toBe(false)
    })

    test('should combine multiple trusted networks', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['cloudflare', 'aws'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('173.245.48.1')).toBe(true) // Cloudflare
      expect(validator.validateProxy('13.32.0.1')).toBe(true) // AWS
      expect(validator.validateProxy('8.8.8.8')).toBe(false) // Neither
    })

    test('should handle unknown network names gracefully', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['unknown-network'],
      }
      const validator = new TrustedProxyValidator(config)

      // Should not crash, just ignore unknown network
      expect(validator.getTrustedCIDRs()).toEqual([])
    })
  })

  describe('forwarded header chain validation', () => {
    test('should validate a simple forwarded chain', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const chain = ['203.0.113.1', '192.168.1.1']
      expect(validator.validateForwardedChain(chain)).toBe(true)
    })

    test('should reject chain exceeding max depth', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
        maxForwardedDepth: 3,
      }
      const validator = new TrustedProxyValidator(config)

      const shortChain = ['203.0.113.1', '192.168.1.1', '10.0.0.1']
      expect(validator.validateForwardedChain(shortChain)).toBe(true)

      const longChain = ['203.0.113.1', '192.168.1.1', '10.0.0.1', '172.16.0.1']
      expect(validator.validateForwardedChain(longChain)).toBe(false)
    })

    test('should reject chain with invalid IP', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const invalidChain = ['203.0.113.1', 'invalid-ip', '192.168.1.1']
      expect(validator.validateForwardedChain(invalidChain)).toBe(false)
    })

    test('should reject empty chain', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateForwardedChain([])).toBe(false)
    })

    test('should validate chain with single IP', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const chain = ['203.0.113.1']
      expect(validator.validateForwardedChain(chain)).toBe(true)
    })

    test('should allow unlimited depth when maxForwardedDepth not set', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const longChain = Array(100).fill('203.0.113.1')
      expect(validator.validateForwardedChain(longChain)).toBe(true)
    })
  })

  describe('IP spoofing prevention', () => {
    test('should not trust X-Forwarded-For from untrusted proxy', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Forwarded-For': '203.0.113.1, 192.168.1.1',
        },
      })

      const untrustedProxyIP = '8.8.8.8'
      const clientIP = validator.extractClientIP(request, untrustedProxyIP)

      // Should return the direct connection IP, not the forwarded one
      expect(clientIP).toBe(untrustedProxyIP)
    })

    test('should trust X-Forwarded-For from trusted proxy', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Forwarded-For': '203.0.113.1, 192.168.1.1',
        },
      })

      const trustedProxyIP = '192.168.1.1'
      const clientIP = validator.extractClientIP(request, trustedProxyIP)

      // Should extract the first IP from the chain
      expect(clientIP).toBe('203.0.113.1')
    })

    test('should handle malformed X-Forwarded-For header', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Forwarded-For': 'invalid-ip, another-invalid',
        },
      })

      const trustedProxyIP = '192.168.1.1'
      const clientIP = validator.extractClientIP(request, trustedProxyIP)

      // Should fall back to direct connection IP
      expect(clientIP).toBe(trustedProxyIP)
    })

    test('should extract from X-Real-IP when X-Forwarded-For is missing', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
        trustXRealIP: true,
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Real-IP': '203.0.113.1',
        },
      })

      const trustedProxyIP = '192.168.1.1'
      const clientIP = validator.extractClientIP(request, trustedProxyIP)

      expect(clientIP).toBe('203.0.113.1')
    })

    test('should extract from CF-Connecting-IP for Cloudflare', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedNetworks: ['cloudflare'],
        trustCloudflare: true,
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'CF-Connecting-IP': '203.0.113.1',
        },
      })

      const cloudflareIP = '173.245.48.1'
      const clientIP = validator.extractClientIP(request, cloudflareIP)

      expect(clientIP).toBe('203.0.113.1')
    })

    test('should extract from X-Client-IP as fallback', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
        trustXRealIP: true,
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Client-IP': '203.0.113.1',
        },
      })

      const trustedProxyIP = '192.168.1.1'
      const clientIP = validator.extractClientIP(request, trustedProxyIP)

      expect(clientIP).toBe('203.0.113.1')
    })

    test('should return direct IP when no forwarded headers present', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com')

      const trustedProxyIP = '192.168.1.1'
      const clientIP = validator.extractClientIP(request, trustedProxyIP)

      expect(clientIP).toBe(trustedProxyIP)
    })

    test('should handle X-Forwarded-For with whitespace', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Forwarded-For': '  203.0.113.1  ,  192.168.1.1  ',
        },
      })

      const trustedProxyIP = '192.168.1.1'
      const clientIP = validator.extractClientIP(request, trustedProxyIP)

      expect(clientIP).toBe('203.0.113.1')
    })
  })

  describe('trustAll configuration', () => {
    test('should trust all proxies when trustAll is enabled', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustAll: true,
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('8.8.8.8')).toBe(true)
      expect(validator.validateProxy('1.2.3.4')).toBe(true)
      expect(validator.validateProxy('192.168.1.1')).toBe(true)
    })

    test('should extract client IP when trustAll is enabled', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustAll: true,
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Forwarded-For': '203.0.113.1, 8.8.8.8',
        },
      })

      const anyProxyIP = '8.8.8.8'
      const clientIP = validator.extractClientIP(request, anyProxyIP)

      expect(clientIP).toBe('203.0.113.1')
    })
  })

  describe('disabled configuration', () => {
    test('should not validate proxies when disabled', () => {
      const config: TrustedProxyConfig = {
        enabled: false,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.validateProxy('192.168.1.1')).toBe(false)
      expect(validator.validateProxy('8.8.8.8')).toBe(false)
    })

    test('should return direct IP when disabled', () => {
      const config: TrustedProxyConfig = {
        enabled: false,
        trustedIPs: ['192.168.1.1'],
      }
      const validator = new TrustedProxyValidator(config)

      const request = new Request('http://example.com', {
        headers: {
          'X-Forwarded-For': '203.0.113.1',
        },
      })

      const directIP = '8.8.8.8'
      const clientIP = validator.extractClientIP(request, directIP)

      expect(clientIP).toBe(directIP)
    })
  })

  describe('isInTrustedNetwork', () => {
    test('should check if IP is in trusted network', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.0/24'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.isInTrustedNetwork('192.168.1.50')).toBe(true)
      expect(validator.isInTrustedNetwork('192.168.2.50')).toBe(false)
    })

    test('should return false for invalid IP', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.0/24'],
      }
      const validator = new TrustedProxyValidator(config)

      expect(validator.isInTrustedNetwork('invalid-ip')).toBe(false)
    })
  })

  describe('getConfig', () => {
    test('should return configuration copy', () => {
      const config: TrustedProxyConfig = {
        enabled: true,
        trustedIPs: ['192.168.1.1'],
        maxForwardedDepth: 5,
      }
      const validator = new TrustedProxyValidator(config)

      const returnedConfig = validator.getConfig()
      expect(returnedConfig).toEqual(config)
      expect(returnedConfig).not.toBe(config) // Should be a copy
    })
  })
})

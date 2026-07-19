# TLS/HTTPS Configuration Guide

This guide explains how to configure TLS/HTTPS support in Bungate API Gateway for secure encrypted communications.

## Related Documentation

- **[Security Guide](./SECURITY.md)** - Complete security hardening guide
- **[Authentication Guide](./AUTHENTICATION.md)** - Secure your APIs with auth
- **[Quick Start](./QUICK_START.md)** - Get started with basic TLS setup
- **[API Reference](./API_REFERENCE.md)** - TLS configuration options
- **[Examples](./EXAMPLES.md)** - Production TLS examples

## Table of Contents

- [Overview](#overview)
- [Basic Configuration](#basic-configuration)
  - [Minimal HTTPS Setup](#minimal-https-setup)
  - [With HTTP to HTTPS Redirect](#with-http-to-https-redirect)
- [Advanced Configuration](#advanced-configuration)
  - [Custom Cipher Suites](#custom-cipher-suites)
  - [Client Certificate Validation (mTLS)](#client-certificate-validation-mtls)
  - [Using Certificate Buffers](#using-certificate-buffers)
- [Configuration Options](#configuration-options)
- [Default Cipher Suites](#default-cipher-suites)
- [Generating Self-Signed Certificates](#generating-self-signed-certificates)
- [Production Best Practices](#production-best-practices)
- [HTTP to HTTPS Redirect](#http-to-https-redirect)
- [TLS with JWT Key Rotation](#tls-with-jwt-key-rotation)
  - [Basic Setup](#basic-setup)
  - [With JWKS](#with-jwks-json-web-key-set)
  - [Multiple Algorithm Support](#multiple-algorithm-support)
  - [Key Rotation Process](#key-rotation-process)
- [TLS Implementation Details](#tls-implementation-details)
  - [Certificate Loading](#certificate-loading)
  - [Certificate Validation](#certificate-validation)
  - [HTTP Redirect Manager](#http-redirect-manager)
  - [TLS Options for Bun](#tls-options-for-bun)
  - [Cipher Suite Configuration](#cipher-suite-configuration)
  - [Minimum TLS Version](#minimum-tls-version)
- [Complete Production Example](#complete-production-example)
- [Environment Variables](#environment-variables)
- [Monitoring and Logging](#monitoring-and-logging)
- [Troubleshooting](#troubleshooting)
- [Security Considerations](#security-considerations)
- [Examples](#examples)
- [Related Documentation](#related-documentation)

## Overview

Bungate supports TLS/HTTPS with the following features:

- **Certificate Management**: Load certificates from files or buffers
- **Cipher Suite Configuration**: Control which cipher suites are allowed
- **Protocol Version Enforcement**: Set minimum TLS version (1.2 or 1.3)
- **HTTP to HTTPS Redirect**: Automatically redirect HTTP traffic to HTTPS
- **Client Certificate Validation**: Optional mutual TLS (mTLS) support

## Basic Configuration

### Minimal HTTPS Setup

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: {
    port: 443,
  },
  security: {
    tls: {
      enabled: true,
      cert: './path/to/cert.pem',
      key: './path/to/key.pem',
    },
  },
})

await gateway.listen()
```

### With HTTP to HTTPS Redirect

```typescript
const gateway = new BunGateway({
  server: {
    port: 443, // HTTPS port
    hostname: 'example.com',
  },
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      redirectHTTP: true,
      redirectPort: 80, // HTTP port for redirects
      redirectAllowedHosts: ['example.com', '*.example.com'],
    },
  },
})
```

## Advanced Configuration

### Custom Cipher Suites

```typescript
const gateway = new BunGateway({
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
      cipherSuites: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
      ],
    },
  },
})
```

### Client Certificate Validation (mTLS)

```typescript
const gateway = new BunGateway({
  security: {
    tls: {
      enabled: true,
      cert: './server-cert.pem',
      key: './server-key.pem',
      ca: './ca-cert.pem',
      requestCert: true,
      rejectUnauthorized: true,
    },
  },
})
```

### Using Certificate Buffers

```typescript
import { readFileSync } from 'fs'

const gateway = new BunGateway({
  security: {
    tls: {
      enabled: true,
      cert: readFileSync('./cert.pem'),
      key: readFileSync('./key.pem'),
    },
  },
})
```

## Configuration Options

### TLSConfig Interface

```typescript
interface TLSConfig {
  /** Enable TLS/HTTPS */
  enabled: boolean

  /** Certificate (file path or Buffer) */
  cert?: string | Buffer

  /** Private key (file path or Buffer) */
  key?: string | Buffer

  /** CA certificate for client validation (file path or Buffer) */
  ca?: string | Buffer

  /** Minimum TLS version */
  minVersion?: 'TLSv1.2' | 'TLSv1.3'

  /** Allowed cipher suites */
  cipherSuites?: string[]

  /** Request client certificates */
  requestCert?: boolean

  /** Reject unauthorized clients */
  rejectUnauthorized?: boolean

  /** Enable HTTP to HTTPS redirect */
  redirectHTTP?: boolean

  /** HTTP port for redirects */
  redirectPort?: number

  /** Allowed Host header values for the HTTP->HTTPS redirect server. Supports leading wildcards. */
  redirectAllowedHosts?: string[]
}
```

## Default Cipher Suites

Bungate uses secure cipher suites by default, prioritizing forward secrecy:

**TLS 1.3 (Preferred):**

- `TLS_AES_256_GCM_SHA384`
- `TLS_CHACHA20_POLY1305_SHA256`
- `TLS_AES_128_GCM_SHA256`

**TLS 1.2 (Fallback):**

- `ECDHE-RSA-AES256-GCM-SHA384`
- `ECDHE-RSA-AES128-GCM-SHA256`
- `ECDHE-RSA-CHACHA20-POLY1305`

## Generating Self-Signed Certificates

For development and testing, you can generate self-signed certificates:

```bash
# Generate private key and certificate
openssl req -x509 -newkey rsa:4096 \
  -keyout key.pem -out cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost"
```

**Warning:** Self-signed certificates should never be used in production!

## Production Best Practices

### 1. Use Valid Certificates

Obtain certificates from a trusted Certificate Authority (CA):

- [Let's Encrypt](https://letsencrypt.org/) (Free)
- Commercial CAs (DigiCert, GlobalSign, etc.)

### 2. Enable TLS 1.3

```typescript
security: {
  tls: {
    enabled: true,
    minVersion: 'TLSv1.3',
    // ...
  },
}
```

### 3. Use Strong Cipher Suites

Avoid weak or deprecated cipher suites. Use the defaults or configure explicitly:

```typescript
cipherSuites: ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256']
```

### 4. Enable HTTP Strict Transport Security (HSTS)

```typescript
security: {
  tls: {
    enabled: true,
    // ...
  },
  securityHeaders: {
    enabled: true,
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
  },
}
```

### 5. Certificate Rotation

Regularly rotate certificates before expiration:

- Monitor certificate expiration dates
- Automate renewal (e.g., with Let's Encrypt)
- Test certificate updates in staging first

### 6. Secure Private Keys

- Store private keys securely (encrypted at rest)
- Use appropriate file permissions (600)
- Never commit keys to version control
- Consider using hardware security modules (HSM) for production

```bash
# Set secure permissions
chmod 600 key.pem
chmod 644 cert.pem
```

## HTTP to HTTPS Redirect

When `redirectHTTP` is enabled, Bungate automatically starts a second server on the specified port that redirects all HTTP requests to HTTPS:

```typescript
const gateway = new BunGateway({
  server: { port: 443, hostname: 'example.com' },
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      redirectHTTP: true,
      redirectPort: 80,
      redirectAllowedHosts: ['example.com', '*.example.com'],
    },
  },
})
```

The redirect server:

- Returns HTTP 301 (Moved Permanently)
- Preserves the request path and query parameters
- Sets the `Location` header to the HTTPS URL
- Validates the request `Host` against `redirectAllowedHosts` or `server.hostname` to prevent open redirects
- Closes the connection after redirect

## Troubleshooting

### Certificate Loading Errors

**Error:** `Failed to load certificate from ./cert.pem`

**Solution:**

- Verify the file path is correct
- Check file permissions
- Ensure the certificate is in PEM format

### Port Already in Use

**Error:** `EADDRINUSE: address already in use`

**Solution:**

- Check if another process is using the port
- Use a different port
- Stop the conflicting process

### Certificate Validation Failed

**Error:** `TLS certificate validation failed`

**Solution:**

- Ensure both cert and key are provided
- Verify the certificate and key match
- Check certificate expiration date
- Validate certificate format (PEM)

### Client Connection Errors

**Error:** `SSL handshake failed`

**Solution:**

- Check client TLS version compatibility
- Verify cipher suite compatibility
- Ensure certificate is trusted by client
- Check for certificate chain issues

## Security Considerations

### Compliance

The TLS configuration supports:

- PCI DSS requirements for encrypted transmission
- HIPAA security requirements
- GDPR data protection requirements
- SOC 2 security controls

## TLS with JWT Key Rotation

Combine TLS/HTTPS with JWT key rotation for comprehensive security:

### Basic Setup

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: {
    port: 443,
  },
  security: {
    // TLS configuration
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
      redirectHTTP: true,
      redirectPort: 80,
    },

    // JWT key rotation
    jwtKeyRotation: {
      secrets: [
        {
          key: process.env.JWT_SECRET_PRIMARY,
          algorithm: 'HS256',
          kid: 'primary-2024',
          primary: true,
        },
        {
          key: process.env.JWT_SECRET_OLD,
          algorithm: 'HS256',
          kid: 'old-2023',
          deprecated: true,
        },
      ],
      gracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  },

  routes: [
    {
      pattern: '/api/*',
      target: 'http://backend:3000',
      auth: {
        secret: process.env.JWT_SECRET_PRIMARY,
        jwtOptions: {
          algorithms: ['HS256'],
        },
      },
    },
  ],
})

await gateway.listen()
```

### With JWKS (JSON Web Key Set)

For dynamic key rotation using JWKS:

```typescript
const gateway = new BunGateway({
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
    },

    jwtKeyRotation: {
      jwksUri: 'https://auth.example.com/.well-known/jwks.json',
      jwksRefreshInterval: 3600000, // 1 hour
      secrets: [
        {
          key: process.env.JWT_FALLBACK_SECRET,
          algorithm: 'HS256',
          kid: 'fallback',
        },
      ],
    },
  },
})
```

### Multiple Algorithm Support

Support different JWT algorithms simultaneously:

```typescript
const gateway = new BunGateway({
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
    },

    jwtKeyRotation: {
      secrets: [
        {
          key: rsaPublicKey,
          algorithm: 'RS256',
          kid: 'rsa-key-1',
          primary: true,
        },
        {
          key: 'hmac-secret',
          algorithm: 'HS256',
          kid: 'hmac-key-1',
        },
        {
          key: ecPublicKey,
          algorithm: 'ES256',
          kid: 'ec-key-1',
        },
      ],
    },
  },
})
```

### Key Rotation Process

1. **Add New Key**: Add new key as primary
2. **Grace Period**: Keep old key for verification
3. **Monitor Usage**: Track deprecated key usage
4. **Remove Old Key**: After grace period expires

```typescript
// Step 1: Add new key (both keys active)
jwtKeyRotation: {
  secrets: [
    {
      key: 'new-secret',
      algorithm: 'HS256',
      kid: 'key-2024-02',
      primary: true,
    },
    {
      key: 'old-secret',
      algorithm: 'HS256',
      kid: 'key-2024-01',
      deprecated: true,
    },
  ],
  gracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
}

// Step 2: Monitor for 7 days
// Logs warnings when old key is used

// Step 3: Remove old key (after grace period)
jwtKeyRotation: {
  secrets: [
    {
      key: 'new-secret',
      algorithm: 'HS256',
      kid: 'key-2024-02',
      primary: true,
    },
  ],
}
```

## TLS Implementation Details

### Certificate Loading

The TLS manager automatically loads certificates from files or buffers:

```typescript
// From files
tls: {
  enabled: true,
  cert: './path/to/cert.pem',
  key: './path/to/key.pem',
  ca: './path/to/ca.pem', // Optional
}

// From buffers
import { readFileSync } from 'fs'

tls: {
  enabled: true,
  cert: readFileSync('./cert.pem'),
  key: readFileSync('./key.pem'),
}
```

### Certificate Validation

The gateway validates certificates on startup:

- Checks that both cert and key are provided
- Validates file paths and permissions
- Ensures certificates are in PEM format
- Verifies certificate and key match
- Checks certificate expiration (warning only)

### HTTP Redirect Manager

When `redirectHTTP` is enabled, a separate HTTP server is started:

```typescript
// Automatic redirect server
tls: {
  enabled: true,
  cert: './cert.pem',
  key: './key.pem',
  redirectHTTP: true,
  redirectPort: 80,
}
```

The redirect server:

- Listens on the specified port (default: 80)
- Returns HTTP 301 (Moved Permanently)
- Preserves path and query parameters
- Sets proper Location header
- Logs redirect requests

### TLS Options for Bun

The TLS manager generates Bun-compatible TLS options:

```typescript
interface BunTLSOptions {
  cert?: string | Buffer
  key?: string | Buffer
  ca?: string | Buffer
  passphrase?: string
  dhParamsFile?: string
}
```

### Cipher Suite Configuration

Default cipher suites prioritize security and performance:

**TLS 1.3 (Preferred):**

- `TLS_AES_256_GCM_SHA384` - AES-256 with GCM
- `TLS_CHACHA20_POLY1305_SHA256` - ChaCha20-Poly1305
- `TLS_AES_128_GCM_SHA256` - AES-128 with GCM

**TLS 1.2 (Fallback):**

- `ECDHE-RSA-AES256-GCM-SHA384` - Forward secrecy with AES-256
- `ECDHE-RSA-AES128-GCM-SHA256` - Forward secrecy with AES-128
- `ECDHE-RSA-CHACHA20-POLY1305` - Forward secrecy with ChaCha20

### Minimum TLS Version

Set minimum TLS version to enforce security standards. Bungate maps `minVersion` and `cipherSuites` to the Bun-native `secureOptions` and `ciphers` fields so the hardening is actually honored:

```typescript
tls: {
  enabled: true,
  minVersion: 'TLSv1.3', // or 'TLSv1.2'
  // ...
}
```

**Recommendation:** Use TLS 1.3 for new deployments. TLS 1.2 is provided for backward compatibility.

## Complete Production Example

Here's a complete example with all security features:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: {
    port: 443,
    development: false,
  },

  security: {
    // TLS/HTTPS
    tls: {
      enabled: true,
      cert: process.env.TLS_CERT_PATH,
      key: process.env.TLS_KEY_PATH,
      ca: process.env.TLS_CA_PATH,
      minVersion: 'TLSv1.3',
      cipherSuites: ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'],
      redirectHTTP: true,
      redirectPort: 80,
      redirectAllowedHosts: ['example.com', '*.example.com'],
    },

    // Input validation
    inputValidation: {
      maxPathLength: 2048,
      maxHeaderSize: 16384,
      maxHeaderCount: 100,
      sanitizeHeaders: true,
    },

    // Security headers
    securityHeaders: {
      enabled: true,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'", 'https:'],
          'frame-ancestors': ["'none'"],
        },
      },
      xFrameOptions: 'DENY',
      xContentTypeOptions: true,
    },

    // Size limits
    sizeLimits: {
      maxBodySize: 10 * 1024 * 1024,
      maxHeaderSize: 16 * 1024,
      maxHeaderCount: 100,
    },

    // JWT key rotation
    jwtKeyRotation: {
      secrets: [
        {
          key: process.env.JWT_SECRET_PRIMARY,
          algorithm: 'HS256',
          kid: 'primary-2024',
          primary: true,
        },
        {
          key: process.env.JWT_SECRET_OLD,
          algorithm: 'HS256',
          kid: 'old-2023',
          deprecated: true,
        },
      ],
      gracePeriod: 7 * 24 * 60 * 60 * 1000,
    },

    // Trusted proxies
    trustedProxies: {
      enabled: true,
      trustedNetworks: ['cloudflare'],
      maxForwardedDepth: 2,
    },
  },

  routes: [
    {
      pattern: '/api/*',
      target: 'http://backend:3000',
      auth: {
        secret: process.env.JWT_SECRET_PRIMARY,
        jwtOptions: {
          algorithms: ['HS256'],
          issuer: 'https://auth.example.com',
          audience: 'https://api.example.com',
        },
      },
      rateLimit: {
        max: 1000,
        windowMs: 60000,
      },
    },
  ],
})

await gateway.listen()
```

## Environment Variables

Recommended environment variables for production:

```bash
# TLS Configuration
TLS_CERT_PATH=/path/to/cert.pem
TLS_KEY_PATH=/path/to/key.pem
TLS_CA_PATH=/path/to/ca.pem

# JWT Secrets
JWT_SECRET_PRIMARY=your-primary-secret-key
JWT_SECRET_OLD=your-old-secret-key

# Optional: JWKS
JWKS_URI=https://auth.example.com/.well-known/jwks.json
```

## Monitoring and Logging

The TLS manager logs important events:

```typescript
// Certificate loading
logger.info('Loading TLS certificates')
logger.info('TLS certificates loaded successfully')

// Certificate validation
logger.warn('Certificate expires in 30 days', { expiresAt: '2024-12-31' })

// HTTP redirect
logger.info('HTTP redirect server started', { port: 80, httpsPort: 443 })

// JWT key rotation
logger.warn('JWT verified with deprecated key', { kid: 'old-2023' })
```

## Examples

See the [examples/security-hardened.ts](../examples/security-hardened.ts) file for a complete working example with all security features enabled.

## Related Documentation

- [Security Configuration Guide](./SECURITY.md)
- [JWT Key Rotation](./SECURITY.md#jwt-key-rotation)
- [Production Deployment Guide](./DEPLOYMENT.md)
- [API Reference](./API.md)

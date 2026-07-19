# Bungate Security Guide

> **Comprehensive security hardening guide for production deployments**

This guide provides detailed information about Bungate's security features, threat model, and best practices for securing your API gateway in production environments.

## Related Documentation

- **[Authentication Guide](./AUTHENTICATION.md)** - JWT, API keys, OAuth2 configuration
- **[TLS Configuration Guide](./TLS_CONFIGURATION.md)** - Detailed HTTPS setup
- **[Quick Start](./QUICK_START.md)** - Basic security setup
- **[API Reference](./API_REFERENCE.md)** - Security configuration options
- **[Troubleshooting](./TROUBLESHOOTING.md)** - Security-related issues

## Table of Contents

- [Threat Model](#threat-model)
- [Security Features Overview](#security-features-overview)
- [TLS/HTTPS Configuration](#tlshttps-configuration)
- [Input Validation & Sanitization](#input-validation--sanitization)
- [Secure Error Handling](#secure-error-handling)
- [Session Management](#session-management)
- [Trusted Proxy Configuration](#trusted-proxy-configuration)
- [Security Headers](#security-headers)
- [Request Size Limits](#request-size-limits)
- [JWT Key Rotation](#jwt-key-rotation)
- [Common Security Scenarios](#common-security-scenarios)
- [Security Checklist](#security-checklist)
- [Compliance & Standards](#compliance--standards)

## Threat Model

Bungate is designed to protect against the following attack vectors:

### Network Layer Threats

- **Man-in-the-Middle (MITM) Attacks**: Prevented through TLS/HTTPS encryption
- **Eavesdropping**: All traffic encrypted with strong cipher suites
- **Protocol Downgrade Attacks**: Minimum TLS version enforcement

### Application Layer Threats

- **Injection Attacks**: Path traversal, SQL injection, command injection
- **Cross-Site Scripting (XSS)**: Security headers and CSP
- **Cross-Site Request Forgery (CSRF)**: Token-based protection
- **Information Disclosure**: Secure error handling and sanitization

### Resource Exhaustion Threats

- **Denial of Service (DoS)**: Request size limits and rate limiting
- **Slowloris Attacks**: Timeout management and connection limits
- **Resource Amplification**: Payload size monitoring

### Authentication & Authorization Threats

- **Session Hijacking**: Cryptographically secure session IDs
- **Token Replay**: JWT expiration and validation
- **Credential Stuffing**: Rate limiting and account lockout

### Infrastructure Threats

- **IP Spoofing**: Trusted proxy validation
- **Header Injection**: Header validation and sanitization
- **Configuration Tampering**: Secure defaults and validation

## Security Features Overview

Bungate provides defense-in-depth with multiple security layers. All security features are **automatically applied** when configured in the gateway's `security` configuration object. You don't need to manually add middleware to each route - the gateway handles this for you.

### Automatic Security Application

When you configure security features at the gateway level, they are automatically applied to all routes:

```typescript
const gateway = new BunGateway({
  security: {
    // These features are automatically applied to ALL routes
    tls: { enabled: true /* ... */ },
    sizeLimits: { maxBodySize: 10 * 1024 * 1024 },
    inputValidation: { blockedPatterns: [/\.\./] },
    securityHeaders: { enabled: true },
  },
})

// This route automatically gets all security features
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
})
```

### Security Middleware Order

Security features are applied in the following order:

1. **Size Limits** - Validates request sizes before processing
2. **Input Validation** - Validates paths, headers, and query parameters
3. **Security Headers** - Applied to all responses
4. **Authentication** - JWT/API key validation (if configured)
5. **Rate Limiting** - Request throttling (if configured)
6. **Route-specific middleware** - Your custom middleware

### Defense-in-Depth Architecture

Bungate provides defense-in-depth with multiple security layers:

```
┌─────────────────────────────────────────────────────────────┐
│                     Client Requests                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: TLS Termination                                    │
│  ✓ Certificate validation                                    │
│  ✓ Cipher suite enforcement                                  │
│  ✓ Protocol version validation                               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: Request Validation                                 │
│  ✓ Size limit enforcement                                    │
│  ✓ Input validation & sanitization                           │
│  ✓ Header validation                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Security Middleware                                │
│  ✓ Trusted proxy validation                                  │
│  ✓ Security headers injection                                │
│  ✓ Authentication & authorization                            │
│  ✓ Rate limiting                                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: Application Processing                             │
│  ✓ Routing & load balancing                                  │
│  ✓ Circuit breaking                                          │
│  ✓ Backend proxying                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 5: Response Processing                                │
│  ✓ Error sanitization                                        │
│  ✓ Security header injection                                 │
│  ✓ Payload size monitoring                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend Services                          │
└─────────────────────────────────────────────────────────────┘
```

## TLS/HTTPS Configuration

### Overview

TLS (Transport Layer Security) encrypts all traffic between clients and the gateway, preventing eavesdropping and man-in-the-middle attacks.

### Basic Configuration

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 443, hostname: 'example.com' },
  security: {
    tls: {
      enabled: true,
      cert: './cert.pem',
      key: './key.pem',
      minVersion: 'TLSv1.3',
      redirectHTTP: true,
      redirectPort: 80,
      // Prevent open redirects via Host header
      redirectAllowedHosts: ['example.com', '*.example.com'],
    },
  },
})

await gateway.listen()
```

### Production Configuration

```typescript
const gateway = new BunGateway({
  server: { port: 443, hostname: 'example.com' },
  security: {
    tls: {
      enabled: true,
      cert: process.env.TLS_CERT_PATH,
      key: process.env.TLS_KEY_PATH,
      ca: process.env.TLS_CA_PATH, // For client certificate validation
      minVersion: 'TLSv1.3',
      cipherSuites: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
      ],
      requestCert: false, // Enable for mTLS
      rejectUnauthorized: true,
      redirectHTTP: true,
      redirectPort: 80,
      redirectAllowedHosts: ['example.com', '*.example.com'],
    },
  },
})
```

### Best Practices

1. **Use TLS 1.3**: Provides better security and performance
2. **Strong Cipher Suites**: Use AEAD ciphers with forward secrecy
3. **Valid Certificates**: Obtain from trusted CAs (Let's Encrypt, DigiCert)
4. **Certificate Rotation**: Automate renewal before expiration
5. **Secure Key Storage**: Protect private keys with proper permissions (chmod 600)
6. **HTTP Redirect**: Always redirect HTTP to HTTPS in production

For detailed TLS configuration, see [TLS Configuration Guide](./TLS_CONFIGURATION.md).

## Input Validation & Sanitization

### Overview

Input validation prevents injection attacks by validating and sanitizing all user-provided data before processing.

### Configuration

Input validation is automatically applied when configured in the gateway security settings:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    inputValidation: {
      maxPathLength: 2048,
      maxHeaderSize: 16384,
      maxHeaderCount: 100,
      allowedPathChars: /^[a-zA-Z0-9\/_\-\.~%]+$/,
      blockedPatterns: [
        /\.\./, // Directory traversal
        /%00/, // Null byte injection
        /<script>/i, // XSS attempts
        /javascript:/i, // JavaScript protocol
      ],
      sanitizeHeaders: true,
    },
  },
})

// All routes automatically have input validation applied
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
})
```

### What Gets Validated

1. **Path Parameters**: Checked against allowed character set
2. **Path Rewriting**: Sanitized to prevent directory traversal
3. **Headers**: Validated against RFC specifications
4. **Query Parameters**: Checked for malicious patterns
5. **Request Size**: Enforced before processing

### Custom Validation

```typescript
import { InputValidator } from 'bungate'

const validator = new InputValidator({
  maxPathLength: 1024,
  allowedPathChars: /^[a-zA-Z0-9\/\-_]+$/,
})

gateway.addRoute({
  pattern: '/strict/*',
  target: 'http://backend:3000',
  middlewares: [
    async (req, next) => {
      const result = validator.validatePath(new URL(req.url).pathname)
      if (!result.valid) {
        return new Response(
          JSON.stringify({ error: 'Invalid path', details: result.errors }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return next()
    },
  ],
})
```

### Attack Prevention

- **Directory Traversal**: `../` sequences blocked and sanitized
- **Double/Multiple Encoding**: Paths are recursively decoded; still-encoded sequences after decoding are rejected
- **Null Byte Injection**: `%00` and null characters rejected
- **XSS Attempts**: Script tags and JavaScript protocols blocked
- **SQL Injection**: Special characters in query params validated
- **Command Injection**: Shell metacharacters blocked

## Secure Error Handling

### Overview

Secure error handling prevents information disclosure by sanitizing error messages in production while maintaining detailed logging for debugging.

### Configuration

Secure error handling is automatically applied when configured in the gateway security settings:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    errorHandling: {
      production: process.env.NODE_ENV === 'production',
      includeStackTrace: false,
      logErrors: true,
      sanitizeBackendErrors: true,
      customMessages: {
        500: 'An internal error occurred',
        502: 'Service temporarily unavailable',
        503: 'Service unavailable',
        504: 'Request timeout',
      },
    },
  },
})

// All routes automatically have secure error handling applied
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
})
```

### Production vs Development

**Production Mode** (sanitized):

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An internal error occurred",
    "requestId": "req_abc123",
    "timestamp": 1699564800000
  }
}
```

**Development Mode** (sanitized by default; set `includeStackTrace: true` for detailed responses):

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An internal error occurred",
    "requestId": "req_abc123",
    "timestamp": 1699564800000
  }
}
```

### Custom Error Handling

```typescript
import { SecureErrorHandler } from 'bungate'

const errorHandler = new SecureErrorHandler({
  production: true,
  logErrors: true,
})

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  hooks: {
    onError: async (req, error) => {
      // Log full error internally
      errorHandler.logError(error, {
        requestId: crypto.randomUUID(),
        clientIP: req.headers.get('x-forwarded-for') || 'unknown',
        path: new URL(req.url).pathname,
        method: req.method,
      })

      // Return sanitized error to client
      const safeError = errorHandler.sanitizeError(error)
      return new Response(JSON.stringify(safeError), {
        status: safeError.statusCode,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  },
})
```

### What Gets Sanitized

- Stack traces (removed in production)
- Internal service URLs and IPs
- Database connection strings
- Environment variables
- File system paths
- Configuration details
- Backend error messages

## Session Management

### Overview

Cryptographically secure session management prevents session hijacking and fixation attacks through strong random ID generation and secure cookie handling.

### Configuration

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    sessions: {
      entropyBits: 128, // Minimum 128 bits
      ttl: 3600000, // 1 hour
      cookieName: 'session_id',
      cookieOptions: {
        secure: true, // HTTPS only
        httpOnly: true, // No JavaScript access
        sameSite: 'strict', // CSRF protection
        domain: '.example.com',
        path: '/',
      },
    },
  },
})
```

### Sticky Sessions with Load Balancer

```typescript
gateway.addRoute({
  pattern: '/app/*',
  loadBalancer: {
    strategy: 'round-robin',
    targets: [
      { url: 'http://app1:3000' },
      { url: 'http://app2:3000' },
      { url: 'http://app3:3000' },
    ],
    stickySession: {
      enabled: true,
      cookieName: 'app_session',
      ttl: 3600000,
      // Cap in-memory sessions to prevent unbounded growth
      maxSessions: 10000,
      // Ignore unknown cookie values instead of minting new sessions
      unknownCookiePolicy: 'ignore',
    },
  },
})
```

### Session Manager API

```typescript
import { SessionManager } from 'bungate'

const sessionManager = new SessionManager({
  entropyBits: 128,
  ttl: 3600000,
})

// Generate secure session ID
const sessionId = sessionManager.generateSessionId()
console.log('Entropy:', sessionId.length * 4, 'bits') // 128+ bits

// Create session
const session = sessionManager.createSession('http://backend:3000/target')

// Validate session
const isValid = sessionManager.validateSessionId(sessionId)

// Get session
const session = sessionManager.getSession(sessionId)

// Delete session
sessionManager.deleteSession(sessionId)

// Cleanup expired sessions
sessionManager.cleanupExpiredSessions()
```

### Security Features

1. **Cryptographic Randomness**: Uses `crypto.randomBytes()` for all session IDs
2. **Minimum Entropy**: Enforces 128 bits of entropy (32 hex characters)
3. **Automatic Expiration**: Sessions expire after configured TTL
4. **Secure Cookies**: Secure, HttpOnly, and SameSite attributes set by default
5. **Session Validation**: Rejects sessions below minimum entropy threshold

### Best Practices

- Use HTTPS (required for Secure cookie attribute)
- Set appropriate TTL based on application sensitivity
- Enable SameSite=strict for CSRF protection
- Implement session cleanup to prevent memory leaks
- Rotate session IDs after authentication
- Invalidate sessions on logout

## Trusted Proxy Configuration

### Overview

Trusted proxy validation prevents IP spoofing by only accepting forwarded headers from verified proxy servers.

### Configuration

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    trustedProxies: {
      enabled: true,
      trustedIPs: [
        '10.0.0.0/8', // Private network
        '172.16.0.0/12', // Private network
        '192.168.0.0/16', // Private network
      ],
      trustedNetworks: [
        'cloudflare', // Cloudflare IP ranges
        'aws', // AWS CloudFront
        'gcp', // Google Cloud CDN
        'azure', // Azure CDN
      ],
      maxForwardedDepth: 3,
      trustAll: false, // Never use in production!
      // Only enable these when the immediate upstream is actually that proxy type
      trustCloudflare: true,
      trustXRealIP: false,
    },
  },
})
```

**Cloudflare / X-Real-IP headers:** These proxy-specific headers are ignored by default even when the peer is trusted. Only enable `trustCloudflare` when the immediate upstream is Cloudflare, and `trustXRealIP` when your trusted proxy is responsible for setting `X-Real-IP`.

### Predefined Trusted Networks

Bungate includes IP ranges for major CDN and cloud providers:

- **cloudflare**: Cloudflare CDN IP ranges (complete list, updated Nov 2024)
- **aws**: AWS CloudFront IP ranges (representative sample of 194 ranges)
- **gcp**: Google Cloud CDN IP ranges (representative sample of 814 ranges)
- **azure**: Azure CDN IP ranges (representative sample)

**Note:** The built-in ranges are representative samples suitable for most deployments. For large-scale production environments or the most up-to-date ranges, consider fetching them dynamically:

```typescript
// Example: Fetch AWS CloudFront ranges dynamically
const response = await fetch('https://ip-ranges.amazonaws.com/ip-ranges.json')
const data = await response.json()
const cloudfrontRanges = data.prefixes
  .filter((p) => p.service === 'CLOUDFRONT')
  .map((p) => p.ip_prefix)

// Use with custom validator
const validator = new TrustedProxyValidator({
  trustedIPs: cloudfrontRanges,
})
```

**Update Sources:**

- Cloudflare: https://www.cloudflare.com/ips-v4
- AWS CloudFront: https://ip-ranges.amazonaws.com/ip-ranges.json
- GCP: https://www.gstatic.com/ipranges/cloud.json
- Azure: https://www.microsoft.com/en-us/download/details.aspx?id=56519

### Custom Validation

```typescript
import { TrustedProxyValidator } from 'bungate'

const validator = new TrustedProxyValidator({
  trustedIPs: ['203.0.113.0/24'],
  maxForwardedDepth: 2,
})

gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  middlewares: [
    async (req, next) => {
      const remoteIP = req.headers.get('x-real-ip') || 'unknown'

      if (!validator.validateProxy(remoteIP)) {
        console.warn('Untrusted proxy detected:', remoteIP)
        // Use direct connection IP instead
      }

      const clientIP = validator.extractClientIP(req)
      ;(req as any).clientIP = clientIP

      return next()
    },
  ],
})
```

### How It Works

1. **Proxy Validation**: Checks if request comes from trusted proxy
2. **Header Extraction**: Only processes X-Forwarded-For from trusted sources
3. **Chain Validation**: Validates entire forwarded header chain
4. **Depth Limiting**: Prevents header chain manipulation
5. **Fallback**: Uses direct connection IP if proxy untrusted

### CIDR Notation Support

```typescript
trustedIPs: [
  '10.0.0.1', // Single IP
  '192.168.1.0/24', // Subnet (256 IPs)
  '172.16.0.0/12', // Large subnet
  '2001:db8::/32', // IPv6 subnet
]
```

### Security Warnings

The system logs warnings for suspicious activity:

```typescript
// Logged when:
// - Forwarded header from untrusted source
// - Chain depth exceeds maximum
// - Invalid IP format detected
// - Conflicting forwarded headers
```

### Best Practices

- Never use `trustAll: true` in production
- Regularly update trusted IP ranges
- Monitor security logs for suspicious activity
- Use specific IP ranges instead of broad subnets
- Validate forwarded headers even from trusted proxies
- Set appropriate `maxForwardedDepth` (typically 1-3)

## Security Headers

### Overview

Security headers instruct browsers to enforce additional security protections, preventing various client-side attacks.

### Configuration

Security headers are automatically applied to all responses when configured in the gateway security settings:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    securityHeaders: {
      enabled: true,
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'", 'cdn.example.com'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'https:'],
          'font-src': ["'self'", 'fonts.gstatic.com'],
          'connect-src': ["'self'", 'api.example.com'],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
        reportOnly: false,
      },
      xFrameOptions: 'DENY',
      xContentTypeOptions: true,
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: ["'self'"],
        payment: ["'self'"],
      },
      customHeaders: {
        'X-Gateway-Version': '1.0.0',
      },
    },
  },
})

// All routes automatically have security headers applied to responses
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
})
```

### Header Reference

#### Strict-Transport-Security (HSTS)

Forces browsers to use HTTPS for all future requests.

```typescript
hsts: {
  maxAge: 31536000,        // Required: seconds to remember
  includeSubDomains: true, // Apply to all subdomains
  preload: true,           // Submit to HSTS preload list
}
```

**Response Header:**

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

#### Content-Security-Policy (CSP)

Controls which resources browsers can load, preventing XSS attacks.

```typescript
contentSecurityPolicy: {
  directives: {
    'default-src': ["'self'"],                    // Default policy
    'script-src': ["'self'", 'trusted-cdn.com'],  // JavaScript sources
    'style-src': ["'self'", "'unsafe-inline'"],   // CSS sources
    'img-src': ["'self'", 'data:', 'https:'],     // Image sources
    'connect-src': ["'self'", 'api.example.com'], // AJAX/WebSocket
    'font-src': ["'self'", 'fonts.gstatic.com'],  // Font sources
    'object-src': ["'none'"],                     // Plugins (Flash, etc.)
    'frame-ancestors': ["'none'"],                // Embedding restrictions
    'base-uri': ["'self'"],                       // <base> tag restrictions
    'form-action': ["'self'"],                    // Form submission targets
  },
  reportOnly: false, // Set true for testing
}
```

**Response Header:**

```
Content-Security-Policy: default-src 'self'; script-src 'self' trusted-cdn.com; ...
```

#### X-Frame-Options

Prevents clickjacking by controlling iframe embedding.

```typescript
xFrameOptions: 'DENY' | 'SAMEORIGIN' | 'ALLOW-FROM https://example.com'
```

**Response Header:**

```
X-Frame-Options: DENY
```

#### X-Content-Type-Options

Prevents MIME type sniffing.

```typescript
xContentTypeOptions: true
```

**Response Header:**

```
X-Content-Type-Options: nosniff
```

#### Referrer-Policy

Controls referrer information sent with requests.

```typescript
referrerPolicy: 'no-referrer' |
  'no-referrer-when-downgrade' |
  'origin' |
  'origin-when-cross-origin' |
  'same-origin' |
  'strict-origin' |
  'strict-origin-when-cross-origin' |
  'unsafe-url'
```

**Response Header:**

```
Referrer-Policy: strict-origin-when-cross-origin
```

#### Permissions-Policy

Controls browser features and APIs.

```typescript
permissionsPolicy: {
  camera: [],                    // Disable camera
  microphone: [],                // Disable microphone
  geolocation: ["'self'"],       // Allow on same origin
  payment: ["'self'"],           // Allow payment API
  usb: [],                       // Disable USB access
  'display-capture': [],         // Disable screen capture
}
```

**Response Header:**

```
Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self)
```

### CSP Report-Only Mode

Test CSP without blocking resources:

```typescript
contentSecurityPolicy: {
  directives: { /* ... */ },
  reportOnly: true,
  reportUri: '/csp-report',
}
```

Violations are reported but not blocked, allowing you to test policies safely.

### Custom Headers

Add application-specific security headers:

```typescript
customHeaders: {
  'X-Gateway-Version': '1.0.0',
  'X-Request-ID': () => crypto.randomUUID(),
  'X-Content-Type-Options': 'nosniff',
}
```

### Best Practices

1. **Start with Report-Only**: Test CSP before enforcing
2. **Minimize 'unsafe-inline'**: Avoid inline scripts/styles
3. **Use Nonces**: For inline scripts that can't be avoided
4. **Enable HSTS**: After confirming HTTPS works correctly
5. **Submit to Preload**: After testing HSTS for several weeks
6. **Regular Updates**: Review and update CSP as application evolves
7. **Monitor Reports**: Set up CSP reporting endpoint

## Request Size Limits

### Overview

Request size limits prevent denial-of-service attacks by rejecting oversized requests before they consume resources.

### Configuration

Request size limits are automatically enforced when configured in the gateway security settings:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    sizeLimits: {
      maxBodySize: 10 * 1024 * 1024, // 10 MB
      maxHeaderSize: 16 * 1024, // 16 KB
      maxHeaderCount: 100, // 100 headers
      maxUrlLength: 2048, // 2048 characters
      maxQueryParams: 100, // 100 parameters
    },
  },
})

// All routes automatically have size limits enforced
gateway.addRoute({
  pattern: '/*',
  target: 'http://backend:3000',
})
```

### Global Configuration

Size limits are configured globally at the gateway level and apply to all routes:

```typescript
const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    sizeLimits: {
      maxBodySize: 10 * 1024 * 1024, // 10 MB default
      maxHeaderSize: 16 * 1024, // 16 KB
      maxHeaderCount: 100,
      maxUrlLength: 2048,
      maxQueryParams: 100,
    },
  },
})

// For different limits per route, you can use custom middleware
import { createSizeLimiterMiddleware } from 'bungate'

gateway.addRoute({
  pattern: '/upload/*',
  target: 'http://upload-service:3000',
  middlewares: [
    createSizeLimiterMiddleware({
      limits: {
        maxBodySize: 100 * 1024 * 1024, // 100 MB for uploads
      },
    }),
  ],
})
```

### Custom Size Validation

```typescript
import { SizeLimiter } from 'bungate'

const limiter = new SizeLimiter({
  maxBodySize: 5 * 1024 * 1024,
  maxHeaderSize: 16 * 1024,
})

gateway.addRoute({
  pattern: '/custom/*',
  target: 'http://backend:3000',
  middlewares: [
    async (req, next) => {
      // Validate request size
      const result = limiter.validateRequestSize(req)

      if (!result.valid) {
        return new Response(
          JSON.stringify({
            error: 'Request too large',
            details: result.errors,
          }),
          {
            status: 413,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      return next()
    },
  ],
})
```

### HTTP Status Codes

Different limits return appropriate status codes:

- **413 Payload Too Large**: Body size exceeds limit
- **414 URI Too Long**: URL length exceeds limit
- **431 Request Header Fields Too Large**: Headers exceed limits

### Default Limits

Bungate uses secure defaults based on RFC recommendations:

```typescript
{
  maxBodySize: 10 * 1024 * 1024,    // 10 MB
  maxHeaderSize: 16 * 1024,          // 16 KB (per header)
  maxHeaderCount: 100,               // 100 headers
  maxUrlLength: 2048,                // 2048 characters
  maxQueryParams: 100,               // 100 parameters
}
```

### Streaming Validation

Body size is validated during streaming to prevent buffering large payloads:

```typescript
// Size is checked incrementally as data arrives
// Request is aborted immediately when limit exceeded
// No memory exhaustion from buffering
```

### Best Practices

1. **Set Appropriate Limits**: Based on application requirements
2. **Different Limits per Route**: Upload endpoints need larger limits
3. **Monitor Rejections**: Track 413/414/431 responses
4. **Document Limits**: Inform API consumers of size restrictions
5. **Graceful Errors**: Return helpful error messages
6. **Consider Compression**: Compressed payloads count toward limits

### Security Benefits

- **DoS Prevention**: Rejects oversized requests early
- **Memory Protection**: Prevents memory exhaustion
- **Resource Conservation**: Saves CPU and bandwidth
- **Attack Surface Reduction**: Limits potential attack vectors

## JWT Key Rotation

### Overview

JWT key rotation allows updating signing keys without service disruption, enabling recovery from key compromise and regular key rotation best practices.

### Configuration

JWT key rotation is configured at the gateway level and can be used with route-level authentication:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 3000 },
  security: {
    jwtKeyRotation: {
      secrets: [
        {
          key: process.env.JWT_SECRET_PRIMARY,
          algorithm: 'HS256',
          kid: 'key-2024-01',
          primary: true,
        },
        {
          key: process.env.JWT_SECRET_OLD,
          algorithm: 'HS256',
          kid: 'key-2023-12',
          deprecated: true,
        },
      ],
      gracePeriod: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  },
})

// Use with route authentication
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://backend:3000',
  auth: {
    secret: process.env.JWT_SECRET_PRIMARY,
    jwtOptions: {
      algorithms: ['HS256'],
    },
  },
})
```

### JWKS (JSON Web Key Set) Support

Automatically fetch and refresh keys from JWKS endpoint:

```typescript
security: {
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
}
```

### Key Rotation Process

1. **Add New Key**: Add new key as primary
2. **Grace Period**: Keep old key for verification
3. **Monitor Usage**: Track deprecated key usage
4. **Remove Old Key**: After grace period expires

```typescript
// Step 1: Add new key (both keys active)
secrets: [
  { key: 'new-secret', algorithm: 'HS256', kid: 'key-2024-02', primary: true },
  {
    key: 'old-secret',
    algorithm: 'HS256',
    kid: 'key-2024-01',
    deprecated: true,
  },
]

// Step 2: Monitor for 7 days
// Logs warnings when old key is used

// Step 3: Remove old key (after grace period)
secrets: [
  { key: 'new-secret', algorithm: 'HS256', kid: 'key-2024-02', primary: true },
]
```

### Multiple Algorithm Support

Support different algorithms simultaneously:

```typescript
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
]
```

### Programmatic Key Management

```typescript
import { JWTKeyRotationManager } from 'bungate'

const keyManager = new JWTKeyRotationManager({
  secrets: [
    { key: 'primary-secret', algorithm: 'HS256', primary: true },
    { key: 'old-secret', algorithm: 'HS256', deprecated: true },
  ],
  gracePeriod: 7 * 24 * 60 * 60 * 1000,
})

// Verify token (tries all keys)
try {
  const payload = await keyManager.verifyToken(token)
  console.log('Token valid:', payload)
} catch (error) {
  console.error('Token invalid:', error)
}

// Sign new token (uses primary key)
const newToken = await keyManager.signToken({
  sub: 'user123',
  exp: Math.floor(Date.now() / 1000) + 3600,
})

// Rotate keys
await keyManager.rotateKeys()

// Refresh JWKS
await keyManager.refreshJWKS()
```

### Monitoring & Alerts

The system logs warnings for security monitoring:

```typescript
// Logged when:
// - Deprecated key used for verification
// - JWKS refresh fails
// - All keys fail verification
// - Key rotation performed
```

### Best Practices

1. **Regular Rotation**: Rotate keys every 90 days
2. **Grace Period**: Keep old keys for 7-14 days
3. **Monitor Usage**: Track deprecated key usage
4. **Secure Storage**: Store keys in secrets management system
5. **Key IDs**: Use descriptive key IDs with dates
6. **JWKS Caching**: Cache JWKS responses appropriately
7. **Fallback Keys**: Keep fallback key for emergencies
8. **Audit Logs**: Log all key rotation events

### Emergency Key Rotation

In case of key compromise:

```typescript
// 1. Immediately add new key as primary
secrets: [
  {
    key: 'emergency-new-key',
    algorithm: 'HS256',
    kid: 'emergency-2024',
    primary: true,
  },
  // Remove compromised key immediately (no grace period)
]

// 2. Invalidate all existing tokens
// 3. Force re-authentication
// 4. Investigate compromise
// 5. Update monitoring and alerts
```

### Security Benefits

- **Key Compromise Recovery**: Replace compromised keys without downtime
- **Regular Rotation**: Follow security best practices
- **Zero Downtime**: Seamless key updates
- **Backward Compatibility**: Support old tokens during transition
- **Monitoring**: Track key usage and deprecation

## Common Security Scenarios

### Scenario 1: Production API Gateway

Complete security configuration for production API gateway:

```typescript
import { BunGateway } from 'bungate'

const gateway = new BunGateway({
  server: { port: 443 },

  // TLS/HTTPS
  security: {
    tls: {
      enabled: true,
      cert: process.env.TLS_CERT_PATH,
      key: process.env.TLS_KEY_PATH,
      minVersion: 'TLSv1.3',
      redirectHTTP: true,
      redirectPort: 80,
    },

    // Input validation
    inputValidation: {
      maxPathLength: 2048,
      maxHeaderSize: 16384,
      maxHeaderCount: 100,
      sanitizeHeaders: true,
    },

    // Error handling
    errorHandling: {
      production: true,
      includeStackTrace: false,
      logErrors: true,
      sanitizeBackendErrors: true,
    },

    // Session management
    sessions: {
      entropyBits: 128,
      ttl: 3600000,
      cookieOptions: {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
      },
    },

    // Trusted proxies
    trustedProxies: {
      enabled: true,
      trustedNetworks: ['cloudflare'],
      maxForwardedDepth: 2,
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
      maxUrlLength: 2048,
    },

    // JWT key rotation
    jwtKeyRotation: {
      secrets: [
        {
          key: process.env.JWT_SECRET_PRIMARY,
          algorithm: 'HS256',
          kid: 'primary',
          primary: true,
        },
      ],
      jwksUri: process.env.JWKS_URI,
      jwksRefreshInterval: 3600000,
    },
  },
})

// Protected API routes
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://api-backend:3000',
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
  circuitBreaker: {
    enabled: true,
    failureThreshold: 5,
    timeout: 5000,
  },
})

await gateway.listen()
```

### Scenario 2: Microservices Gateway

Gateway for microservices with different security requirements:

```typescript
const gateway = new BunGateway({
  server: { port: 443 },
  security: {
    /* ... base security config ... */
  },
})

// Public API with API key auth
gateway.addRoute({
  pattern: '/public/api/*',
  target: 'http://public-service:3000',
  auth: {
    apiKeys: async (key) => await validateApiKey(key),
    apiKeyHeader: 'x-api-key',
  },
  rateLimit: {
    max: 100,
    windowMs: 60000,
  },
})

// Internal API with JWT auth
gateway.addRoute({
  pattern: '/internal/api/*',
  target: 'http://internal-service:3000',
  auth: {
    secret: process.env.INTERNAL_JWT_SECRET,
    jwtOptions: {
      algorithms: ['HS256'],
      issuer: 'https://internal.example.com',
    },
  },
  rateLimit: {
    max: 10000,
    windowMs: 60000,
  },
})

// Admin API with strict security
gateway.addRoute({
  pattern: '/admin/api/*',
  target: 'http://admin-service:3000',
  auth: {
    secret: process.env.ADMIN_JWT_SECRET,
    jwtOptions: {
      algorithms: ['RS256'],
      issuer: 'https://admin.example.com',
    },
  },
  rateLimit: {
    max: 50,
    windowMs: 60000,
  },
  middlewares: [
    // Additional admin validation
    async (req, next) => {
      const user = (req as any).user
      if (!user?.roles?.includes('admin')) {
        return new Response('Forbidden', { status: 403 })
      }
      return next()
    },
  ],
})
```

### Scenario 3: High-Security Financial Application

Maximum security for sensitive financial data:

```typescript
const gateway = new BunGateway({
  server: { port: 443 },

  security: {
    // Strict TLS
    tls: {
      enabled: true,
      cert: process.env.TLS_CERT_PATH,
      key: process.env.TLS_KEY_PATH,
      minVersion: 'TLSv1.3',
      cipherSuites: ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'],
      requestCert: true, // mTLS required
      rejectUnauthorized: true,
    },

    // Strict input validation
    inputValidation: {
      maxPathLength: 1024,
      maxHeaderSize: 8192,
      maxHeaderCount: 50,
      allowedPathChars: /^[a-zA-Z0-9\/_-]+$/,
      sanitizeHeaders: true,
    },

    // Strict size limits
    sizeLimits: {
      maxBodySize: 1 * 1024 * 1024, // 1 MB
      maxHeaderSize: 8 * 1024,
      maxHeaderCount: 50,
      maxUrlLength: 1024,
    },

    // Short session TTL
    sessions: {
      entropyBits: 256, // Extra entropy
      ttl: 900000, // 15 minutes
      cookieOptions: {
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
      },
    },

    // Comprehensive security headers
    securityHeaders: {
      enabled: true,
      hsts: {
        maxAge: 63072000, // 2 years
        includeSubDomains: true,
        preload: true,
      },
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'none'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'img-src': ["'self'"],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'self'"],
        },
      },
      xFrameOptions: 'DENY',
      xContentTypeOptions: true,
      referrerPolicy: 'no-referrer',
    },
  },
})

// Payment endpoints with maximum security
gateway.addRoute({
  pattern: '/payments/*',
  target: 'http://payment-service:3000',
  auth: {
    secret: process.env.PAYMENT_JWT_SECRET,
    jwtOptions: {
      algorithms: ['RS256'],
      issuer: 'https://auth.financial.example.com',
      audience: 'https://api.financial.example.com',
    },
  },
  rateLimit: {
    max: 10, // Very strict rate limit
    windowMs: 60000,
  },
  circuitBreaker: {
    enabled: true,
    failureThreshold: 3,
    timeout: 3000,
  },
  middlewares: [
    // Additional payment validation
    async (req, next) => {
      // Validate payment-specific requirements
      // Check transaction limits
      // Verify account status
      return next()
    },
  ],
})
```

### Scenario 4: Development Environment

Relaxed security for development with detailed errors:

```typescript
const gateway = new BunGateway({
  server: { port: 3000 },

  security: {
    // No TLS in development
    tls: {
      enabled: false,
    },

    // Detailed errors
    errorHandling: {
      production: false,
      includeStackTrace: true,
      logErrors: true,
    },

    // Relaxed limits
    sizeLimits: {
      maxBodySize: 50 * 1024 * 1024, // 50 MB
      maxHeaderSize: 32 * 1024,
      maxHeaderCount: 200,
    },

    // Trust all proxies (local development)
    trustedProxies: {
      enabled: true,
      trustAll: true, // OK for development only
    },
  },
})

// Development routes with optional auth
gateway.addRoute({
  pattern: '/api/*',
  target: 'http://localhost:3001',
  auth: {
    secret: 'dev-secret',
    optional: true, // Allow unauthenticated requests
  },
})
```

## Security Checklist

Use this checklist to ensure your Bungate deployment is properly secured:

### TLS/HTTPS

- [ ] TLS enabled with valid certificates from trusted CA
- [ ] Minimum TLS version set to 1.3 (or 1.2 minimum)
- [ ] Strong cipher suites configured
- [ ] HTTP to HTTPS redirect enabled
- [ ] HSTS header enabled with appropriate max-age
- [ ] Certificates monitored for expiration
- [ ] Private keys secured with proper permissions (chmod 600)
- [ ] Certificate rotation process documented

### Input Validation

- [ ] Input validation enabled for all routes
- [ ] Path validation with allowed character set
- [ ] Header validation against RFC specifications
- [ ] Query parameter validation enabled
- [ ] Malicious pattern detection configured
- [ ] Path sanitization for rewrites
- [ ] Custom validation for sensitive endpoints

### Error Handling

- [ ] Production mode enabled in production
- [ ] Stack traces disabled in production
- [ ] Error logging enabled
- [ ] Backend errors sanitized
- [ ] Custom error messages configured
- [ ] Request IDs included in errors
- [ ] Error monitoring and alerting set up

### Session Management

- [ ] Minimum 128 bits of entropy for session IDs
- [ ] Appropriate session TTL configured
- [ ] Secure cookie attribute enabled (HTTPS only)
- [ ] HttpOnly cookie attribute enabled
- [ ] SameSite cookie attribute set to 'strict' or 'lax'
- [ ] Session cleanup scheduled
- [ ] Session rotation after authentication

### Trusted Proxies

- [ ] Trusted proxy validation enabled
- [ ] Specific trusted IP ranges configured (not trustAll)
- [ ] Trusted networks configured for CDN/cloud providers
- [ ] Maximum forwarded depth set appropriately
- [ ] Security warnings monitored
- [ ] IP spoofing prevention verified

### Security Headers

- [ ] Security headers enabled
- [ ] HSTS configured with appropriate max-age
- [ ] Content Security Policy configured
- [ ] X-Frame-Options set to DENY or SAMEORIGIN
- [ ] X-Content-Type-Options enabled
- [ ] Referrer-Policy configured
- [ ] Permissions-Policy configured
- [ ] CSP tested in report-only mode first

### Request Size Limits

- [ ] Body size limits configured
- [ ] Header size limits configured
- [ ] URL length limits configured
- [ ] Query parameter count limits configured
- [ ] Per-route limits configured where needed
- [ ] Appropriate HTTP status codes returned
- [ ] Size limit rejections monitored

### Authentication & Authorization

- [ ] JWT authentication configured
- [ ] Strong JWT secrets used
- [ ] JWT expiration configured
- [ ] JWT key rotation implemented
- [ ] JWKS refresh configured (if applicable)
- [ ] API key authentication for public APIs
- [ ] Rate limiting per user/API key
- [ ] Authentication excluded for public endpoints only

### Rate Limiting

- [ ] Rate limiting enabled for all routes
- [ ] Appropriate limits per route type
- [ ] Custom key generation for user-based limiting
- [ ] Distributed rate limiting for clusters
- [ ] Rate limit exceeded responses monitored
- [ ] Whitelist for trusted clients (if needed)

### Monitoring & Logging

- [ ] Structured logging enabled
- [ ] Security events logged
- [ ] Failed authentication attempts logged
- [ ] Rate limit violations logged
- [ ] Input validation failures logged
- [ ] Error logs monitored
- [ ] Security alerts configured
- [ ] Metrics collection enabled

### Infrastructure

- [ ] Gateway running in cluster mode for production
- [ ] Health checks configured
- [ ] Circuit breakers enabled for backend services
- [ ] Graceful shutdown configured
- [ ] Connection draining implemented
- [ ] Environment variables secured
- [ ] Secrets management system used
- [ ] Regular security updates applied

### Compliance

- [ ] Security requirements documented
- [ ] Threat model reviewed
- [ ] Security testing performed
- [ ] Penetration testing completed
- [ ] Compliance requirements met (PCI DSS, HIPAA, etc.)
- [ ] Security audit trail maintained
- [ ] Incident response plan documented
- [ ] Regular security reviews scheduled

## Compliance & Standards

### OWASP Top 10 Coverage

Bungate addresses the OWASP Top 10 security risks:

#### A01:2021 – Broken Access Control

- **Mitigation**: JWT authentication, API key validation, role-based access control
- **Features**: Auth middleware, token validation, custom authorization logic

#### A02:2021 – Cryptographic Failures

- **Mitigation**: TLS 1.3, strong cipher suites, secure session IDs
- **Features**: TLS configuration, cryptographic random generation, HSTS

#### A03:2021 – Injection

- **Mitigation**: Input validation, path sanitization, header validation
- **Features**: Input validator, malicious pattern detection, query param validation

#### A04:2021 – Insecure Design

- **Mitigation**: Secure defaults, defense-in-depth, threat modeling
- **Features**: Security configuration, multiple security layers, secure error handling

#### A05:2021 – Security Misconfiguration

- **Mitigation**: Secure defaults, configuration validation, security headers
- **Features**: Default security settings, config validation, comprehensive headers

#### A06:2021 – Vulnerable and Outdated Components

- **Mitigation**: Regular updates, dependency scanning, minimal dependencies
- **Features**: Automated security scanning, update notifications

#### A07:2021 – Identification and Authentication Failures

- **Mitigation**: Strong session management, JWT validation, key rotation
- **Features**: Cryptographic session IDs, JWT key rotation, multi-factor support

#### A08:2021 – Software and Data Integrity Failures

- **Mitigation**: JWT signature validation, secure key management
- **Features**: JWT verification, key rotation, JWKS support

#### A09:2021 – Security Logging and Monitoring Failures

- **Mitigation**: Comprehensive logging, security event tracking, metrics
- **Features**: Structured logging, security alerts, monitoring integration

#### A10:2021 – Server-Side Request Forgery (SSRF)

- **Mitigation**: Input validation, URL sanitization, trusted proxy validation
- **Features**: Path validation, header validation, proxy IP verification

### Industry Standards

#### PCI DSS (Payment Card Industry Data Security Standard)

Bungate supports PCI DSS requirements:

- **Requirement 2**: Strong cryptography (TLS 1.3, strong ciphers)
- **Requirement 4**: Encrypted transmission (TLS/HTTPS)
- **Requirement 6**: Secure development (input validation, secure defaults)
- **Requirement 8**: Strong authentication (JWT, API keys, session management)
- **Requirement 10**: Logging and monitoring (comprehensive audit logs)

#### HIPAA (Health Insurance Portability and Accountability Act)

Security features for HIPAA compliance:

- **Access Control**: JWT authentication, role-based access
- **Audit Controls**: Comprehensive logging and monitoring
- **Integrity**: JWT signature validation, secure error handling
- **Transmission Security**: TLS 1.3 encryption, strong cipher suites

#### GDPR (General Data Protection Regulation)

Privacy and security features:

- **Data Protection**: TLS encryption, secure session management
- **Access Control**: Authentication and authorization
- **Audit Trail**: Comprehensive logging
- **Data Minimization**: Secure error handling (no PII in errors)

#### SOC 2 (Service Organization Control 2)

Security controls for SOC 2 compliance:

- **Security**: TLS, authentication, input validation, rate limiting
- **Availability**: Circuit breakers, health checks, load balancing
- **Confidentiality**: Encryption, access control, secure sessions
- **Processing Integrity**: Input validation, error handling
- **Privacy**: Secure error handling, data protection

### Security Testing

#### Recommended Testing Approaches

1. **Static Application Security Testing (SAST)**
   - Code analysis for security vulnerabilities
   - Configuration validation
   - Dependency scanning

2. **Dynamic Application Security Testing (DAST)**
   - Runtime security testing
   - Penetration testing
   - Vulnerability scanning

3. **Security Unit Tests**
   - Input validation tests
   - Authentication tests
   - Authorization tests
   - Error handling tests

4. **Integration Security Tests**
   - End-to-end security flows
   - TLS configuration tests
   - Rate limiting tests
   - Circuit breaker tests

5. **Penetration Testing**
   - Professional security assessment
   - Attack simulation
   - Vulnerability exploitation
   - Security posture validation

### Security Resources

#### Documentation

- [TLS Configuration Guide](./TLS_CONFIGURATION.md)
- [API Reference](./API.md)
- [Examples](../examples/)

#### External Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Mozilla Web Security Guidelines](https://infosec.mozilla.org/guidelines/web_security)
- [CWE Top 25](https://cwe.mitre.org/top25/)

#### Security Tools

- [OWASP ZAP](https://www.zaproxy.org/) - Security testing
- [Burp Suite](https://portswigger.net/burp) - Penetration testing
- [SSL Labs](https://www.ssllabs.com/ssltest/) - TLS configuration testing
- [Security Headers](https://securityheaders.com/) - Header validation

### Reporting Security Issues

If you discover a security vulnerability in Bungate:

1. **Do Not** open a public GitHub issue
2. Email security concerns to: [security@21no.de](mailto:security@21no.de)
3. Include detailed information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)
4. Allow reasonable time for response and fix
5. Coordinate disclosure timing

### Security Updates

- Security updates are released as soon as possible
- Critical vulnerabilities are patched within 24-48 hours
- Security advisories published on GitHub
- Subscribe to releases for notifications

---

## Summary

Bungate provides comprehensive security features for production API gateways:

- **Transport Security**: TLS 1.3 with strong cipher suites
- **Input Protection**: Validation and sanitization
- **Error Security**: Sanitized error responses
- **Session Security**: Cryptographic session management
- **Network Security**: Trusted proxy validation
- **Client Security**: Security headers and CSP
- **Resource Protection**: Size limits and rate limiting
- **Authentication**: JWT with key rotation support

Follow the security checklist and best practices to ensure your deployment is properly secured. Regular security reviews and updates are essential for maintaining a strong security posture.

For questions or security concerns, contact [security@21no.de](mailto:security@21no.de).

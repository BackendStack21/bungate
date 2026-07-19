import { describe, test, expect, spyOn } from 'bun:test'
import * as crypto from 'crypto'
import {
  calculateEntropy,
  hasMinimumEntropy,
  generateSecureRandom,
  generateSecureRandomWithEntropy,
  recursiveDecodeURIComponent,
  sanitizePath,
  sanitizeHeader,
  isValidHeaderName,
  isValidHeaderValue,
  containsOnlyAllowedChars,
  matchesBlockedPattern,
  sanitizeErrorMessage,
  generateRequestId,
  isValidIP,
  isIPInCIDR,
  safeJSONParse,
  redactSensitiveData,
  timingSafeEqual,
  isValidURL,
  extractDomain,
} from '../../src/security/utils'

// ─── calculateEntropy ────────────────────────────────────────────────

describe('calculateEntropy', () => {
  test('returns 0 for empty string', () => {
    expect(calculateEntropy('')).toBe(0)
  })

  test('returns 0 for falsy input (empty check first)', () => {
    // The guard is: if (!str || str.length === 0). The `!str` handles
    // both empty string and would handle falsy if typed any, but since
    // the function signature is `string`, we test empty string.
    expect(calculateEntropy('')).toBe(0)
  })

  test('returns non-zero for a non-empty string', () => {
    const result = calculateEntropy('hello world')
    expect(result).toBeGreaterThan(0)
  })

  test('returns 0 for a string with a single repeated character (no entropy)', () => {
    // "aaaa" has only one unique char → probability=1 → log2(1)=0 → entropy=0
    expect(calculateEntropy('aaaa')).toBe(0)
  })

  test('returns maximum entropy for all-unique characters', () => {
    // Each character is unique, probability = 1/N
    // Entropy per char = -log2(1/N) = log2(N)
    // Total = N * log2(N)
    const str = 'abcdefgh'
    const N = str.length
    const expected = N * Math.log2(N)
    expect(calculateEntropy(str)).toBeCloseTo(expected, 5)
  })

  test('handles mixed character frequencies', () => {
    const str = 'aabb'
    // 2 'a', 2 'b', probability = 0.5 each
    // entropy per char = -(0.5*log2(0.5) + 0.5*log2(0.5)) = 1
    // total = 4 * 1 = 4
    expect(calculateEntropy(str)).toBeCloseTo(4, 5)
  })
})

// ─── hasMinimumEntropy ────────────────────────────────────────────────

describe('hasMinimumEntropy', () => {
  test('returns true when entropy exceeds minimum', () => {
    const str = 'abcdefghijklmnop' // high entropy
    expect(hasMinimumEntropy(str, 10)).toBe(true)
  })

  test('returns false when entropy is below minimum', () => {
    const str = 'aaaa'
    expect(hasMinimumEntropy(str, 1)).toBe(false)
  })

  test('returns true for exact match', () => {
    const str = 'aabb'
    expect(hasMinimumEntropy(str, 4)).toBe(true)
  })
})

// ─── generateSecureRandom ──────────────────────────────────────────────

describe('generateSecureRandom', () => {
  test('returns a hex string of expected length (default 32 bytes → 64 hex chars)', () => {
    const result = generateSecureRandom()
    expect(typeof result).toBe('string')
    expect(result.length).toBe(64)
  })

  test('returns different values on subsequent calls', () => {
    const a = generateSecureRandom()
    const b = generateSecureRandom()
    expect(a).not.toBe(b)
  })

  test('respects custom byte length', () => {
    const result = generateSecureRandom(16)
    expect(result.length).toBe(32)
  })
})

// ─── generateSecureRandomWithEntropy ───────────────────────────────────

describe('generateSecureRandomWithEntropy', () => {
  test('generates string with sufficient bytes for requested entropy', () => {
    // 128 bits → 16 bytes → 32 hex chars
    const result = generateSecureRandomWithEntropy(128)
    expect(result.length).toBe(32)
  })

  test('rounds up bytes when entropy not divisible by 8', () => {
    // 100 bits → Math.ceil(100/8) = 13 bytes → 26 hex chars
    const result = generateSecureRandomWithEntropy(100)
    expect(result.length).toBe(26)
  })
})

// ─── recursiveDecodeURIComponent ──────────────────────────────────────

describe('recursiveDecodeURIComponent', () => {
  test('returns a normal string unchanged (already decoded)', () => {
    const input = '/hello/world'
    expect(recursiveDecodeURIComponent(input)).toBe('/hello/world')
  })

  test('decodes standard percent-encoding', () => {
    expect(recursiveDecodeURIComponent('hello%20world')).toBe('hello world')
  })

  test('recursively decodes double-encoding (%252f → %2f → /)', () => {
    // %25 decodes to %, so %252f → %2f → /
    expect(recursiveDecodeURIComponent('%252f')).toBe('/')
  })

  test('decodes triple-encoding (%25252f)', () => {
    // %25252f → %252f → %2f → /
    expect(recursiveDecodeURIComponent('%25252f')).toBe('/')
  })

  test('handles malformed encoding gracefully (incomplete percent sequence)', () => {
    // This will trigger the catch block
    // decodeURIComponent('%E0%A4%A') throws URIError
    // Note: Bun's decodeURIComponent may be lenient, so we use a clearly
    // malformed sequence that should fail
    const input = '%ZZ'
    // decodeURIComponent('%ZZ') throws URIError — the function catches and returns
    // the last successfully decoded value (the original input)
    const result = recursiveDecodeURIComponent(input)
    // It should return the original since decode fails on first iteration
    expect(result).toBe(input)
  })

  test('stops at max 5 iterations', () => {
    // Create a chain of 6+ encodings; only 5 iterations allowed
    // Encoding '/' repeatedly: '/' → '%2F' → '%252F' → '%25252F' → '%2525252F' → '%252525252F' → '%25252525252F'
    let encoded = '/'
    for (let i = 0; i < 6; i++) {
      encoded = encodeURIComponent(encoded)
    }
    // With only 5 iterations, percent escapes still remain. The hardened
    // decoder rejects this to prevent bypasses against deeper-decoding backends.
    expect(() => recursiveDecodeURIComponent(encoded)).toThrow(
      'incompletely decoded percent encoding',
    )
  })

  test('is idempotent (already decoded input is stable)', () => {
    const input = '/normal/path'
    const first = recursiveDecodeURIComponent(input)
    const second = recursiveDecodeURIComponent(first)
    expect(first).toBe(second)
  })

  test('handles mixed normal and encoded characters', () => {
    expect(recursiveDecodeURIComponent('path%2Fto%2Ffile')).toBe('path/to/file')
  })
})

// ─── sanitizePath ─────────────────────────────────────────────────────

describe('sanitizePath', () => {
  test('returns "/" for empty string', () => {
    expect(sanitizePath('')).toBe('/')
  })

  test('returns "/" for falsy input', () => {
    // The guard is `if (!path)` — covers undefined, null, empty string
    // Since the signature requires string, we test empty string
    expect(sanitizePath('')).toBe('/')
  })

  test('prepends leading slash when missing', () => {
    expect(sanitizePath('api/users')).toBe('/api/users')
  })

  test('does not double-prepend leading slash', () => {
    expect(sanitizePath('/api/users')).toBe('/api/users')
  })

  test('removes trailing slash (non-root)', () => {
    expect(sanitizePath('/api/users/')).toBe('/api/users')
  })

  test('preserves root path "/"', () => {
    expect(sanitizePath('/')).toBe('/')
  })

  test('removes directory traversal patterns (..)', () => {
    expect(sanitizePath('/etc/..%2Fpasswd')).toBe('/etc/passwd')
  })

  test('recursively decodes double-encoded path segments', () => {
    // %252f → / after recursive decode
    expect(sanitizePath('/api%252fusers')).toBe('/api/users')
  })

  test('collapses double slashes', () => {
    expect(sanitizePath('//api//users')).toBe('/api/users')
  })

  test('removes null bytes', () => {
    expect(sanitizePath('/api/\u0000users')).toBe('/api/users')
  })

  test('handles complex attack path', () => {
    // Triple-encoded traversal
    expect(sanitizePath('%25252fetc%25252fpasswd')).toBe('/etc/passwd')
  })

  test('removes .. while decoding', () => {
    expect(sanitizePath('/../etc/passwd')).toBe('/etc/passwd')
  })

  test('handles path that becomes root after sanitization', () => {
    // After removing .. and slashes, we might end up with empty
    expect(sanitizePath('..')).toBe('/')
  })

  test('normalizes path with multiple issues', () => {
    expect(sanitizePath('..//api/..%2Fusers/')).toBe('/api/users')
  })

  test('rejects non-canonical encodings in path', () => {
    expect(() => sanitizePath('/foo/%C0%AF')).toThrow(
      /Non-canonical percent encoding detected in path/i,
    )
  })
})

// ─── sanitizeHeader ───────────────────────────────────────────────────

describe('sanitizeHeader', () => {
  test('returns empty string for empty input', () => {
    expect(sanitizeHeader('')).toBe('')
  })

  test('returns empty string for falsy input', () => {
    // Empty string triggers `if (!value)`
    expect(sanitizeHeader('')).toBe('')
  })

  test('removes control characters', () => {
    // \x00 is null, \x1F is unit separator, \x7F is DEL
    expect(sanitizeHeader('hello\x00world')).toBe('helloworld')
    expect(sanitizeHeader('test\x1Fvalue')).toBe('testvalue')
    expect(sanitizeHeader('data\x7Fend')).toBe('dataend')
  })

  test('preserves normal characters', () => {
    expect(sanitizeHeader('Content-Type')).toBe('Content-Type')
    expect(sanitizeHeader('Bearer token123')).toBe('Bearer token123')
  })

  test('removes all control characters in range except HTAB', () => {
    // Tab (\x09) is a valid separator per RFC 7230; newline (\x0A) and
    // carriage return (\x0D) are removed.
    expect(sanitizeHeader('hello\x09world\x0Atest')).toBe('hello\tworldtest')
  })

  test('handles string with only control chars', () => {
    expect(sanitizeHeader('\x00\x01\x02')).toBe('')
  })
})

// ─── containsOnlyAllowedChars ─────────────────────────────────────────

describe('containsOnlyAllowedChars', () => {
  test('returns true when string matches pattern', () => {
    expect(containsOnlyAllowedChars('abc123', /^[a-z0-9]+$/)).toBe(true)
  })

  test('returns false when string does not match pattern', () => {
    expect(containsOnlyAllowedChars('abc-123', /^[a-z0-9]+$/)).toBe(false)
  })

  test('handles empty string with pattern', () => {
    expect(containsOnlyAllowedChars('', /^[a-z]*$/)).toBe(true)
  })
})

// ─── matchesBlockedPattern ────────────────────────────────────────────

describe('matchesBlockedPattern', () => {
  test('returns true when string matches a blocked pattern', () => {
    const patterns = [/<script>/i, /javascript:/i]
    expect(matchesBlockedPattern('hello <script> alert', patterns)).toBe(true)
  })

  test('returns false when no patterns match', () => {
    const patterns = [/<script>/i, /javascript:/i]
    expect(matchesBlockedPattern('hello world', patterns)).toBe(false)
  })

  test('returns false for empty patterns array', () => {
    expect(matchesBlockedPattern('anything', [])).toBe(false)
  })

  test('matches first pattern in the list', () => {
    const patterns = [/foo/, /bar/]
    expect(matchesBlockedPattern('foo bar', patterns)).toBe(true)
  })
})

// ─── sanitizeErrorMessage ─────────────────────────────────────────────

describe('sanitizeErrorMessage', () => {
  const error = new Error('Sensitive internal details: DB_CONN_STRING=secret')

  test('returns error.message in dev mode (production=false)', () => {
    expect(sanitizeErrorMessage(error, false)).toBe(
      'Sensitive internal details: DB_CONN_STRING=secret',
    )
  })

  test('returns generic message in production mode (production=true)', () => {
    expect(sanitizeErrorMessage(error, true)).toBe(
      'An error occurred while processing your request',
    )
  })

  test('dev mode returns original message for any error type', () => {
    const typeError = new TypeError('Something went wrong')
    expect(sanitizeErrorMessage(typeError, false)).toBe('Something went wrong')
  })

  test('production mode always returns the same generic message', () => {
    const err1 = new Error('Error A')
    const err2 = new Error('Error B')
    expect(sanitizeErrorMessage(err1, true)).toBe(
      sanitizeErrorMessage(err2, true),
    )
  })
})

// ─── generateRequestId ────────────────────────────────────────────────

describe('generateRequestId', () => {
  test('returns a string with expected prefix', () => {
    const id = generateRequestId()
    expect(id.startsWith('req_')).toBe(true)
  })

  test('returns unique IDs', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 10; i++) {
      ids.add(generateRequestId())
    }
    expect(ids.size).toBe(10)
  })
})

// ─── isValidIP ────────────────────────────────────────────────────────

describe('isValidIP', () => {
  test('validates correct IPv4 address', () => {
    expect(isValidIP('192.168.1.1')).toBe(true)
  })

  test('validates IPv4 with boundary values', () => {
    expect(isValidIP('0.0.0.0')).toBe(true)
    expect(isValidIP('255.255.255.255')).toBe(true)
  })

  test('rejects IPv4 with octet > 255', () => {
    expect(isValidIP('192.168.1.256')).toBe(false)
  })

  test('rejects invalid IPv4 format', () => {
    expect(isValidIP('192.168.1')).toBe(false)
    expect(isValidIP('192.168.1.1.1')).toBe(false)
  })

  test('validates IPv6 address', () => {
    expect(isValidIP('::1')).toBe(true)
    expect(isValidIP('2001:db8::1')).toBe(true)
  })

  test('rejects invalid IP format entirely', () => {
    expect(isValidIP('not-an-ip')).toBe(false)
  })
})

// ─── isIPInCIDR ────────────────────────────────────────────────────────

describe('isIPInCIDR', () => {
  test('returns false for empty network', () => {
    expect(isIPInCIDR('192.168.1.1', '/24')).toBe(false)
  })

  test('returns true for IPv6 CIDR within range', () => {
    // IPv6 CIDR matching is now supported
    expect(isIPInCIDR('2001:db8::1', '2001:db8::/32')).toBe(true)
  })

  test('returns false for NaN prefix', () => {
    expect(isIPInCIDR('192.168.1.1', '192.168.1.0/abc')).toBe(false)
  })

  test('returns false for negative prefix', () => {
    expect(isIPInCIDR('192.168.1.1', '192.168.1.0/-1')).toBe(false)
  })

  test('returns false for prefix > 32', () => {
    expect(isIPInCIDR('192.168.1.1', '192.168.1.0/33')).toBe(false)
  })

  test('returns false for prefix = 33 (boundary)', () => {
    expect(isIPInCIDR('192.168.1.1', '192.168.1.0/33')).toBe(false)
  })

  test('exact match when no CIDR prefix (no slash)', () => {
    expect(isIPInCIDR('192.168.1.1', '192.168.1.1')).toBe(true)
  })

  test('exact mismatch when no CIDR prefix', () => {
    expect(isIPInCIDR('192.168.1.2', '192.168.1.1')).toBe(false)
  })

  test('IP within /24 subnet', () => {
    expect(isIPInCIDR('192.168.1.50', '192.168.1.0/24')).toBe(true)
  })

  test('IP outside /24 subnet', () => {
    expect(isIPInCIDR('192.168.2.1', '192.168.1.0/24')).toBe(false)
  })

  test('IP within /16 subnet', () => {
    expect(isIPInCIDR('192.168.50.50', '192.168.0.0/16')).toBe(true)
  })

  test('IP outside /16 subnet', () => {
    expect(isIPInCIDR('192.169.1.1', '192.168.0.0/16')).toBe(false)
  })

  test('network address itself is within subnet', () => {
    expect(isIPInCIDR('192.168.1.0', '192.168.1.0/24')).toBe(true)
  })

  test('broadcast address is within subnet', () => {
    expect(isIPInCIDR('192.168.1.255', '192.168.1.0/24')).toBe(true)
  })

  test('/32 prefix (exact host match)', () => {
    expect(isIPInCIDR('10.0.0.1', '10.0.0.1/32')).toBe(true)
  })

  test('/32 prefix mismatch', () => {
    expect(isIPInCIDR('10.0.0.2', '10.0.0.1/32')).toBe(false)
  })

  test('/0 prefix matches everything', () => {
    expect(isIPInCIDR('1.2.3.4', '0.0.0.0/0')).toBe(true)
  })

  test('returns false for invalid IP in CIDR check', () => {
    // The ipToNumber returns 0 for invalid IPs (not 4 octets)
    // 0 & mask === networkNum & mask — if network is also 0.0.0.0
    // This depends on implementation; test with non-matching case
    expect(isIPInCIDR('invalid', '192.168.1.0/24')).toBe(false)
  })
})

// ─── safeJSONParse ────────────────────────────────────────────────────

describe('safeJSONParse', () => {
  test('parses valid JSON and returns the object', () => {
    const result = safeJSONParse('{"name":"test","value":42}', {})
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  test('returns fallback for invalid JSON', () => {
    const fallback = { error: true }
    const result = safeJSONParse('not json at all', fallback)
    expect(result).toBe(fallback)
  })

  test('handles empty string with fallback', () => {
    const result = safeJSONParse('', null)
    expect(result).toBeNull()
  })

  test('handles primitive JSON values', () => {
    expect(safeJSONParse('42', 0)).toBe(42)
    expect(safeJSONParse('"hello"', '')).toBe('hello')
    expect(safeJSONParse('true', false)).toBe(true)
  })

  test('handles array JSON', () => {
    const result = safeJSONParse('[1,2,3]', [])
    expect(result).toEqual([1, 2, 3])
  })

  test('handles malformed JSON (missing closing brace)', () => {
    const fallback = { fallback: true }
    const result = safeJSONParse('{"name":"test"', fallback)
    expect(result).toBe(fallback)
  })

  test('handles JSON with trailing comma (invalid)', () => {
    const fallback: Record<string, unknown> = {}
    const result = safeJSONParse('{"name":"test",}', fallback)
    expect(result).toBe(fallback)
  })

  test('handles single quotes (invalid JSON)', () => {
    const result = safeJSONParse("{'name':'test'}", 'fallback')
    expect(result).toBe('fallback')
  })
})

// ─── redactSensitiveData ──────────────────────────────────────────────

describe('redactSensitiveData', () => {
  test('returns primitives unchanged (string)', () => {
    expect(redactSensitiveData('hello')).toBe('hello')
  })

  test('returns primitives unchanged (number)', () => {
    expect(redactSensitiveData(42)).toBe(42)
  })

  test('returns primitives unchanged (boolean)', () => {
    expect(redactSensitiveData(true)).toBe(true)
  })

  test('returns null unchanged', () => {
    expect(redactSensitiveData(null)).toBeNull()
  })

  test('returns undefined unchanged', () => {
    expect(redactSensitiveData(undefined)).toBeUndefined()
  })

  test('redacts sensitive keys in a flat object', () => {
    const input = {
      username: 'john',
      password: 'secret123',
      email: 'john@example.com',
    }
    const result = redactSensitiveData(input)
    expect(result.username).toBe('john')
    expect(result.password).toBe('[REDACTED]')
    expect(result.email).toBe('john@example.com')
  })

  test('redacts keys matching any sensitive key pattern (case insensitive)', () => {
    const input = { apiKey: 'abc123', Authorization: 'Bearer token' }
    const result = redactSensitiveData(input)
    expect(result.apiKey).toBe('[REDACTED]')
    expect(result.Authorization).toBe('[REDACTED]')
  })

  test('redacts nested sensitive data', () => {
    const input = {
      user: {
        name: 'alice',
        password: 'nested-secret',
      },
      public: 'data',
    }
    const result = redactSensitiveData(input)
    expect(result.user.password).toBe('[REDACTED]')
    expect(result.user.name).toBe('alice')
    expect(result.public).toBe('data')
  })

  test('redacts deeply nested sensitive data', () => {
    const input = {
      level1: {
        level2: {
          secret: 'deep-secret',
          level3: {
            token: 'deep-token',
          },
        },
      },
    }
    const result = redactSensitiveData(input)
    expect(result.level1.level2.secret).toBe('[REDACTED]')
    expect(result.level1.level2.level3.token).toBe('[REDACTED]')
  })

  test('redacts sensitive data in arrays', () => {
    const input = [
      { name: 'item1', password: 'pass1' },
      { name: 'item2', password: 'pass2' },
    ]
    const result = redactSensitiveData(input)
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].password).toBe('[REDACTED]')
    expect(result[1].password).toBe('[REDACTED]')
    expect(result[0].name).toBe('item1')
  })

  test('redacts sensitive data in array of objects with nested keys', () => {
    const input = [
      { auth: { token: 'tok1', key: 'k1' } },
      { auth: { token: 'tok2', key: 'k2' } },
    ]
    const result = redactSensitiveData(input)
    expect(result[0].auth.token).toBe('[REDACTED]')
    expect(result[0].auth.key).toBe('[REDACTED]')
  })

  test('handles array of primitives (passes through)', () => {
    const input = ['a', 'b', 'c']
    const result = redactSensitiveData(input)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  test('uses custom sensitive keys', () => {
    const input = { myCustomField: 'secret', normal: 'public' }
    const result = redactSensitiveData(input, ['mycustomfield'])
    expect(result.myCustomField).toBe('[REDACTED]')
    expect(result.normal).toBe('public')
  })

  test('does not redact non-sensitive keys', () => {
    const input = { username: 'john', email: 'john@example.com', age: 30 }
    const result = redactSensitiveData(input)
    expect(result.username).toBe('john')
    expect(result.email).toBe('john@example.com')
    expect(result.age).toBe(30)
  })
})

// ─── timingSafeEqual ─────────────────────────────────────────────────

describe('timingSafeEqual', () => {
  test('returns true for equal strings', () => {
    expect(timingSafeEqual('hello', 'hello')).toBe(true)
  })

  test('returns false for different lengths', () => {
    expect(timingSafeEqual('hello', 'hello!')).toBe(false)
  })

  test('returns false for same length, different content', () => {
    expect(timingSafeEqual('hello', 'hallo')).toBe(false)
  })

  test('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true)
  })

  test('returns false for empty vs non-empty', () => {
    expect(timingSafeEqual('', 'a')).toBe(false)
  })

  test('returns false when strings differ in last character', () => {
    expect(timingSafeEqual('abcdef', 'abcdeF')).toBe(false)
  })

  test('returns false when strings differ in first character', () => {
    expect(timingSafeEqual('Abcdef', 'abcdef')).toBe(false)
  })

  test('handles special characters', () => {
    const a = 'test\x00string'
    const b = 'test\x00string'
    expect(timingSafeEqual(a, b)).toBe(true)
  })

  test('is case-sensitive', () => {
    expect(timingSafeEqual('Hello', 'hello')).toBe(false)
  })

  test('returns false when crypto.timingSafeEqual throws', () => {
    const mock = spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
      throw new Error('unexpected')
    })
    try {
      expect(timingSafeEqual('same', 'same')).toBe(false)
    } finally {
      mock.mockRestore()
    }
  })
})

// ─── isValidURL ───────────────────────────────────────────────────────

describe('isValidURL', () => {
  test('returns true for valid HTTP URL', () => {
    expect(isValidURL('https://example.com')).toBe(true)
  })

  test('returns true for valid URL with path', () => {
    expect(isValidURL('https://example.com/path/to/resource')).toBe(true)
  })

  test('returns true for valid URL with query params', () => {
    expect(isValidURL('https://example.com/search?q=test&page=1')).toBe(true)
  })

  test('returns true for URL with port', () => {
    expect(isValidURL('http://localhost:3000/api')).toBe(true)
  })

  test('returns false for invalid URL (no protocol)', () => {
    expect(isValidURL('not-a-url')).toBe(false)
  })

  test('returns false for empty string', () => {
    expect(isValidURL('')).toBe(false)
  })

  test('returns false for whitespace only', () => {
    expect(isValidURL('   ')).toBe(false)
  })

  test('returns false for malformed URL', () => {
    expect(isValidURL('http://')).toBe(false)
  })

  test('returns true for URL with fragment', () => {
    expect(isValidURL('https://example.com/page#section')).toBe(true)
  })

  test('returns true for data URL', () => {
    expect(isValidURL('data:text/plain,hello')).toBe(true)
  })
})

// ─── extractDomain ────────────────────────────────────────────────────

describe('extractDomain', () => {
  test('extracts hostname from valid URL', () => {
    expect(extractDomain('https://example.com/path')).toBe('example.com')
  })

  test('extracts hostname with subdomain', () => {
    expect(extractDomain('https://api.example.com/v1/users')).toBe(
      'api.example.com',
    )
  })

  test('extracts localhost', () => {
    expect(extractDomain('http://localhost:3000/test')).toBe('localhost')
  })

  test('returns null for invalid URL', () => {
    expect(extractDomain('not-a-url')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(extractDomain('')).toBeNull()
  })

  test('extracts domain from URL with auth', () => {
    expect(extractDomain('https://user:pass@example.com/secure')).toBe(
      'example.com',
    )
  })

  test('extracts IP address hostname', () => {
    expect(extractDomain('http://192.168.1.1/api')).toBe('192.168.1.1')
  })
})

// ─── header name/value validation ─────────────────────────────────────

describe('isValidHeaderName', () => {
  test('accepts valid token characters', () => {
    expect(isValidHeaderName('Content-Type')).toBe(true)
    expect(isValidHeaderName('X-Custom-Header')).toBe(true)
  })

  test('rejects invalid token characters', () => {
    expect(isValidHeaderName('Bad Name')).toBe(false)
    expect(isValidHeaderName('Bad:Name')).toBe(false)
  })
})

describe('isValidHeaderValue', () => {
  test('accepts visible ASCII and HTAB', () => {
    expect(isValidHeaderValue('value')).toBe(true)
    expect(isValidHeaderValue('value\twith\ttab')).toBe(true)
  })

  test('rejects control characters', () => {
    expect(isValidHeaderValue('value\r\n')).toBe(false)
    expect(isValidHeaderValue('value\0')).toBe(false)
  })
})

// ─── non-canonical / overlong encoding detection ──────────────────────

describe('recursiveDecodeURIComponent non-canonical encoding', () => {
  test('rejects 2-byte overlong form', () => {
    expect(() => recursiveDecodeURIComponent('%C0%AF')).toThrow(
      /non-canonical/i,
    )
    expect(() => recursiveDecodeURIComponent('%C0%80')).toThrow(
      /non-canonical/i,
    )
  })

  test('rejects 3-byte overlong form', () => {
    expect(() => recursiveDecodeURIComponent('%E0%80%AF')).toThrow(
      /non-canonical/i,
    )
  })

  test('rejects 4-byte overlong form', () => {
    expect(() => recursiveDecodeURIComponent('%F0%80%80%AF')).toThrow(
      /non-canonical/i,
    )
  })

  test('rejects invalid leading bytes', () => {
    expect(() => recursiveDecodeURIComponent('%FE')).toThrow(/non-canonical/i)
    expect(() => recursiveDecodeURIComponent('%FF')).toThrow(/non-canonical/i)
  })
})

// ─── IPv6 CIDR edge cases ─────────────────────────────────────────────

describe('isIPInCIDR IPv6 edge cases', () => {
  test('returns true for matching IPv6 network', () => {
    expect(isIPInCIDR('2001:db8::1', '2001:db8::/64')).toBe(true)
  })

  test('returns false for IPv6 outside network', () => {
    expect(isIPInCIDR('2001:db8:1::1', '2001:db8::/64')).toBe(false)
  })

  test('returns false for out-of-range IPv6 prefix', () => {
    expect(isIPInCIDR('2001:db8::1', '2001:db8::/129')).toBe(false)
  })

  test('returns false for invalid IPv6 in CIDR', () => {
    expect(isIPInCIDR('2001:db8::1', 'not-an-ip/64')).toBe(false)
    expect(isIPInCIDR('not-an-ip', '2001:db8::/64')).toBe(false)
  })

  test('matches on non-byte IPv6 prefix boundary', () => {
    expect(isIPInCIDR('2001:db8::1', '2001:db8::/68')).toBe(true)
    // Byte 8 (high nibble) differs from the network, so /68 should not match.
    expect(isIPInCIDR('2001:db8:0:0:1000::', '2001:db8::/68')).toBe(false)
  })

  test('returns false for non-IP/non-IPv6 CIDR network', () => {
    expect(isIPInCIDR('2001:db8::1', 'not-an-ip')).toBe(false)
  })
})

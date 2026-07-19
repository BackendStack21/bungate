/**
 * Security utility functions
 */

import {
  randomBytes,
  createHash,
  timingSafeEqual as cryptoTimingSafeEqual,
} from 'crypto'

/**
 * Calculates the entropy (in bits) of a given string
 * Uses Shannon entropy formula
 */
export function calculateEntropy(str: string): number {
  if (!str || str.length === 0) {
    return 0
  }

  const frequencies = new Map<string, number>()

  // Count character frequencies
  for (const char of str) {
    frequencies.set(char, (frequencies.get(char) || 0) + 1)
  }

  // Calculate Shannon entropy
  let entropy = 0
  const length = str.length

  for (const count of frequencies.values()) {
    const probability = count / length
    entropy -= probability * Math.log2(probability)
  }

  // Return total entropy in bits
  return entropy * length
}

/**
 * Validates that a string has minimum entropy
 */
export function hasMinimumEntropy(str: string, minBits: number): boolean {
  return calculateEntropy(str) >= minBits
}

/**
 * Generates a cryptographically secure random string
 */
export function generateSecureRandom(bytes: number = 32): string {
  return randomBytes(bytes).toString('hex')
}

/**
 * Generates a cryptographically secure random string with specific entropy
 */
export function generateSecureRandomWithEntropy(entropyBits: number): string {
  const bytes = Math.ceil(entropyBits / 8)
  return randomBytes(bytes).toString('hex')
}

/**
 * Non-canonical / overlong UTF-8 percent encodings that can be used to bypass
 * path validation. These sequences decode to characters that also have a shorter
 * canonical encoding.
 */
const NON_CANONICAL_ENCODING_PATTERNS = [
  // 2-byte overlong forms (U+0000 - U+007F encoded as 2 bytes)
  /%[cC][01]%[89aAbB][0-9a-fA-F]/,
  // 3-byte overlong forms (U+0000 - U+07FF encoded as 3 bytes)
  /%[eE]0%[89aAbB][0-9a-fA-F]%[89aAbB][0-9a-fA-F]/,
  // 4-byte overlong forms (U+0000 - U+FFFF encoded as 4 bytes)
  /%[fF]0%[89aAbB][0-9a-fA-F]%[89aAbB][0-9a-fA-F]%[89aAbB][0-9a-fA-F]/,
  // Invalid leading bytes (fe/ff)
  /%[fF][eEfF]/,
]

/**
 * Checks whether a string contains non-canonical / overlong percent encodings.
 */
export function hasNonCanonicalEncoding(input: string): boolean {
  return NON_CANONICAL_ENCODING_PATTERNS.some((pattern) => pattern.test(input))
}

/**
 * Recursively decode URL encoding until stable.
 * Prevents double-encoding bypass attacks (e.g., %252f → %2f → /).
 *
 * Rejects non-canonical / overlong UTF-8 percent encodings which could be
 * interpreted differently by downstream parsers.
 */
export function recursiveDecodeURIComponent(input: string): string {
  if (hasNonCanonicalEncoding(input)) {
    throw new Error('Non-canonical percent encoding detected')
  }

  let decoded = input
  let iterations = 0
  const maxIterations = 5
  while (iterations < maxIterations) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break // stable
      decoded = next
    } catch {
      break // malformed encoding, stop
    }
    iterations++
  }

  // If percent escapes remain after the decode budget, a downstream that decodes
  // more aggressively may interpret them differently (e.g. 6+ layers of %25).
  if (/%[0-9a-fA-F]{2}/.test(decoded)) {
    throw new Error('Path contains incompletely decoded percent encoding')
  }

  return decoded
}

/**
 * Sanitizes a path to prevent directory traversal attacks.
 * Recursively decodes URL encoding, strips traversal patterns,
 * and normalizes slashes.
 */
export function sanitizePath(path: string): string {
  if (!path) {
    return '/'
  }

  // Reject non-canonical encodings before decoding
  if (hasNonCanonicalEncoding(path)) {
    throw new Error('Non-canonical percent encoding detected in path')
  }

  // Remove null bytes first (they break decoding)
  let sanitized = path.replace(/\0/g, '')

  // Recursively decode URL encoding to defeat double-encoding attacks
  sanitized = recursiveDecodeURIComponent(sanitized)

  // Remove directory traversal patterns
  sanitized = sanitized.replace(/\.\./g, '')
  sanitized = sanitized.replace(/\/\//g, '/')

  // Ensure path starts with /
  if (!sanitized.startsWith('/')) {
    sanitized = '/' + sanitized
  }

  // Remove trailing slash (except for root)
  if (sanitized.length > 1 && sanitized.endsWith('/')) {
    sanitized = sanitized.slice(0, -1)
  }

  return sanitized
}

/**
 * Sanitizes a header value.
 *
 * Restricts to RFC 7230 field-vchar (visible ASCII / obs-text) plus HTAB.
 * This prevents CRLF injection and other header smuggling attacks while
 * preserving legitimate international characters in obs-text.
 */
export function sanitizeHeader(value: string): string {
  if (!value) {
    return ''
  }

  // Remove all control characters except HTAB, and DEL
  return value.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '')
}

/**
 * Validates that a header name is a valid RFC 7230 token.
 */
export function isValidHeaderName(name: string): boolean {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)
}

/**
 * Validates that a header value contains only allowed characters.
 */
export function isValidHeaderValue(value: string): boolean {
  return /^[\t\x20-\x7E\x80-\xFF]*$/.test(value)
}

/**
 * Boundary-aware exclude-path matching.
 *
 * `/health` must not match `/healthcheck`, and `/api/public` must not match
 * `/api/publicity/admin`. A trailing slash is normalised before comparison.
 */
export function matchesExcludedPath(
  pathname: string,
  excludePaths: string[],
): boolean {
  return excludePaths.some((excluded) => {
    const ex = excluded.endsWith('/') ? excluded.slice(0, -1) : excluded
    if (ex === '') return false
    return pathname === ex || pathname.startsWith(ex + '/')
  })
}

/**
 * Validates that a string contains only allowed characters
 */
export function containsOnlyAllowedChars(
  str: string,
  pattern: RegExp,
): boolean {
  return pattern.test(str)
}

/**
 * Checks if a string matches any blocked patterns
 */
export function matchesBlockedPattern(
  str: string,
  patterns: RegExp[],
): boolean {
  return patterns.some((pattern) => pattern.test(str))
}

/**
 * Sanitizes an error message for production
 */
export function sanitizeErrorMessage(
  error: Error,
  production: boolean,
): string {
  if (!production) {
    return error.message
  }

  // Return generic message in production
  return 'An error occurred while processing your request'
}

/**
 * Generates a unique request ID
 */
export function generateRequestId(): string {
  return `req_${Date.now()}_${generateSecureRandom(8)}`
}

/**
 * Expands an IPv6 address that uses :: shorthand into its full 8-group form.
 */
function expandIPv6(ip: string): string | null {
  if (!ip.includes(':')) return null

  let expanded = ip
  if (ip.includes('::')) {
    const parts = ip.split('::')
    if (parts.length !== 2) return null

    const left = parts[0] ? parts[0].split(':') : []
    const right = parts[1] ? parts[1].split(':') : []
    const missing = 8 - left.length - right.length
    if (missing < 0) return null

    const fill = new Array(missing).fill('0')
    expanded = [...left, ...fill, ...right].join(':')
  }

  const groups = expanded.split(':')
  if (groups.length !== 8) return null

  const normalized = groups.map((g) => g.padStart(4, '0').toLowerCase())
  if (normalized.some((g) => !/^[0-9a-f]{4}$/.test(g))) return null

  return normalized.join(':')
}

/**
 * Validates IP address format (IPv4 or IPv6)
 */
export function isValidIP(ip: string): boolean {
  // IPv4 pattern
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/

  if (ipv4Pattern.test(ip)) {
    // Validate IPv4 octets are 0-255
    const octets = ip.split('.')
    return octets.every((octet) => {
      const num = parseInt(octet, 10)
      return num >= 0 && num <= 255
    })
  }

  // IPv6 pattern (supports :: shorthand)
  return expandIPv6(ip) !== null
}

/**
 * Parses CIDR notation and checks if IP is in range
 */
export function isIPInCIDR(ip: string, cidr: string): boolean {
  const [network, prefixLength] = cidr.split('/')

  if (!network) {
    return false
  }

  if (!prefixLength) {
    // No CIDR notation, exact match
    return ip === network
  }

  const prefix = parseInt(prefixLength, 10)
  if (isNaN(prefix)) {
    return false
  }

  // IPv4 CIDR
  if (network.includes('.')) {
    if (prefix < 0 || prefix > 32) {
      return false
    }

    const ipNum = ipToNumber(ip)
    const networkNum = ipToNumber(network)

    // Prefix 0 matches everything (subnet mask is 0.0.0.0)
    if (prefix === 0) {
      return true
    }

    const mask = ~((1 << (32 - prefix)) - 1)

    return (ipNum & mask) === (networkNum & mask)
  }

  // IPv6 CIDR
  if (network.includes(':')) {
    if (prefix < 0 || prefix > 128) {
      return false
    }

    const ipExpanded = expandIPv6(ip)
    const networkExpanded = expandIPv6(network)
    if (!ipExpanded || !networkExpanded) {
      return false
    }

    const ipBytes = ipv6ToBytes(ipExpanded)
    const networkBytes = ipv6ToBytes(networkExpanded)
    if (!ipBytes || !networkBytes) {
      return false
    }

    const fullBytes = Math.floor(prefix / 8)
    const remainderBits = prefix % 8

    for (let i = 0; i < fullBytes; i++) {
      if (ipBytes[i] !== networkBytes[i]) {
        return false
      }
    }

    if (remainderBits > 0) {
      const mask = 0xff << (8 - remainderBits)
      if ((ipBytes[fullBytes]! & mask) !== (networkBytes[fullBytes]! & mask)) {
        return false
      }
    }

    return true
  }

  return false
}

/**
 * Converts a fully expanded IPv6 address into a byte array.
 */
function ipv6ToBytes(ip: string): Uint8Array | null {
  const groups = ip.split(':')
  if (groups.length !== 8) return null

  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const group = groups[i]!
    const value = parseInt(group, 16)
    if (isNaN(value)) return null
    bytes[i * 2] = (value >> 8) & 0xff
    bytes[i * 2 + 1] = value & 0xff
  }
  return bytes
}

/**
 * Converts IPv4 address to number
 */
function ipToNumber(ip: string): number {
  const octets = ip.split('.')
  if (octets.length !== 4) {
    return 0
  }

  return (
    octets.reduce((acc, octet) => {
      return (acc << 8) + parseInt(octet, 10)
    }, 0) >>> 0
  ) // Unsigned right shift to ensure positive number
}

/**
 * Safely parses JSON with error handling
 */
export function safeJSONParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T
  } catch {
    return fallback
  }
}

/**
 * Redacts sensitive information from objects
 */
export function redactSensitiveData(
  obj: any,
  sensitiveKeys: string[] = [
    'password',
    'secret',
    'token',
    'key',
    'authorization',
    'cookie',
  ],
): any {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, sensitiveKeys))
  }

  const redacted: any = {}

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase()
    const isSensitive = sensitiveKeys.some((sk) =>
      lowerKey.includes(sk.toLowerCase()),
    )

    if (isSensitive) {
      redacted[key] = '[REDACTED]'
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveData(value, sensitiveKeys)
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

/**
 * Creates a timing-safe string comparison.
 *
 * Uses Node's crypto.timingSafeEqual for constant-time comparison. If inputs
 * may differ in length, they are hashed first to avoid leaking length via a
 * short-circuit.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')

  if (aBuf.length === bBuf.length) {
    try {
      return cryptoTimingSafeEqual(aBuf, bBuf)
    } catch {
      return false
    }
  }

  // Lengths differ: hash both to a fixed length before comparing so that the
  // comparison does not short-circuit on length.
  const aHash = createHash('sha256').update(aBuf).digest()
  const bHash = createHash('sha256').update(bBuf).digest()
  return cryptoTimingSafeEqual(aHash, bHash)
}

/**
 * Validates URL format
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/**
 * Extracts domain from URL
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return null
  }
}

/**
 * Prototype-pollution-safe object merge. Only merges own enumerable properties
 * and skips keys that could pollute Object.prototype.
 */
export function safeMerge<T extends Record<string, any>>(
  defaults: T,
  overrides: Partial<T> = {},
): T {
  const result: T = { ...defaults }

  for (const key of Object.keys(overrides)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    const value = (overrides as any)[key]
    if (value !== undefined) {
      ;(result as any)[key] = value
    }
  }

  return result
}

/**
 * Prototype-pollution-safe deep merge for nested configuration objects.
 * Arrays are replaced, objects are recursively merged.
 */
export function safeDeepMerge<T extends Record<string, any>>(
  defaults: T,
  overrides: Partial<T> = {},
): T {
  const result: any = {}

  for (const key of Object.keys(defaults)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }
    result[key] = (defaults as any)[key]
  }

  for (const key of Object.keys(overrides)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue
    }

    const defaultValue = result[key]
    const overrideValue = (overrides as any)[key]

    if (overrideValue === undefined) {
      continue
    }

    if (
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof defaultValue === 'object' &&
      defaultValue !== null &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = safeDeepMerge(defaultValue, overrideValue)
    } else {
      result[key] = overrideValue
    }
  }

  return result as T
}

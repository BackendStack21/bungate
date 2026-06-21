/**
 * Session Manager Module
 *
 * Provides cryptographically secure session management with:
 * - Secure session ID generation with minimum 128 bits of entropy
 * - Session storage with automatic expiration
 * - Entropy validation for session IDs
 * - Secure cookie handling with Secure, HttpOnly, SameSite attributes
 */

import { generateSecureRandomWithEntropy, hasMinimumEntropy } from './utils'
import type { SessionConfig } from './config'

/**
 * Session data structure
 */
export interface Session {
  id: string
  targetUrl: string
  createdAt: number
  expiresAt: number
  entropy?: number
  metadata?: Record<string, any>
}

/**
 * Cookie options for session cookies
 */
export interface CookieOptions {
  secure?: boolean
  httpOnly?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  domain?: string
  path?: string
  maxAge?: number
}

/**
 * Session Manager class for cryptographically secure session management
 */
export class SessionManager {
  private sessions = new Map<string, Session>()
  private config: Required<SessionConfig>
  private cleanupInterval?: Timer

  constructor(config?: Partial<SessionConfig>) {
    // Set secure defaults
    this.config = {
      entropyBits: config?.entropyBits ?? 128,
      ttl: config?.ttl ?? 3600000, // 1 hour default
      cookieName: config?.cookieName ?? 'bungate_session',
      cookieOptions: {
        secure: config?.cookieOptions?.secure ?? true,
        httpOnly: config?.cookieOptions?.httpOnly ?? true,
        sameSite: config?.cookieOptions?.sameSite ?? 'strict',
        domain: config?.cookieOptions?.domain,
        path: config?.cookieOptions?.path ?? '/',
      },
    }

    // Validate minimum entropy requirement
    if (this.config.entropyBits < 128) {
      throw new Error('Session entropy must be at least 128 bits')
    }

    // Start automatic cleanup
    this.startCleanup()
  }

  /**
   * Generates a cryptographically secure session ID
   * Ensures minimum 128 bits of entropy
   */
  generateSessionId(): string {
    // Generate with configured entropy bits using crypto.randomBytes
    // This provides cryptographic randomness, not Shannon entropy
    const sessionId = generateSecureRandomWithEntropy(this.config.entropyBits)
    return sessionId
  }

  /**
   * Validates that a session ID meets minimum requirements
   * Note: We validate format and length, not Shannon entropy, since
   * crypto.randomBytes provides cryptographic randomness
   */
  validateSessionId(sessionId: string): boolean {
    if (!sessionId || typeof sessionId !== 'string') {
      return false
    }

    // Minimum length check: 128 bits = 16 bytes = 32 hex characters
    // We require at least this length to ensure sufficient cryptographic entropy
    const minLength = Math.ceil(128 / 8) * 2 // 32 characters for hex encoding
    if (sessionId.length < minLength) {
      return false
    }

    // Validate it's a valid hex string (from crypto.randomBytes)
    const hexPattern = /^[0-9a-f]+$/i
    return hexPattern.test(sessionId)
  }

  /**
   * Creates a new session
   */
  createSession(targetUrl: string, metadata?: Record<string, any>): Session {
    const sessionId = this.generateSessionId()
    const now = Date.now()

    const session: Session = {
      id: sessionId,
      targetUrl,
      createdAt: now,
      expiresAt: now + this.config.ttl,
      metadata,
    }

    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Gets a session by ID
   * Returns null if session doesn't exist or has expired
   */
  getSession(sessionId: string): Session | null {
    if (!this.validateSessionId(sessionId)) {
      return null
    }

    const session = this.sessions.get(sessionId)

    if (!session) {
      return null
    }

    // Check if session has expired
    if (Date.now() > session.expiresAt) {
      this.deleteSession(sessionId)
      return null
    }

    return session
  }

  /**
   * Updates an existing session's expiration time
   */
  refreshSession(sessionId: string): boolean {
    const session = this.getSession(sessionId)

    if (!session) {
      return false
    }

    session.expiresAt = Date.now() + this.config.ttl
    this.sessions.set(sessionId, session)
    return true
  }

  /**
   * Deletes a session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Cleans up expired sessions
   */
  cleanupExpiredSessions(): number {
    const now = Date.now()
    let cleanedCount = 0

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(sessionId)
        cleanedCount++
      }
    }

    return cleanedCount
  }

  /**
   * Gets the total number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size
  }

  /**
   * Generates a Set-Cookie header value with secure attributes
   */
  generateCookieHeader(
    sessionId: string,
    options?: Partial<CookieOptions>,
  ): string {
    const cookieOptions = { ...this.config.cookieOptions, ...options }
    const parts: string[] = [`${this.config.cookieName}=${sessionId}`]

    // Add Max-Age (in seconds)
    if (cookieOptions.maxAge !== undefined) {
      parts.push(`Max-Age=${cookieOptions.maxAge}`)
    } else {
      // Use TTL from config
      parts.push(`Max-Age=${Math.floor(this.config.ttl / 1000)}`)
    }

    // Add Path
    if (cookieOptions.path) {
      parts.push(`Path=${cookieOptions.path}`)
    }

    // Add Domain
    if (cookieOptions.domain) {
      parts.push(`Domain=${cookieOptions.domain}`)
    }

    // Add Secure flag
    if (cookieOptions.secure) {
      parts.push('Secure')
    }

    // Add HttpOnly flag
    if (cookieOptions.httpOnly) {
      parts.push('HttpOnly')
    }

    // Add SameSite attribute
    if (cookieOptions.sameSite) {
      const sameSite =
        cookieOptions.sameSite.charAt(0).toUpperCase() +
        cookieOptions.sameSite.slice(1)
      parts.push(`SameSite=${sameSite}`)
    }

    return parts.join('; ')
  }

  /**
   * Extracts session ID from request cookie header
   */
  extractSessionIdFromCookie(cookieHeader: string | null): string | null {
    if (!cookieHeader) {
      return null
    }

    const cookies = cookieHeader.split(';').map((c) => c.trim())

    for (const cookie of cookies) {
      const [name, value] = cookie.split('=')
      if (name === this.config.cookieName && value) {
        return value
      }
    }

    return null
  }

  /**
   * Extracts session ID from request
   */
  getSessionIdFromRequest(request: Request): string | null {
    const cookieHeader = request.headers.get('cookie')
    return this.extractSessionIdFromCookie(cookieHeader)
  }

  /**
   * Gets or creates a session for a request
   */
  getOrCreateSession(request: Request, targetUrl: string): Session {
    const sessionId = this.getSessionIdFromRequest(request)

    if (sessionId) {
      const session = this.getSession(sessionId)
      if (session) {
        // Refresh the session
        this.refreshSession(sessionId)
        return session
      }
    }

    // Create new session
    return this.createSession(targetUrl)
  }

  /**
   * Rotates the session ID for an existing session.
   *
   * Call this after authentication or any privilege escalation to prevent
   * session fixation attacks.
   */
  rotateSessionId(sessionId: string): Session | null {
    const session = this.getSession(sessionId)
    if (!session) {
      return null
    }

    this.deleteSession(sessionId)

    const newSessionId = this.generateSessionId()
    const now = Date.now()
    const rotatedSession: Session = {
      ...session,
      id: newSessionId,
      createdAt: now,
      expiresAt: now + this.config.ttl,
    }

    this.sessions.set(newSessionId, rotatedSession)
    return rotatedSession
  }

  /**
   * Starts automatic cleanup of expired sessions
   */
  private startCleanup(): void {
    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const cleaned = this.cleanupExpiredSessions()
      if (cleaned > 0) {
        // Could log this if logger is available
        // console.log(`Cleaned up ${cleaned} expired sessions`);
      }
    }, 300000)
  }

  /**
   * Stops automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
  }

  /**
   * Destroys the session manager and cleans up resources
   */
  destroy(): void {
    this.stopCleanup()
    this.sessions.clear()
  }

  /**
   * Gets the session configuration
   */
  getConfig(): Readonly<Required<SessionConfig>> {
    return this.config
  }
}

/**
 * Factory function to create a session manager
 */
export function createSessionManager(
  config?: Partial<SessionConfig>,
): SessionManager {
  return new SessionManager(config)
}
